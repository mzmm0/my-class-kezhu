var store = require('../../utils/store');
var dateUtil = require('../../utils/date');
var presets = require('../../utils/presets');
var sharecode = require('../../utils/sharecode');
var parseUtil = require('../../utils/parse');

// 网格尺寸（rpx）：左侧时间列 90 + 7 天 × 94 = 748
var TIME_W = 90;
var DAY_W = 94;
var CELL_H = 112;

var PALETTE = [
  '#4c84f0', '#3fbf7f', '#f0a13c', '#e8624a', '#8b6de0',
  '#38b8c4', '#e0779d', '#7cae44', '#c98a3e', '#5a9bd8'
];
var NUM_FIELDS = { dayIdx: 1, startIdx: 1, lenIdx: 1, parityIdx: 1, rangeIdx: 1, fromIdx: 1, toIdx: 1 };

function colorFor(name) {
  var h = 0;
  var s = String(name || ' ');
  for (var i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return PALETTE[h % PALETTE.length];
}

Page({
  data: {
    days: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
    todayIdx: -1,
    week: 1,
    totalWeeks: 20,
    timeCol: [],
    cells: [],
    blocks: [],
    gridHeight: 1344,
    hasCourse: false,
    todayBar: null,
    // 编辑器
    editor: false,
    editForm: null,
    dayOptions: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
    startOptions: [],
    lenOptions: ['1', '2', '3', '4', '5'],
    // 周次：范围 与 单双周 两个独立维度，可组合（如 1-13 周 × 单周）
    rangeModes: ['全部周', '自定义区间'],
    parityModes: ['每周都上', '单周', '双周'],
    weekRange: [],
    // 导入 / 分享
    importShow: false,
    importTab: 0,
    importText: '',
    helpShow: false,
    shareShow: false,
    shareCode: ''
  },

  onLoad: function () {
    var settings = store.loadSettings();
    this.setData({
      todayIdx: dateUtil.todayIndex(),
      week: dateUtil.getWeekNo(settings.semesterStart, settings.totalWeeks)
    });
    this.applySettings(settings);
  },

  onShow: function () {
    this.refresh();
    this.startTodayTimer();
  },

  onHide: function () { this.stopTodayTimer(); },
  onUnload: function () { this.stopTodayTimer(); },

  // ---------- 今日提醒条（纯本地） ----------
  startTodayTimer: function () {
    var that = this;
    this.updateTodayBar();
    if (this._todayTimer) clearInterval(this._todayTimer);
    this._todayTimer = setInterval(function () { that.updateTodayBar(); }, 30000);
  },
  stopTodayTimer: function () {
    if (this._todayTimer) {
      clearInterval(this._todayTimer);
      this._todayTimer = null;
    }
  },
  updateTodayBar: function () {
    var settings = store.loadSettings();
    var todayIdx = dateUtil.todayIndex();
    var weekNow = dateUtil.getWeekNo(settings.semesterStart, settings.totalWeeks);
    var that = this;
    var list = store.loadCourses().filter(function (c) {
      return c.day === todayIdx && parseUtil.weekVisible(c.weeks, weekNow, settings.totalWeeks);
    }).sort(function (a, b) { return a.startPeriod - b.startPeriod; });

    var bar;
    if (!list.length) {
      bar = { mode: 'free', title: '今日无课', sub: '好好休息' };
      this.setData({ todayBar: bar });
      return;
    }

    var now = new Date();
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var runningIdx = -1, nextIdx = -1;

    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var sm = dateUtil.timeToMinutes(that.periodTime(settings, c.startPeriod));
      if (sm === null) continue;
      var em = sm + (c.periods || 1) * 45;
      if (nowMin >= sm && nowMin < em) { runningIdx = i; break; }
      if (sm > nowMin) { nextIdx = i; break; }
    }

    if (runningIdx >= 0) {
      var rc = list[runningIdx];
      var rs = dateUtil.timeToMinutes(that.periodTime(settings, rc.startPeriod));
      var re = rs + (rc.periods || 1) * 45;
      bar = {
        mode: 'now',
        title: '正在上课：' + rc.name,
        sub: '剩 ' + (re - nowMin) + ' 分钟' + (rc.room ? ' · ' + rc.room : '')
      };
    } else if (nextIdx >= 0) {
      var nc = list[nextIdx];
      var ns = dateUtil.timeToMinutes(that.periodTime(settings, nc.startPeriod));
      var leftMins = ns - nowMin;
      var leftTxt = leftMins >= 60
        ? Math.floor(leftMins / 60) + ' 小时 ' + (leftMins % 60) + ' 分钟后上课'
        : leftMins + ' 分钟后上课';
      var perTxt = '第' + nc.startPeriod + (nc.periods > 1 ? '-' + (nc.startPeriod + nc.periods - 1) : '') + '节';
      var timeTxt = that.periodTime(settings, nc.startPeriod);
      bar = {
        mode: 'next',
        title: leftTxt,
        sub: nc.name + ' · ' + perTxt + ' ' + timeTxt + (nc.room ? ' · ' + nc.room : '') + ' · 今日还有 ' + (list.length - nextIdx) + ' 门'
      };
      // 打开小程序时临近上课（25 分钟内），震动提醒
      if (leftMins > 0 && leftMins <= 25 && !that._shook) {
        that._shook = true;
        wx.vibrateShort({ type: 'medium' });
      }
    } else {
      bar = { mode: 'done', title: '今日课程已结束', sub: '今天共 ' + list.length + ' 门课' };
    }
    this.setData({ todayBar: bar });
  },

  applySettings: function (settings) {
    var startOptions = [];
    var weekRange = [];
    for (var i = 1; i <= settings.periodCount; i++) startOptions.push(String(i));
    for (var j = 1; j <= settings.totalWeeks; j++) weekRange.push(String(j));
    this.setData({
      totalWeeks: settings.totalWeeks,
      startOptions: startOptions,
      weekRange: weekRange
    });
  },

  refresh: function () {
    var settings = store.loadSettings();
    this.applySettings(settings);
    var week = this.data.week;
    if (week < 1) week = 1;
    if (week > settings.totalWeeks) week = settings.totalWeeks;
    var courses = store.loadCourses();
    var grid = this.buildGrid(settings, courses, week);
    this.setData({
      week: week,
      gridHeight: grid.gridHeight,
      timeCol: grid.timeCol,
      cells: grid.cells,
      blocks: grid.blocks,
      hasCourse: courses.length > 0
    });
  },

  buildGrid: function (settings, courses, week) {
    var pc = settings.periodCount;
    var gridHeight = pc * CELL_H;
    var timeCol = [], cells = [];
    for (var p = 1; p <= pc; p++) {
      timeCol.push({
        key: 't' + p,
        no: p,
        time: this.periodTime(settings, p),
        major: p % 2 === 1,
        last: p === pc
      });
      for (var d = 1; d <= 7; d++) {
        cells.push({
          key: 'c' + d + '-' + p,
          day: d,
          period: p,
          major: p % 2 === 1,
          last: p === pc,
          left: TIME_W + (d - 1) * DAY_W,
          top: (p - 1) * CELL_H
        });
      }
    }
    var blocks = [];
    courses.forEach(function (c) {
      if (!parseUtil.weekVisible(c.weeks, week, settings.totalWeeks)) return;
      if (!c.day || !c.startPeriod || c.day < 1 || c.day > 7) return;
      if (c.startPeriod > pc) return;
      var periods = Math.min(c.periods || 1, pc - c.startPeriod + 1);
      blocks.push({
        id: c.id,
        style: 'left:' + (TIME_W + (c.day - 1) * DAY_W + 3) + 'rpx;' +
               'top:' + ((c.startPeriod - 1) * CELL_H + 3) + 'rpx;' +
               'width:' + (DAY_W - 6) + 'rpx;' +
               'height:' + (periods * CELL_H - 6) + 'rpx;' +
               'background:' + colorFor(c.name) + ';',
        name: c.name,
        room: c.room || '',
        teacher: c.teacher || ''
      });
    });
    return { timeCol: timeCol, cells: cells, blocks: blocks, gridHeight: gridHeight };
  },

  periodTime: function (settings, p) {
    return (settings.periodTimes && settings.periodTimes[p - 1]) || presets.PERIOD_TIMES[p - 1] || '';
  },

  // ---------- 周次切换 ----------
  prevWeek: function () { this.gotoWeek(this.data.week - 1); },
  nextWeek: function () { this.gotoWeek(this.data.week + 1); },
  backNow: function () {
    var s = store.loadSettings();
    this.gotoWeek(dateUtil.getWeekNo(s.semesterStart, s.totalWeeks));
  },
  gotoWeek: function (w) {
    var s = store.loadSettings();
    if (w < 1) w = 1;
    if (w > s.totalWeeks) w = s.totalWeeks;
    this.setData({ week: w });
    this.refresh();
  },

  // ---------- 课程编辑 ----------
  onCellTap: function (e) {
    var d = e.currentTarget.dataset;
    this.openEditor(null, +d.day, +d.period);
  },
  onBlockTap: function (e) {
    var id = e.currentTarget.dataset.id;
    var courses = store.loadCourses();
    var found = null;
    courses.forEach(function (c) { if (c.id === id) found = c; });
    if (found) this.openEditor(found);
  },
  openEditor: function (course, day, period) {
    var s = store.loadSettings();
    var f;
    if (course) {
      var w = course.weeks || {};
      var mode = w.mode || 'all';
      // 单双周维度：odd / even / 其他
      var parityIdx = mode === 'odd' ? 1 : (mode === 'even' ? 2 : 0);
      // 范围维度：显式 range，或区间不是整学期的 odd/even，都算自定义区间
      var rf = w.rangeFrom || 1;
      var rt = w.rangeTo || s.totalWeeks;
      var rangeIdx = (mode === 'range' || rf > 1 || rt < s.totalWeeks) ? 1 : 0;
      f = {
        id: course.id,
        name: course.name,
        teacher: course.teacher || '',
        room: course.room || '',
        dayIdx: (course.day || 1) - 1,
        startIdx: (course.startPeriod || 1) - 1,
        lenIdx: Math.min((course.periods || 1) - 1, 4),
        parityIdx: parityIdx,
        rangeIdx: rangeIdx,
        fromIdx: rf - 1,
        toIdx: rt - 1
      };
    } else {
      f = {
        id: '',
        name: '',
        teacher: '',
        room: '',
        dayIdx: (day || 1) - 1,
        startIdx: (period || 1) - 1,
        lenIdx: 1,
        parityIdx: 0,
        rangeIdx: 0,
        fromIdx: 0,
        toIdx: s.totalWeeks - 1
      };
    }
    this.setData({ editor: true, editForm: f });
  },
  noop: function () {},
  closeEditor: function () { this.setData({ editor: false }); },
  onField: function (e) {
    var k = e.currentTarget.dataset.k;
    var v = e.detail.value;
    if (NUM_FIELDS[k]) v = +v;
    var patch = {};
    patch['editForm.' + k] = v;
    this.setData(patch);
  },
  onSave: function () {
    var f = this.data.editForm;
    var name = String(f.name || '').trim();
    if (!name) {
      wx.showToast({ title: '请填写课程名', icon: 'none' });
      return;
    }
    var s = store.loadSettings();
    // 范围维度 与 单双周维度 组合成 weeks 存储
    var custom = (f.rangeIdx || 0) === 1;
    var from = custom ? (f.fromIdx || 0) + 1 : 1;
    var to = custom ? Math.min((f.toIdx || 0) + 1, s.totalWeeks) : s.totalWeeks;
    if (custom && from > to) {
      wx.showToast({ title: '周次区间起止相反', icon: 'none' });
      return;
    }
    var parity = f.parityIdx || 0; // 0 每周都上 / 1 单周 / 2 双周
    var mode = parity === 1 ? 'odd' : (parity === 2 ? 'even' : (custom ? 'range' : 'all'));
    var weeks = {
      mode: mode,
      rangeFrom: from,
      rangeTo: to
    };
    var rec = {
      id: f.id || store.genId(),
      name: name,
      teacher: String(f.teacher || '').trim(),
      room: String(f.room || '').trim(),
      day: (f.dayIdx || 0) + 1,
      startPeriod: (f.startIdx || 0) + 1,
      periods: (f.lenIdx || 0) + 1,
      weeks: weeks
    };
    var courses = store.loadCourses();
    var idx = -1;
    courses.forEach(function (c, i) { if (c.id === rec.id) idx = i; });
    if (idx >= 0) courses[idx] = rec;
    else courses.push(rec);
    store.saveCourses(courses);
    this.setData({ editor: false });
    this.refresh();
    wx.showToast({ title: '已保存', icon: 'success' });
  },
  onDelete: function () {
    var f = this.data.editForm;
    if (!f || !f.id) return;
    var that = this;
    wx.showModal({
      title: '删除课程',
      content: '确定删除「' + f.name + '」吗？',
      confirmColor: '#e64340',
      success: function (r) {
        if (!r.confirm) return;
        var courses = store.loadCourses().filter(function (c) { return c.id !== f.id; });
        store.saveCourses(courses);
        that.setData({ editor: false });
        that.refresh();
      }
    });
  },

  // ---------- 导入 ----------
  showImport: function () {
    this.setData({ importShow: true, importTab: 0, importText: '', helpShow: false });
  },
  closeImport: function () { this.setData({ importShow: false }); },
  setImportTab: function (e) {
    this.setData({ importTab: +e.currentTarget.dataset.t });
  },
  onImportText: function (e) { this.setData({ importText: e.detail.value }); },
  toggleHelp: function () { this.setData({ helpShow: !this.data.helpShow }); },
  copyTemplate: function () {
    var t = '高等数学\t周一\t1\t2\t1-16周\t教A-101\t张三\n' +
            '大学英语\t周三\t3\t2\t1-16周(双)\t教B-202\t李四\n' +
            '体育\t周五\t5\t2\t单周\t操场\t王五';
    wx.setClipboardData({ data: t });
  },
  doImport: function () {
    var text = this.data.importText || '';
    if (!text.trim()) {
      wx.showToast({ title: '请先粘贴内容', icon: 'none' });
      return;
    }
    var that = this;
    // 分享码
    if (this.data.importTab === 1) {
      var obj = sharecode.decodeShare(text);
      if (!obj || (obj.t !== 'schedule' && obj.t !== 'backup')) {
        wx.showToast({ title: '分享码无效', icon: 'none' });
        return;
      }
      var list = obj.t === 'schedule' ? (obj.d || []) : ((obj.d && obj.d.courses) || []);
      if (!list.length) {
        wx.showToast({ title: '码里没有课表数据', icon: 'none' });
        return;
      }
      store.saveCourses(list);
      this.setData({ importShow: false, importText: '' });
      this.refresh();
      wx.showToast({ title: '已导入 ' + list.length + ' 门课程', icon: 'success' });
      return;
    }
    // 粘贴文本
    var s = store.loadSettings();
    var res = parseUtil.parseScheduleText(text, s.totalWeeks);
    if (!res.ok) {
      wx.showToast({ title: res.error || '解析失败', icon: 'none' });
      return;
    }
    var old = store.loadCourses();
    var added = 0, dup = 0;
    res.courses.forEach(function (c) {
      var exist = old.some(function (o) {
        return o.name === c.name && o.day === c.day && o.startPeriod === c.startPeriod;
      });
      if (exist) { dup++; return; }
      old.push(c);
      added++;
    });
    store.saveCourses(old);
    this.setData({ importShow: false, importText: '' });
    this.refresh();
    var msg = '已导入 ' + added + ' 门课程';
    if (dup) msg += '，跳过重复 ' + dup + ' 门';
    wx.showToast({ title: msg, icon: 'none' });
  },

  // ---------- 分享 ----------
  doShare: function () {
    var courses = store.loadCourses();
    if (!courses.length) {
      wx.showToast({ title: '还没有课程', icon: 'none' });
      return;
    }
    var code = sharecode.encodeShare('schedule', courses);
    this.setData({ shareShow: true, shareCode: code });
  },
  closeShare: function () { this.setData({ shareShow: false }); },
  copyCode: function () {
    wx.setClipboardData({ data: this.data.shareCode });
  },

  onShareAppMessage: function () {
    return { title: 'My Class课助', path: '/pages/schedule/schedule' };
  }
});
