var store = require('../../utils/store');
var gpaUtil = require('../../utils/gpa');
var sharecode = require('../../utils/sharecode');
var parseUtil = require('../../utils/parse');

Page({
  data: {
    stats: { gpa: 0, avg: 0, creditSum: 0, count: 0 },
    gpaName: '',
    gpaNames: [],
    gpaIdx: 0,
    terms: [],
    // 编辑器
    editor: false,
    editForm: null,
    // 导入 / 分享
    importShow: false,
    importTab: 0,
    importText: '',
    shareShow: false,
    shareCode: ''
  },

  onShow: function () {
    this.refresh();
  },

  refresh: function () {
    var settings = store.loadSettings();
    var grades = store.loadGrades();
    var stats = gpaUtil.calcStats(grades, settings.gpaType);
    var table = gpaUtil.GPA_TABLES[settings.gpaType] || gpaUtil.GPA_TABLES['4.0std'];
    var gpaName = table.name;
    var keys = Object.keys(gpaUtil.GPA_TABLES);
    var gpaNames = keys.map(function (k) { return gpaUtil.GPA_TABLES[k].name; });
    var gpaIdx = keys.indexOf(settings.gpaType);
    if (gpaIdx < 0) gpaIdx = 0;

    var termMap = [];
    var termIndex = {};
    grades.forEach(function (g) {
      var t = g.term || '未分学期';
      if (termIndex[t] === undefined) {
        termIndex[t] = termMap.length;
        termMap.push({ name: t, list: [] });
      }
      termMap[termIndex[t]].list.push(g);
    });

    var terms = termMap.map(function (t) {
      var ts = gpaUtil.calcStats(t.list, settings.gpaType);
      var list = t.list.map(function (g) {
        return {
          id: g.id,
          name: g.name,
          credit: g.credit,
          score: g.score,
          gp: gpaUtil.scoreToGpa(g.score, settings.gpaType)
        };
      });
      return { name: t.name, list: list, stats: ts };
    });

    this.setData({ stats: stats, gpaName: gpaName, gpaNames: gpaNames, gpaIdx: gpaIdx, terms: terms });
  },

  // 快捷切换绩点制式
  onGpaChange: function (e) {
    var keys = Object.keys(gpaUtil.GPA_TABLES);
    var k = keys[+e.detail.value] || '4.0std';
    var s = store.loadSettings();
    s.gpaType = k;
    store.saveSettings(s);
    this.refresh();
    var table = gpaUtil.GPA_TABLES[k];
    wx.showToast({ title: '已切换：' + table.name, icon: 'none' });
  },

  // ---------- 成绩编辑 ----------
  onAdd: function () {
    var grades = store.loadGrades();
    var lastTerm = '';
    for (var i = grades.length - 1; i >= 0; i--) {
      if (grades[i].term) { lastTerm = grades[i].term; break; }
    }
    this.setData({
      editor: true,
      editForm: { id: '', term: lastTerm, name: '', credit: '', score: '' }
    });
  },
  onRowTap: function (e) {
    var id = e.currentTarget.dataset.id;
    var found = null;
    store.loadGrades().forEach(function (g) { if (g.id === id) found = g; });
    if (!found) return;
    this.setData({
      editor: true,
      editForm: {
        id: found.id,
        term: found.term || '',
        name: found.name,
        credit: String(found.credit),
        score: String(found.score)
      }
    });
  },
  noop: function () {},
  closeEditor: function () { this.setData({ editor: false }); },
  onField: function (e) {
    var k = e.currentTarget.dataset.k;
    var patch = {};
    patch['editForm.' + k] = e.detail.value;
    this.setData(patch);
  },
  onSave: function () {
    var f = this.data.editForm;
    var name = String(f.name || '').trim();
    var credit = parseFloat(f.credit);
    var score = String(f.score || '').trim();
    if (!name) { wx.showToast({ title: '请填写课程名', icon: 'none' }); return; }
    if (!(credit > 0)) { wx.showToast({ title: '学分需大于 0', icon: 'none' }); return; }
    if (!score) { wx.showToast({ title: '请填写成绩', icon: 'none' }); return; }
    var grades = store.loadGrades();
    var rec = {
      id: f.id || store.genId(),
      name: name,
      credit: credit,
      score: score,
      term: String(f.term || '').trim()
    };
    var idx = -1;
    grades.forEach(function (g, i) { if (g.id === rec.id) idx = i; });
    if (idx >= 0) grades[idx] = rec;
    else grades.push(rec);
    store.saveGrades(grades);
    this.setData({ editor: false });
    this.refresh();
    wx.showToast({ title: '已保存', icon: 'success' });
  },
  onDelete: function () {
    var f = this.data.editForm;
    if (!f || !f.id) return;
    var that = this;
    wx.showModal({
      title: '删除成绩',
      content: '确定删除「' + f.name + '」吗？',
      confirmColor: '#e64340',
      success: function (r) {
        if (!r.confirm) return;
        var grades = store.loadGrades().filter(function (g) { return g.id !== f.id; });
        store.saveGrades(grades);
        that.setData({ editor: false });
        that.refresh();
      }
    });
  },

  // ---------- 导入 ----------
  showImport: function () {
    this.setData({ importShow: true, importTab: 0, importText: '' });
  },
  closeImport: function () { this.setData({ importShow: false }); },
  setImportTab: function (e) {
    this.setData({ importTab: +e.currentTarget.dataset.t });
  },
  onImportText: function (e) { this.setData({ importText: e.detail.value }); },
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
      if (!obj || (obj.t !== 'grades' && obj.t !== 'backup')) {
        wx.showToast({ title: '分享码无效', icon: 'none' });
        return;
      }
      var list = obj.t === 'grades' ? (obj.d || []) : ((obj.d && obj.d.grades) || []);
      if (!list.length) {
        wx.showToast({ title: '码里没有成绩数据', icon: 'none' });
        return;
      }
      store.saveGrades(list);
      this.setData({ importShow: false, importText: '' });
      this.refresh();
      wx.showToast({ title: '已导入 ' + list.length + ' 门成绩', icon: 'success' });
      return;
    }
    // 粘贴文本
    var res = parseUtil.parseGradesText(text);
    if (!res.ok) {
      wx.showToast({ title: res.error || '解析失败', icon: 'none' });
      return;
    }
    var old = store.loadGrades();
    var added = 0, dup = 0;
    res.grades.forEach(function (g) {
      var exist = old.some(function (o) {
        return o.name === g.name && (o.term || '') === (g.term || '');
      });
      if (exist) { dup++; return; }
      old.push(g);
      added++;
    });
    store.saveGrades(old);
    this.setData({ importShow: false, importText: '' });
    this.refresh();
    var msg = '已导入 ' + added + ' 门成绩';
    if (dup) msg += '，跳过重复 ' + dup + ' 门';
    wx.showToast({ title: msg, icon: 'none' });
  },

  // ---------- 分享 ----------
  doShare: function () {
    var grades = store.loadGrades();
    if (!grades.length) {
      wx.showToast({ title: '还没有成绩', icon: 'none' });
      return;
    }
    var code = sharecode.encodeShare('grades', grades);
    this.setData({ shareShow: true, shareCode: code });
  },
  closeShare: function () { this.setData({ shareShow: false }); },
  copyCode: function () {
    wx.setClipboardData({ data: this.data.shareCode });
  },

  onShareAppMessage: function () {
    return { title: 'My Class课助', path: '/pages/gpa/gpa' };
  }
});
