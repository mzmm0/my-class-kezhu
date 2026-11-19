// 云同步层：把课表/成绩/设置同步到微信云开发数据库
// 设计原则：本地永远优先（秒开、离线可用），云端做备份与跨设备恢复
var conf = require('./cloudconf');

var DB = null;
var COLL = null;
var state = {
  ready: false,        // wx.cloud 是否初始化成功
  enabled: true,       // 用户开关（本地存储记忆）
  lastSyncAt: 0,       // 上次成功同步时间戳
  lastError: '',
  syncing: false
};

var ENABLE_KEY = 'kb_cloud_enabled';

// ---------- 初始化 ----------
function init() {
  if (state.ready) return true;
  try {
    if (!wx.cloud) {
      state.ready = false;
      state.lastError = '当前基础库不支持云开发';
      return false;
    }
    wx.cloud.init({ env: conf.ENV_ID, traceUser: true });
    DB = wx.cloud.database();
    COLL = DB.collection(conf.COLLECTION);
    state.ready = true;
    state.lastError = '';
    // 读取用户开关（默认开启）
    var saved = wx.getStorageSync(ENABLE_KEY);
    state.enabled = saved === '' || saved === undefined ? true : !!saved;
    return true;
  } catch (e) {
    state.ready = false;
    state.lastError = e && e.message ? e.message : String(e);
    return false;
  }
}

function isEnabled() {
  if (!init()) return false;
  return state.enabled;
}

function setEnabled(on) {
  state.enabled = !!on;
  wx.setStorageSync(ENABLE_KEY, state.enabled ? 1 : 0);
  if (state.enabled) {
    // 开启时立即把本地数据推上去一次
    pushAll();
  }
}

function getStatus() {
  return {
    ready: state.ready,
    enabled: state.enabled,
    syncing: state.syncing,
    lastSyncAt: state.lastSyncAt,
    lastError: state.lastError
  };
}

// ---------- 云端读写 ----------
// 每个用户一条记录：{ courses, grades, settings, updatedAt }
// openid 由云数据库自动注入的 _openid 区分，前端只能读写自己的记录

function getMyDoc() {
  return COLL.limit(1).get().then(function (res) {
    return (res.data && res.data[0]) || null;
  });
}

// 推送全部本地数据到云端（upsert）
function pushAll() {
  if (!isEnabled()) return Promise.resolve(false);
  var payload = {
    courses: wx.getStorageSync('kb_courses') || [],
    grades: wx.getStorageSync('kb_grades') || [],
    settings: wx.getStorageSync('kb_settings') || {},
    updatedAt: Date.now()
  };
  return upsert(payload);
}

// 单字段推送（课表变动时只推课表相关，减少写入量）
function pushCourses(courses) {
  if (!isEnabled()) return Promise.resolve(false);
  return upsert({ courses: courses, updatedAt: Date.now() });
}

function pushGrades(grades) {
  if (!isEnabled()) return Promise.resolve(false);
  return upsert({ grades: grades, updatedAt: Date.now() });
}

function pushSettings(settings) {
  if (!isEnabled()) return Promise.resolve(false);
  return upsert({ settings: settings, updatedAt: Date.now() });
}

// 写入：有记录则 update，无记录则 add
function upsert(patch) {
  if (state.syncing) return Promise.resolve(false);
  state.syncing = true;
  var t0 = Date.now();
  return getMyDoc().then(function (doc) {
    if (doc && doc._id) {
      return COLL.doc(doc._id).update({ data: patch });
    }
    var data = {
      courses: patch.courses || [],
      grades: patch.grades || [],
      settings: patch.settings || {},
      updatedAt: patch.updatedAt || Date.now()
    };
    return COLL.add({ data: data });
  }).then(function () {
    state.syncing = false;
    state.lastSyncAt = Date.now();
    state.lastError = '';
    return true;
  }).catch(function (e) {
    state.syncing = false;
    state.lastError = (e && (e.errMsg || e.message)) || String(e);
    return false;
  });
}

// 从云端拉取（启动时调用）：本地缺失的数据从云端补回
function pullAll() {
  if (!isEnabled()) return Promise.resolve(false);
  return getMyDoc().then(function (doc) {
    state.syncing = false;
    if (!doc) return false;
    var localCourses = wx.getStorageSync('kb_courses') || [];
    var localGrades = wx.getStorageSync('kb_grades') || [];
    var cloudTs = doc.updatedAt || 0;
    // 只在本地缺失时补回，避免覆盖本地更新的数据
    if (Array.isArray(doc.courses) && doc.courses.length && !localCourses.length) {
      wx.setStorageSync('kb_courses', doc.courses);
    }
    if (Array.isArray(doc.grades) && doc.grades.length && !localGrades.length) {
      wx.setStorageSync('kb_grades', doc.grades);
    }
    if (doc.settings && typeof doc.settings === 'object') {
      var ls = wx.getStorageSync('kb_settings');
      if (!ls || typeof ls !== 'object') wx.setStorageSync('kb_settings', doc.settings);
    }
    state.lastSyncAt = cloudTs || Date.now();
    return doc;
  }).catch(function (e) {
    state.lastError = (e && (e.errMsg || e.message)) || String(e);
    return false;
  });
}

// 手动全量覆盖恢复（用户点“从云端恢复”）
function restoreFromCloud() {
  if (!init()) return Promise.resolve({ ok: false, error: state.lastError || '云开发不可用' });
  return getMyDoc().then(function (doc) {
    if (!doc) return { ok: false, error: '云端暂无数据' };
    var n = 0;
    if (Array.isArray(doc.courses) && doc.courses.length) { wx.setStorageSync('kb_courses', doc.courses); n++; }
    if (Array.isArray(doc.grades) && doc.grades.length) { wx.setStorageSync('kb_grades', doc.grades); n++; }
    if (doc.settings && typeof doc.settings === 'object') { wx.setStorageSync('kb_settings', doc.settings); n++; }
    return {
      ok: n > 0,
      courseCount: (doc.courses || []).length,
      gradeCount: (doc.grades || []).length,
      updatedAt: doc.updatedAt || 0,
      error: n > 0 ? '' : '云端没有可恢复的数据'
    };
  }).catch(function (e) {
    return { ok: false, error: (e && (e.errMsg || e.message)) || String(e) };
  });
}

module.exports = {
  init: init,
  isEnabled: isEnabled,
  setEnabled: setEnabled,
  getStatus: getStatus,
  pushAll: pushAll,
  pushCourses: pushCourses,
  pushGrades: pushGrades,
  pushSettings: pushSettings,
  pullAll: pullAll,
  restoreFromCloud: restoreFromCloud
};