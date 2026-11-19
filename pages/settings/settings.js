var store = require('../../utils/store');
var gpaUtil = require('../../utils/gpa');
var sharecode = require('../../utils/sharecode');
var presets = require('../../utils/presets');
var sync = require('../../utils/sync');

Page({
  data: {
    s: null,
    gpaNames: [],
    gpaIdx: 0,
    weeksOptions: [],
    periodsOptions: [],
    dateValue: '',
    timeRows: [],
    // 备份
    shareShow: false,
    shareCode: '',
    importShow: false,
    importText: '',
    // 快照
    snapShow: false,
    snapList: [],
    snapCount: 0,
    // 云同步
    cloudEnabled: false,
    cloudReady: false,
    cloudStatusText: '',
    cloudSyncing: false
  },

  onShow: function () {
    var s = store.loadSettings();
    var keys = Object.keys(gpaUtil.GPA_TABLES);
    var gpaNames = keys.map(function (k) { return gpaUtil.GPA_TABLES[k].name; });
    var gpaIdx = keys.indexOf(s.gpaType);
    if (gpaIdx < 0) gpaIdx = 0;
    var weeksOptions = [];
    var periodsOptions = [];
    for (var i = 16; i <= 25; i++) weeksOptions.push(i + ' 周');
    for (var j = 6; j <= 15; j++) periodsOptions.push(j + ' 节');
    this.setData({
      s: s,
      gpaNames: gpaNames,
      gpaIdx: gpaIdx,
      weeksOptions: weeksOptions,
      periodsOptions: periodsOptions,
      dateValue: s.semesterStart
    });
    this.buildTimeRows(s);
    var snaps = store.loadSnapshots();
    this.setData({ snapCount: snaps.length });
    this.refreshCloudStatus();
  },

  // ---------- 云同步 ----------
  refreshCloudStatus: function () {
    var st = sync.getStatus();
    var text = '';
    if (!st.ready) {
      text = st.lastError ? ('不可用：' + st.lastError) : '未初始化';
    } else if (!st.enabled) {
      text = '已关闭';
    } else if (st.syncing) {
      text = '同步中...';
    } else if (st.lastSyncAt) {
      var d = new Date(st.lastSyncAt);
      var p = function (n) { return (n < 10 ? '0' : '') + n; };
      text = '已同步 ' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    } else {
      text = '暂无同步记录';
    }
    if (st.lastError && st.ready && st.enabled) text += '（上次失败）';
    this.setData({
      cloudReady: st.ready,
      cloudEnabled: st.enabled,
      cloudSyncing: st.syncing,
      cloudStatusText: text
    });
  },
  toggleCloud: function (e) {
    var on = !!e.detail.value;
    var that = this;
    if (!sync.init()) {
      wx.showToast({ title: '云开发初始化失败', icon: 'none' });
      this.setData({ cloudEnabled: false });
      return;
    }
    sync.setEnabled(on);
    this.setData({ cloudEnabled: on });
    this.refreshCloudStatus();
    if (on) {
      wx.showToast({ title: '已开启，正在上传', icon: 'none' });
      sync.pushAll().then(function () { that.refreshCloudStatus(); });
    } else {
      wx.showToast({ title: '已关闭云同步', icon: 'none' });
    }
  },
  restoreFromCloud: function () {
    var that = this;
    wx.showModal({
      title: '从云端恢复',
      content: '将用云端的课表/成绩/设置覆盖本机数据，继续吗？',
      success: function (r) {
        if (!r.confirm) return;
        wx.showLoading({ title: '恢复中...' });
        sync.restoreFromCloud().then(function (res) {
          wx.hideLoading();
          if (res.ok) {
            wx.showToast({ title: '已恢复 ' + res.courseCount + ' 门课程', icon: 'success' });
            that.onShow();
          } else {
            wx.showToast({ title: res.error || '云端无数据', icon: 'none' });
          }
        });
      }
    });
  },

  // ---------- 上课时间 ----------
  buildTimeRows: function (s) {
    var src = (s && s.periodTimes && s.periodTimes.length) ? s.periodTimes : presets.PERIOD_TIMES;
    var rows = [];
    for (var i = 0; i < s.periodCount; i++) {
      rows.push({ key: 'p' + (i + 1), no: i + 1, time: src[i] || '' });
    }
    this.setData({ timeRows: rows });
  },
  onPeriodTime: function (e) {
    var idx = +e.currentTarget.dataset.idx;
    var s = this.data.s;
    var src = (s.periodTimes && s.periodTimes.length) ? s.periodTimes.slice() : presets.PERIOD_TIMES.slice();
    while (src.length <= idx) src.push('');
    src[idx] = e.detail.value;
    this.save({ periodTimes: src });
    this.buildTimeRows(this.data.s);
  },
  resetTimes: function () {
    this.save({ periodTimes: presets.PERIOD_TIMES.slice() });
    this.buildTimeRows(this.data.s);
  },

  noop: function () {},

  // ---------- 设置项 ----------
  save: function (patch) {
    var s = Object.assign({}, this.data.s, patch);
    store.saveSettings(s);
    this.setData({ s: s });
    wx.showToast({ title: '已保存', icon: 'none' });
  },
  onDate: function (e) {
    this.save({ semesterStart: e.detail.value });
    this.setData({ dateValue: e.detail.value });
  },
  onWeeks: function (e) {
    var v = 16 + (+e.detail.value);
    this.save({ totalWeeks: v });
  },
  onPeriods: function (e) {
    var v = 6 + (+e.detail.value);
    this.save({ periodCount: v });
  },
  onGpa: function (e) {
    var keys = Object.keys(gpaUtil.GPA_TABLES);
    var k = keys[+e.detail.value] || '4.0std';
    this.save({ gpaType: k });
    this.setData({ gpaIdx: +e.detail.value });
  },

  // ---------- 备份 ----------
  exportAll: function () {
    var code = sharecode.encodeShare('backup', {
      courses: store.loadCourses(),
      grades: store.loadGrades(),
      settings: store.loadSettings()
    });
    this.setData({ shareShow: true, shareCode: code });
  },
  closeShare: function () { this.setData({ shareShow: false }); },
  copyCode: function () {
    wx.setClipboardData({ data: this.data.shareCode });
  },
  showImport: function () {
    this.setData({ importShow: true, importText: '' });
  },
  closeImport: function () { this.setData({ importShow: false }); },
  onImportText: function (e) { this.setData({ importText: e.detail.value }); },
  doImport: function () {
    var text = this.data.importText || '';
    if (!text.trim()) {
      wx.showToast({ title: '请先粘贴备份码', icon: 'none' });
      return;
    }
    var obj = sharecode.decodeShare(text);
    if (!obj || obj.t !== 'backup') {
      wx.showToast({ title: '备份码无效', icon: 'none' });
      return;
    }
    var d = obj.d || {};
    if (Array.isArray(d.courses)) store.saveCourses(d.courses);
    if (Array.isArray(d.grades)) store.saveGrades(d.grades);
    if (d.settings && typeof d.settings === 'object') {
      store.saveSettings(Object.assign({}, store.DEFAULT_SETTINGS, d.settings));
    }
    wx.showToast({ title: '恢复成功', icon: 'success' });
    this.setData({ importShow: false, importText: '' });
    this.onShow();
  },

  // ---------- 历史快照 ----------
  fmtTime: function (ts) {
    var d = new Date(ts);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  },
  showSnapshots: function () {
    var list = store.loadSnapshots().map(function (s, i) {
      return {
        idx: i,
        t: s.t,
        timeText: this.fmtTime(s.t),
        courseCount: (s.c && s.c.length) || 0,
        gradeCount: (s.g && s.g.length) || 0
      };
    }, this);
    this.setData({ snapShow: true, snapList: list });
  },
  closeSnapshots: function () { this.setData({ snapShow: false }); },
  restoreSnap: function (e) {
    var idx = +e.currentTarget.dataset.idx;
    var snap = this.data.snapList[idx];
    var that = this;
    wx.showModal({
      title: '恢复快照',
      content: '将 ' + (snap ? snap.timeText : '') + ' 的快照写入当前数据，当前课表/成绩会被替换，继续吗？',
      success: function (r) {
        if (!r.confirm) return;
        var ok = store.restoreSnapshot(idx);
        that.setData({ snapShow: false });
        if (ok) {
          wx.showToast({ title: '已恢复', icon: 'success' });
          that.onShow();
        } else {
          wx.showToast({ title: '快照不存在', icon: 'none' });
        }
      }
    });
  },
  clearSnapList: function () {
    var that = this;
    wx.showModal({
      title: '删除全部快照',
      content: '删除后无法找回，确定吗？',
      confirmColor: '#e64340',
      success: function (r) {
        if (!r.confirm) return;
        store.clearSnapshots();
        that.setData({ snapList: [], snapCount: 0 });
        wx.showToast({ title: '已删除', icon: 'none' });
      }
    });
  },

  // ---------- 清空 ----------
  confirmClear: function (title, content, fn) {
    wx.showModal({
      title: title,
      content: content,
      confirmText: '继续',
      confirmColor: '#e64340',
      success: function (r1) {
        if (!r1.confirm) return;
        wx.showModal({
          title: '再次确认',
          content: '真的要清空吗？此操作无法撤销。',
          confirmText: '清空',
          confirmColor: '#e64340',
          success: function (r2) {
            if (r2.confirm) fn();
          }
        });
      }
    });
  },
  clearCourses: function () {
    var that = this;
    this.confirmClear('清空课表', '将删除全部课程数据（可用历史快照找回）', function () {
      store.saveCourses(store.loadCourses()); // 确保清空前最新状态已入快照
      store.clearCourses();
      wx.showToast({ title: '已清空', icon: 'none' });
      that.onShow();
    });
  },
  clearGrades: function () {
    var that = this;
    this.confirmClear('清空成绩', '将删除全部成绩数据（可用历史快照找回）', function () {
      store.saveGrades(store.loadGrades()); // 确保清空前最新状态已入快照
      store.clearGrades();
      wx.showToast({ title: '已清空', icon: 'none' });
      that.onShow();
    });
  }
});
