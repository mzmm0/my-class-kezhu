var store = require('../../utils/store');
var gpaUtil = require('../../utils/gpa');
var sharecode = require('../../utils/sharecode');
var presets = require('../../utils/presets');

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
    importText: ''
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
    this.confirmClear('清空课表', '将删除全部课程数据', function () {
      store.clearCourses();
      wx.showToast({ title: '已清空', icon: 'none' });
      that.onShow();
    });
  },
  clearGrades: function () {
    var that = this;
    this.confirmClear('清空成绩', '将删除全部成绩数据', function () {
      store.clearGrades();
      wx.showToast({ title: '已清空', icon: 'none' });
      that.onShow();
    });
  }
});
