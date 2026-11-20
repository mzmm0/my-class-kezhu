var store = require('../../utils/store');
var dateUtil = require('../../utils/date');
var presets = require('../../utils/presets');
var sharecode = require('../../utils/sharecode');
var parseUtil = require('../../utils/parse');
var ocrParse = require('../../utils/ocrparse');
var sync = require('../../utils/sync');

// 网格尺寸（rpx）：左侧时间列 90 + 7 天 × 94 = 748
var TIME_W = 90;
var DAY_W = 94;
var CELL_H = 112;

// 导出图片：画布按 1.5 倍像素绘制，保证发出去不糊
var EXPORT_SCALE = 1.5;
var EXPORT_CELL_H = 96; // 导出图里每节课的高度（rpx）

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

// 非本周课程的角标文案：已结课 / 还没开始 / 单双周
function blockTag(weeks, week, totalWeeks) {
  var w = weeks || {};
  var from = w.rangeFrom || 1;
  var to = w.rangeTo || (totalWeeks || 20);
  if (week > to) return '已结课';
  if (week < from) return '第' + from + '周起';
  if (w.mode === 'odd') return '单周';
  if (w.mode === 'even') return '双周';
  return '非本周';
}

// canvas 圆角矩形路径
function roundRect(ctx, x, y, w, h, r) {
  var rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arc(x + w - rr, y + rr, rr, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arc(x + w - rr, y + h - rr, rr, 0, Math.PI / 2);
  ctx.lineTo(x + rr, y + h);
  ctx.arc(x + rr, y + h - rr, rr, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + rr);
  ctx.arc(x + rr, y + rr, rr, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

// 按宽度折行，超出 maxLines 用省略号收尾
function wrapLines(ctx, text, maxWidth, maxLines) {
  var s = String(text == null ? '' : text);
  var lines = [];
  var cur = '';
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i);
    if (ctx.measureText(cur + ch).width > maxWidth && cur) {
      lines.push(cur);
      cur = ch;
      if (lines.length >= maxLines) break;
    } else {
      cur += ch;
    }
  }
  var truncated = lines.length >= maxLines && lines.join('').length < s.length;
  if (lines.length < maxLines && cur) lines.push(cur);
  if (truncated && lines.length) {
    var last = lines[lines.length - 1];
    while (last.length > 1 && ctx.measureText(last + '…').width > maxWidth) {
      last = last.slice(0, -1);
    }
    lines[lines.length - 1] = last + '…';
  }
  return lines;
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
    shareCode: '',
    // 截图识别
    ocrImagePath: '',
    ocrStatus: '',
    ocrPreviewShow: false,
    ocrCourses: [],
    ocrWarnings: [],
    // 导出图片用的离屏画布尺寸（px）
    exportW: 375,
    exportH: 800
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
    this.checkLoss();
  },

  // ---------- 数据丢失检测 ----------
  // 场景：误点清空 / 清缓存 / 版本更新异常导致课表成绩全空，但历史快照还在
  checkLoss: function () {
    var loss = store.detectLoss();
    if (!loss) return;
    var that = this;
    var d = new Date(loss.latest.t);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    var timeText = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    wx.showModal({
      title: '发现历史备份',
      content: '当前课表为空，但存在 ' + timeText + ' 的自动备份（' + ((loss.latest.c && loss.latest.c.length) || 0) + ' 门课程）。要恢复吗？',
      confirmText: '恢复',
      cancelText: '暂不',
      success: function (r) {
        if (!r.confirm) return;
        store.restoreSnapshot(0);
        that.refresh();
        wx.showToast({ title: '已恢复', icon: 'success' });
      }
    });
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
    var dimBlocks = [];
    courses.forEach(function (c) {
      if (!c.day || !c.startPeriod || c.day < 1 || c.day > 7) return;
      if (c.startPeriod > pc) return;
      var visible = parseUtil.weekVisible(c.weeks, week, settings.totalWeeks);
      var periods = Math.min(c.periods || 1, pc - c.startPeriod + 1);
      var geo = 'left:' + (TIME_W + (c.day - 1) * DAY_W + 3) + 'rpx;' +
                'top:' + ((c.startPeriod - 1) * CELL_H + 3) + 'rpx;' +
                'width:' + (DAY_W - 6) + 'rpx;' +
                'height:' + (periods * CELL_H - 6) + 'rpx;';
      var block = {
        id: c.id,
        style: geo + 'background:' + colorFor(c.name) + ';',
        name: c.name,
        room: c.room || '',
        teacher: c.teacher || '',
        dim: false,
        tag: ''
      };
      if (!visible) {
        // 非本周的课保留位置但置灰，避免"课突然消失"
        block.style = geo;
        block.dim = true;
        block.tag = blockTag(c.weeks, week, settings.totalWeeks);
        dimBlocks.push(block);
      } else {
        blocks.push(block);
      }
    });
    // 置灰的排在前面，本周的压在上面
    blocks = dimBlocks.concat(blocks);
    return { timeCol: timeCol, cells: cells, blocks: blocks, gridHeight: gridHeight };
  },

  periodTime: function (settings, p) {
    return (settings.periodTimes && settings.periodTimes[p - 1]) || presets.PERIOD_TIMES[p - 1] || '';
  },

  // ---------- 导出课表图片 ----------
  exportImage: function () {
    var courses = store.loadCourses();
    if (!courses.length) {
      wx.showToast({ title: '还没有课程', icon: 'none' });
      return;
    }
    var s = store.loadSettings();
    var pc = s.periodCount || 12;
    var rpxH = 156 + pc * EXPORT_CELL_H + 60;
    var that = this;
    wx.showLoading({ title: '生成中', mask: true });
    this.setData({
      exportW: Math.round(750 * EXPORT_SCALE),
      exportH: Math.round(rpxH * EXPORT_SCALE)
    }, function () {
      // 等画布完成布局后再绘制
      setTimeout(function () { that.paintExport(); }, 100);
    });
  },

  paintExport: function () {
    var that = this;
    var s = store.loadSettings();
    var pc = s.periodCount || 12;
    var week = this.data.week;
    var courses = store.loadCourses();
    var K = EXPORT_SCALE;
    var W = 750 * K;
    var HW = 100 * K;              // 顶栏高度
    var DH = 56 * K;               // 星期栏高度
    var CH = EXPORT_CELL_H * K;    // 每节课高度
    var TW = 120 * K;              // 时间列宽
    var DW = 90 * K;               // 每天列宽
    var y0 = HW + DH;
    var H = y0 + pc * CH + 60 * K;
    var ctx = wx.createCanvasContext('exportCanvas', this);

    ctx.setFillStyle('#ffffff');
    ctx.fillRect(0, 0, W, H);

    // 顶栏 + 星期栏通铺品牌蓝
    ctx.setFillStyle('#2f6fed');
    ctx.fillRect(0, 0, W, y0);
    ctx.setTextBaseline('middle');
    ctx.setTextAlign('left');
    ctx.setFillStyle('#ffffff');
    ctx.setFontSize(34 * K);
    ctx.fillText('第 ' + week + ' 周课表', 28 * K, HW / 2);
    ctx.setTextAlign('right');
    ctx.setGlobalAlpha(0.85);
    ctx.setFontSize(20 * K);
    ctx.fillText('My Class课助', W - 28 * K, HW / 2);
    ctx.setGlobalAlpha(1);

    // 星期 + 日期
    var start = dateUtil.parseDate(s.semesterStart);
    var monday = start ? new Date(start.getTime() + (week - 1) * 604800000) : null;
    var days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    ctx.setTextAlign('center');
    for (var d = 0; d < 7; d++) {
      var cx = TW + DW * d + DW / 2;
      ctx.setFillStyle('#ffffff');
      ctx.setFontSize(22 * K);
      ctx.fillText(days[d], cx, HW + 18 * K);
      if (monday) {
        var dt = new Date(monday.getTime() + d * 86400000);
        ctx.setFillStyle('rgba(255,255,255,0.72)');
        ctx.setFontSize(15 * K);
        ctx.fillText((dt.getMonth() + 1) + '/' + dt.getDate(), cx, HW + 41 * K);
      }
    }

    // 隔行底色
    ctx.setFillStyle('#fafbfd');
    for (var p = 1; p < pc; p += 2) {
      ctx.fillRect(TW, y0 + p * CH, W - TW, CH);
    }

    // 横线：每两节一条粗线
    for (var r = 0; r <= pc; r++) {
      var ly = y0 + r * CH;
      var major = r % 2 === 0;
      ctx.setStrokeStyle(major ? '#c7ccd6' : '#e8eaf0');
      ctx.setLineWidth(major ? 2 : 1);
      ctx.beginPath();
      ctx.moveTo(0, ly);
      ctx.lineTo(W, ly);
      ctx.stroke();
    }
    // 竖线
    ctx.setStrokeStyle('#e8eaf0');
    ctx.setLineWidth(1);
    for (var v = 0; v <= 7; v++) {
      var lx = TW + v * DW;
      ctx.beginPath();
      ctx.moveTo(lx, y0);
      ctx.lineTo(lx, y0 + pc * CH);
      ctx.stroke();
    }

    // 时间列
    for (var q = 1; q <= pc; q++) {
      var cy = y0 + (q - 1) * CH + CH / 2;
      ctx.setTextAlign('center');
      ctx.setFillStyle('#6b7280');
      ctx.setFontSize(19 * K);
      ctx.fillText('第' + q + '节', TW / 2, cy - 9 * K);
      var t = (s.periodTimes && s.periodTimes[q - 1]) || presets.PERIOD_TIMES[q - 1] || '';
      if (t) {
        ctx.setFillStyle('#a7adb8');
        ctx.setFontSize(15 * K);
        ctx.fillText(t, TW / 2, cy + 12 * K);
      }
    }

    // 课程块（只画本周要上的课，和时间轴一致）
    courses.forEach(function (c) {
      if (!parseUtil.weekVisible(c.weeks, week, s.totalWeeks)) return;
      if (!c.day || c.day < 1 || c.day > 7) return;
      if (!c.startPeriod || c.startPeriod > pc) return;
      var periods = Math.min(c.periods || 1, pc - c.startPeriod + 1);
      var bx = TW + (c.day - 1) * DW + 3 * K;
      var by = y0 + (c.startPeriod - 1) * CH + 3 * K;
      var bw = DW - 6 * K;
      var bh = periods * CH - 6 * K;
      var pad = 8 * K;
      var innerW = bw - pad * 2;
      var lh = 24 * K;      // 课程名行高
      var slh = 21 * K;     // 教室/老师行高

      ctx.setFillStyle(colorFor(c.name));
      roundRect(ctx, bx, by, bw, bh, 8 * K);
      ctx.fill();

      // 按块高决定能塞几行课程名（1 节的短块也能放下 3 行）
      var avail = bh - pad * 2;
      var maxName = Math.max(1, Math.min(3, Math.floor(avail / lh)));
      // 关键：先设好字号再量文字宽度，否则折行会算错
      ctx.setFontSize(19 * K);
      var lines = wrapLines(ctx, c.name, innerW, maxName);
      var nameH = lines.length * lh;

      // 剩下的空间才放教室、老师
      var subs = [];
      if (c.room) subs.push(c.room);
      if (c.teacher) subs.push(c.teacher);
      var maxSubs = Math.max(0, Math.floor((avail - nameH) / slh));
      subs = subs.slice(0, maxSubs);
      var totalH = nameH + subs.length * slh;

      // 空间富余时整体垂直居中，避免大字块顶部堆字、下面一大片空白
      var ty = by + pad;
      if (bh - totalH > pad * 3) ty = by + (bh - totalH) / 2;

      ctx.setTextAlign('left');
      ctx.setTextBaseline('top');
      ctx.setFillStyle('#ffffff');
      ctx.setFontSize(19 * K);
      for (var i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], bx + pad, ty);
        ty += lh;
      }

      ctx.setGlobalAlpha(0.9);
      ctx.setFontSize(16 * K);
      for (var j = 0; j < subs.length; j++) {
        ctx.fillText(wrapLines(ctx, subs[j], innerW, 1)[0] || '', bx + pad, ty + 1 * K);
        ty += slh;
      }
      ctx.setGlobalAlpha(1);
    });

    // 底部说明
    ctx.setTextAlign('center');
    ctx.setTextBaseline('middle');
    ctx.setFillStyle('#9aa2ae');
    ctx.setFontSize(18 * K);
    ctx.fillText('数据仅存本机 · ' + (s.semesterStart || '') + ' 起 · 共 ' + s.totalWeeks + ' 周',
      W / 2, y0 + pc * CH + 30 * K);

    ctx.draw(false, function () {
      wx.canvasToTempFilePath({
        canvasId: 'exportCanvas',
        x: 0,
        y: 0,
        width: W,
        height: H,
        destWidth: W,
        destHeight: H,
        success: function (res) {
          wx.hideLoading();
          that.saveOrPreview(res.tempFilePath);
        },
        fail: function () {
          wx.hideLoading();
          wx.showToast({ title: '生成失败，请重试', icon: 'none' });
        }
      }, that);
    });
  },

  saveOrPreview: function (path) {
    wx.saveImageToPhotosAlbum({
      filePath: path,
      success: function () {
        wx.showToast({ title: '已保存到相册', icon: 'success' });
      },
      fail: function (err) {
        var msg = (err && err.errMsg) || '';
        if (msg.indexOf('auth') > -1 || msg.indexOf('deny') > -1) {
          wx.showModal({
            title: '需要相册权限',
            content: '保存课表图片需要「保存到相册」权限，去设置里打开吗？',
            success: function (r) { if (r.confirm) wx.openSetting(); }
          });
        } else {
          // 其它失败（如开发者工具里不支持）直接预览，可长按保存
          wx.previewImage({ urls: [path] });
        }
      }
    });
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

  // ---------- 截图识别导入 ----------
  chooseOcrImage: function () {
    var that = this;
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed', 'original'],
      sourceType: ['album', 'camera'],
      success: function (res) {
        that.setData({ ocrImagePath: res.tempFilePaths[0], ocrStatus: '' });
      }
    });
  },
  startOcr: function () {
    var that = this;
    var path = this.data.ocrImagePath;
    if (!path) {
      wx.showToast({ title: '请先选择课表截图', icon: 'none' });
      return;
    }
    if (!wx.cloud) {
      wx.showToast({ title: '当前环境不支持云函数', icon: 'none' });
      return;
    }
    this.setData({ ocrStatus: '上传截图并识别中，请稍候...' });
    // 1) 上传到云存储
    var ext = path.indexOf('.') > -1 ? path.slice(path.lastIndexOf('.')) : '.jpg';
    var cloudPath = 'ocr/' + Date.now() + (Math.random() * 100000).toFixed(0) + ext;
    wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: path,
      success: function (up) {
        // 2) 调云函数识别
        wx.cloud.callFunction({
          name: 'ocrTable',
          data: { fileID: up.fileID },
          success: function (cf) {
            var r = cf.result || {};
            if (!r.ok) {
              that.setData({ ocrStatus: '' });
              wx.showModal({ title: '识别失败', content: r.error || '请重试或换一张更清晰的截图', showCancel: false });
              return;
            }
            // 3) 解析为课程：优先用坐标对齐算法（云函数返回 points），
            //    无 points（表格引擎路径）时退回网格解析
            var settings = store.loadSettings();
            var pr = null;
            if (r.points && r.points.length) {
              pr = ocrParse.parseByPoints(r.points, settings.totalWeeks);
            }
            if (!pr || !pr.ok) {
              var grid = ocrParse.toGrid(r.rows || r.cells);
              if (grid) pr = ocrParse.parseGrid(grid, settings.totalWeeks);
            }
            if (!pr || !pr.ok) {
              that.setData({ ocrStatus: '' });
              // 调试输出（定位坐标字段后移除）
              console.log('===OCR DEBUG=== engine:', r.engine, 'points:', r.points && r.points.slice(0, 3), 'debugCell:', r.debugCell);
              wx.showModal({
                title: '解析失败',
                content: (pr && pr.error) || '识别到内容但未能解析出课程，请核对截图是教务课表（需包含星期表头与第X节行头）',
                showCancel: false
              });
              return;
            }
            // 4) 进预览列表
            var dayNames = ['', '一', '二', '三', '四', '五', '六', '日'];
            var list = pr.courses.map(function (c) {
              var w = c.weeks || {};
              var wtxt = (w.rangeFrom === 1 && w.rangeTo === 20) ? '全学期' : (w.rangeFrom + '-' + w.rangeTo + '周');
              if (w.mode === 'odd') wtxt += '·单周';
              if (w.mode === 'even') wtxt += '·双周';
              return {
                key: c.id,
                name: c.name,
                teacher: c.teacher,
                room: c.room,
                day: c.day,
                dayName: dayNames[c.day] || c.day,
                startPeriod: c.startPeriod,
                endPeriod: c.startPeriod + c.periods - 1,
                periods: c.periods,
                weeks: c.weeks,
                weeksText: wtxt
              };
            });
            that.setData({
              ocrStatus: '',
              importShow: false,
              ocrPreviewShow: true,
              ocrCourses: list,
              ocrWarnings: pr.warnings.slice(0, 3)
            });
          },
          fail: function (err) {
            that.setData({ ocrStatus: '' });
            wx.showModal({ title: '云函数调用失败', content: (err.errMsg || '请检查云函数 ocrTable 是否已部署') , showCancel: false });
          }
        });
      },
      fail: function (err) {
        that.setData({ ocrStatus: '' });
        wx.showModal({ title: '上传失败', content: err.errMsg || '网络异常，请重试', showCancel: false });
      }
    });
  },
  removeOcrCourse: function (e) {
    var idx = +e.currentTarget.dataset.idx;
    var list = this.data.ocrCourses.slice();
    if (idx >= 0 && idx < list.length) list.splice(idx, 1);
    this.setData({ ocrCourses: list });
  },

  // ---------- OCR 预览条目编辑 ----------
  editOcrCourse: function (e) {
    var idx = +e.currentTarget.dataset.idx;
    var c = this.data.ocrCourses[idx];
    if (!c) return;
    var lenIdx = Math.max(0, (c.periods || 2) - 1);
    this.setData({
      ocrEditShow: true,
      ocrEditIdx: idx,
      ocrEdit: {
        name: c.name,
        teacher: c.teacher,
        room: c.room,
        weeksText: c.weeksText,
        dayIdx: c.day - 1,
        lenIdx: Math.min(lenIdx, this.data.lenOptions.length - 1)
      }
    });
  },
  closeOcrEdit: function () { this.setData({ ocrEditShow: false }); },
  onOcrEditField: function (e) {
    var k = e.currentTarget.dataset.k;
    var patch = {};
    patch['ocrEdit.' + k] = (k === 'dayIdx' || k === 'lenIdx') ? +e.detail.value : e.detail.value;
    this.setData(patch);
  },
  saveOcrEdit: function () {
    var idx = this.data.ocrEditIdx;
    var ed = this.data.ocrEdit;
    var list = this.data.ocrCourses.slice();
    var c = list[idx];
    if (!c) return;
    // 周次文本 -> weeks 对象
    var wk = parseUtil.parseWeeks(ed.weeksText, this.data.totalWeeks || 20);
    c.name = ed.name;
    c.teacher = ed.teacher;
    c.room = ed.room;
    c.day = ed.dayIdx + 1;
    c.dayName = '一二三四五六日'.charAt(ed.dayIdx) ;
    c.periods = ed.lenIdx + 1;
    c.endPeriod = c.startPeriod + c.periods - 1;
    c.weeks = wk;
    var all = wk.rangeFrom === 1 && wk.rangeTo === (this.data.totalWeeks || 20);
    var wtxt = all ? '全学期' : (wk.rangeFrom + '-' + wk.rangeTo + '周');
    if (wk.mode === 'odd') wtxt += '·单周';
    if (wk.mode === 'even') wtxt += '·双周';
    c.weeksText = wtxt;
    list[idx] = c;
    this.setData({ ocrCourses: list, ocrEditShow: false });
  },
  closeOcrPreview: function () {
    this.setData({ ocrPreviewShow: false });
  },
  reOcr: function () {
    this.setData({ ocrPreviewShow: false, importShow: true, importTab: 2 });
  },
  confirmOcrImport: function () {
    var list = this.data.ocrCourses;
    if (!list.length) {
      wx.showToast({ title: '没有可导入的课程', icon: 'none' });
      return;
    }
    var old = store.loadCourses();
    var added = 0, dup = 0;
    list.forEach(function (c) {
      var exist = old.some(function (o) {
        return o.name === c.name && o.day === c.day && o.startPeriod === c.startPeriod;
      });
      if (exist) { dup++; return; }
      old.push({
        id: store.genId(),
        name: c.name,
        teacher: c.teacher || '',
        room: c.room || '',
        day: c.day,
        startPeriod: c.startPeriod,
        periods: c.periods || 2,
        weeks: c.weeks || { rangeFrom: 1, rangeTo: 20, mode: 'all' }
      });
      added++;
    });
    store.saveCourses(old);
    this.setData({ ocrPreviewShow: false, ocrCourses: [] });
    this.refresh();
    var msg = '已导入 ' + added + ' 门课程';
    if (dup) msg += '，跳过重复 ' + dup + ' 门';
    wx.showToast({ title: msg, icon: 'none' });
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
  // ---------- 一键全部保存 ----------
  // 批量重存所有课程：触发快照、云同步、完整重渲染。
  // 用于"显示状态不对"（变灰失效/错位残留）时的强制刷新兜底
  saveAllCourses: function () {
    var courses = store.loadCourses();
    if (!courses.length) {
      wx.showToast({ title: '课表为空', icon: 'none' });
      return;
    }
    // 规范化周次数据（确保 weeks 字段完整：mode/rangeFrom/rangeTo）
    courses.forEach(function (c) {
      if (!c.weeks || typeof c.weeks !== 'object') {
        c.weeks = { mode: 'all', rangeFrom: 1, rangeTo: 20 };
      }
      if (c.weeks.rangeFrom === undefined) c.weeks.rangeFrom = 1;
      if (c.weeks.rangeTo === undefined) c.weeks.rangeTo = 20;
      if (!c.weeks.mode) c.weeks.mode = 'all';
    });
    store.saveCourses(courses); // 触发快照 + 云端同步
    this.refresh();
    wx.showToast({ title: '已保存全部 ' + courses.length + ' 门课程', icon: 'success' });
  },

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
