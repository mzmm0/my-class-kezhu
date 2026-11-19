// 本地数据存取统一入口（仅本机存储，不上传任何数据）
var presets = require('./presets');

var KEYS = {
  settings: 'kb_settings',
  courses: 'kb_courses',
  grades: 'kb_grades',
  snapshots: 'kb_snapshots' // 自动快照（防误删/误清/清缓存丢数据）
};

var SNAPSHOT_KEEP = 5;     // 最多保留快照份数
var SNAPSHOT_GAP = 300000; // 同一数据两次快照最小间隔（毫秒），避免频繁快照

// 以课表内容生成轻量指纹：用于判断数据是否发生变化
function fpCourses(courses) {
  var h = courses.length + ':';
  courses.forEach(function (c) {
    h += [c.name, c.day, c.startPeriod, c.periods, c.room, c.teacher,
      c.weeks && c.weeks.rangeFrom, c.weeks && c.weeks.rangeTo, c.weeks && c.weeks.mode
    ].join(',') + '|';
  });
  return h;
}

function fpGrades(grades) {
  var h = grades.length + ':';
  grades.forEach(function (g) {
    h += [g.name, g.credit, g.score].join(',') + '|';
  });
  return h;
}

// ---------- 自动快照 ----------
// 每次课表/成绩变动时调用：内容变化才入库，保留最近 SNAPSHOT_KEEP 份
function takeSnapshot() {
  try {
    var courses = loadCourses();
    var grades = loadGrades();
    // 全空不入快照（避免把空数据盖进历史备份）
    if (!courses.length && !grades.length) return;
    var list = wx.getStorageSync(KEYS.snapshots);
    if (!Array.isArray(list)) list = [];
    var fp = fpCourses(courses) + '##' + fpGrades(grades);
    // 与最新一份相同内容且间隔未超过限值 -> 跳过
    if (list.length) {
      var latest = list[0];
      if (latest.fp === fp && (Date.now() - latest.t) < SNAPSHOT_GAP) return;
    }
    list.unshift({
      t: Date.now(),
      fp: fp,
      c: courses,
      g: grades
    });
    if (list.length > SNAPSHOT_KEEP) list = list.slice(0, SNAPSHOT_KEEP);
    wx.setStorageSync(KEYS.snapshots, list);
  } catch (e) { /* 快照失败不影响主流程 */ }
}

// 读取快照列表（新在前），供设置页展示/恢复
function loadSnapshots() {
  var list = wx.getStorageSync(KEYS.snapshots);
  return Array.isArray(list) ? list : [];
}

// 恢复指定快照（拷贝回正式键）
function restoreSnapshot(idx) {
  var list = loadSnapshots();
  var snap = list[idx];
  if (!snap) return false;
  wx.setStorageSync(KEYS.courses, Array.isArray(snap.c) ? snap.c.slice() : []);
  wx.setStorageSync(KEYS.grades, Array.isArray(snap.g) ? snap.g.slice() : []);
  return true;
}

// 丢失检测：当前课表+成绩全空，但存在非空快照 -> 提示可恢复
function detectLoss() {
  var courses = loadCourses();
  var grades = loadGrades();
  if (courses.length || grades.length) return null;
  var list = loadSnapshots().filter(function (s) {
    return (s.c && s.c.length) || (s.g && s.g.length);
  });
  if (!list.length) return null;
  return { count: list.length, latest: list[0] };
}

var DEFAULT_SETTINGS = {
  semesterStart: '2026-09-07', // 学期第一周的周一
  totalWeeks: 20,              // 学期总周数
  periodCount: 12,             // 每天节次数
  gpaType: '5.0linear',         // 绩点制式（默认长大方案：成绩÷10−5，可在设置切换）
  periodTimes: presets.PERIOD_TIMES.slice() // 各节次上课时间（可在设置页修改）
};

function genId() {
  return 'id' + Date.now().toString(36) + Math.floor(Math.random() * 1000000).toString(36);
}

function loadSettings() {
  var s = wx.getStorageSync(KEYS.settings);
  if (!s || typeof s !== 'object') {
    s = Object.assign({}, DEFAULT_SETTINGS);
    wx.setStorageSync(KEYS.settings, s);
  } else {
    var changed = false;
    Object.keys(DEFAULT_SETTINGS).forEach(function (k) {
      if (s[k] === undefined) {
        s[k] = DEFAULT_SETTINGS[k];
        changed = true;
      }
    });
    if (changed) wx.setStorageSync(KEYS.settings, s);
  }
  return s;
}

function saveSettings(s) {
  wx.setStorageSync(KEYS.settings, s);
  cloudPush('settings', s);
}

function loadCourses() {
  var c = wx.getStorageSync(KEYS.courses);
  return Array.isArray(c) ? c : [];
}

function saveCourses(c) {
  wx.setStorageSync(KEYS.courses, c);
  takeSnapshot();
  cloudPush('courses', c);
}

function loadGrades() {
  var g = wx.getStorageSync(KEYS.grades);
  return Array.isArray(g) ? g : [];
}

function saveGrades(g) {
  wx.setStorageSync(KEYS.grades, g);
  takeSnapshot();
  cloudPush('grades', g);
}

function clearCourses() {
  wx.removeStorageSync(KEYS.courses);
  takeSnapshot(); // 清空前最新状态已在历史快照里，此处留空数据不入库
  cloudPush('courses', []); // 云端也同步清空（云端有独立快照机制后才建议做，为避免误清，这里仍推空以防两端不一致）
}

function clearGrades() {
  wx.removeStorageSync(KEYS.grades);
  takeSnapshot();
  cloudPush('grades', []);
}

function clearSnapshots() {
  wx.removeStorageSync(KEYS.snapshots);
}

// ---------- 云同步（懒加载，避免循环依赖与启动阻塞） ----------
function cloudPush(kind, data) {
  try {
    var sync = require('./sync');
    if (!sync.isEnabled()) return;
    if (kind === 'courses') sync.pushCourses(data);
    else if (kind === 'grades') sync.pushGrades(data);
    else if (kind === 'settings') sync.pushSettings(data);
  } catch (e) { /* 云同步失败不影响本地主流程 */ }
}

module.exports = {
  KEYS: KEYS,
  DEFAULT_SETTINGS: DEFAULT_SETTINGS,
  genId: genId,
  loadSettings: loadSettings,
  saveSettings: saveSettings,
  loadCourses: loadCourses,
  saveCourses: saveCourses,
  loadGrades: loadGrades,
  saveGrades: saveGrades,
  clearCourses: clearCourses,
  clearGrades: clearGrades,
  loadSnapshots: loadSnapshots,
  restoreSnapshot: restoreSnapshot,
  detectLoss: detectLoss,
  clearSnapshots: clearSnapshots
};
