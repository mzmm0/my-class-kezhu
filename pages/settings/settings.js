var store = require('../../utils/store');
var sharecode = require('../../utils/sharecode');
var presets = require('../../utils/presets');
var sync = require('../../utils/sync');

Page({
  data: {
    s: null,
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
    cloudSyncing: false,
    // 课前提醒
    remindOn: false,
    remindQuota: 0
  },

  onShow: function () {
    var s = store.loadSettings();
    var weeksOptions = [];
    var periodsOptions = [];
    for (var i = 16; i <= 25; i++) weeksOptions.push(i + ' 周');
    for (var j = 6; j <= 15; j++) periodsOptions.push(j + ' 节');
    this.setData({
      s: s,
      weeksOptions: weeksOptions,
      periodsOptions: periodsOptions,
      dateValue: s.semesterStart,
      remindOn: wx.getStorageSync('kb_remind_on') === true,
      remindQuota: (function () {
        var v = wx.getStorageSync('kb_remind_quota');
        return typeof v === 'number' ? v : 0;
      })()
    });
    // 云端额度为准（异步刷新显示）
    var thatQ = this;
    sync.getRemindQuota().then(function (q) {
      thatQ.setData({ remindQuota: q });
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

  // ---------- 课前提醒 ----------
  // 今日本地日期串（与续订记录比对用）
  todayStr: function () {
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  },
  markTodaySubscribed: function () {
    wx.setStorageSync('kb_remind_last_sub', this.todayStr());
  },
  toggleRemind: function (e) {
    var on = !!e.detail.value;
    var that = this;
    if (!on) {
      // 关闭：本地+云端同时记状态
      sync.upsertPatch({ remindOn: false, updatedAt: Date.now() });
      wx.setStorageSync('kb_remind_on', false);
      this.setData({ remindOn: false });
      wx.showToast({ title: '已关闭提醒', icon: 'none' });
      return;
    }
    // 开启：先拉起订阅授权（一次性订阅，可多点几次积累次数）
    var conf = require('../../utils/cloudconf');
    var tpl = conf.REMIND_TEMPLATE_ID;
    if (!tpl) {
      wx.showModal({
        title: '提醒未配置',
        content: '订阅消息模板 ID 尚未配置，请稍后再试。',
        showCancel: false
      });
      this.setData({ remindOn: false });
      return;
    }
    wx.requestSubscribeMessage({
      tmplIds: [tpl],
      success: function (res) {
        if (res[tpl] === 'accept') {
          sync.upsertPatch({ remindOn: true, updatedAt: Date.now() });
          wx.setStorageSync('kb_remind_on', true);
          that.markTodaySubscribed(); // 开启时的授权本身就是今天的一条额度
          sync.incRemindQuota(1).then(function (q) { that.setData({ remindQuota: q }); });
          that.setData({ remindOn: true });
          wx.showModal({
            title: '提醒已开启 🎉',
            content: '记住这条规则：微信规定“每允许一次 = 只能推 1 条”。所以想每天早上都收到，就每天点一次“续订”（课表页顶部也有快捷入口，点一下 3 秒搞定）。今天这 1 条额度已经到手，明早 7 点见！',
            showCancel: false,
            confirmText: '知道了'
          });
        } else {
          that.setData({ remindOn: false });
          wx.showToast({ title: '未授权订阅', icon: 'none' });
        }
      },
      fail: function () {
        that.setData({ remindOn: false });
        wx.showToast({ title: '授权失败，稍后再试', icon: 'none' });
      }
    });
  },
  // 续订：再攒一次额度（每点一次允许 = 多一条推送额度）
  addRemindQuota: function () {
    var that = this;
    var conf = require('../../utils/cloudconf');
    var tpl = conf.REMIND_TEMPLATE_ID;
    if (!tpl) {
      wx.showToast({ title: '模板未配置', icon: 'none' });
      return;
    }
    wx.requestSubscribeMessage({
      tmplIds: [tpl],
      success: function (res) {
        if (res[tpl] === 'accept') {
          that.markTodaySubscribed();
          sync.incRemindQuota(1).then(function (q) { that.setData({ remindQuota: q }); });
          wx.showToast({ title: '已续订 1 条额度 ✓', icon: 'none' });
        } else {
          wx.showToast({ title: '未授权', icon: 'none' });
        }
      }
    });
  },

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
  },
  clearAll: function () {
    var that = this;
    this.confirmClear('一键清空', '将删除全部课表和成绩数据（设置保留，可用历史快照找回）', function () {
      // 清空前把最新数据保全进快照
      store.saveCourses(store.loadCourses());
      store.saveGrades(store.loadGrades());
      store.clearCourses();
      store.clearGrades();
      wx.showToast({ title: '已全部清空', icon: 'none' });
      that.onShow();
    });
  }
});
