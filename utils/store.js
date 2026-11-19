// 本地数据存取统一入口（仅本机存储，不上传任何数据）
var presets = require('./presets');

var KEYS = {
  settings: 'kb_settings',
  courses: 'kb_courses',
  grades: 'kb_grades'
};

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
}

function loadCourses() {
  var c = wx.getStorageSync(KEYS.courses);
  return Array.isArray(c) ? c : [];
}

function saveCourses(c) {
  wx.setStorageSync(KEYS.courses, c);
}

function loadGrades() {
  var g = wx.getStorageSync(KEYS.grades);
  return Array.isArray(g) ? g : [];
}

function saveGrades(g) {
  wx.setStorageSync(KEYS.grades, g);
}

function clearCourses() {
  wx.removeStorageSync(KEYS.courses);
}

function clearGrades() {
  wx.removeStorageSync(KEYS.grades);
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
  clearGrades: clearGrades
};
