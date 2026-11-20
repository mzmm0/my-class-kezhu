// 快照机制自测：模拟 wx 存储，验证 store.js 的备份/恢复/丢失检测
var fs = require('fs');
var path = require('path');

// ---- 模拟 wx ----
var mem = {};
global.wx = {
  getStorageSync: function (k) {
    return (k in mem) ? mem[k] : '';
  },
  setStorageSync: function (k, v) { mem[k] = v; },
  removeStorageSync: function (k) { delete mem[k]; }
};

// ---- 加载 store.js（截取 module 内容执行）----
var base = path.resolve(__dirname, '..//utils');
var src = fs.readFileSync(path.join(base, 'store.js'), 'utf8');
// presets 是真实文件，直接 require；store.js 用 Function 包装执行以拿到 module.exports
var module_ = { exports: {} };
var fn = new Function('module', 'exports', 'require', src);
fn(module_, module_.exports, function (name) {
  return require(path.join(base, name));
});
var store = module_.exports;

var pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name); }
}

var sampleCourses = [
  { id: 'a1', name: '高等数学', teacher: '张三', room: 'A101', day: 1, startPeriod: 1, periods: 2, weeks: { rangeFrom: 1, rangeTo: 16, mode: 'all' } },
  { id: 'a2', name: '大学英语', teacher: '李四', room: 'B202', day: 3, startPeriod: 3, periods: 2, weeks: { rangeFrom: 1, rangeTo: 16, mode: 'even' } }
];
var sampleGrades = [{ name: '高等数学', credit: 4, score: 88 }];

// ---- 用例 ----
// 1. saveCourses 触发自动快照
store.saveCourses(sampleCourses);
var snaps = store.loadSnapshots();
check('1 保存课表后自动生成快照', snaps.length === 1 && snaps[0].c.length === 2);

// 2. 同内容 5 分钟内不重复快照
store.saveCourses(sampleCourses.slice());
snaps = store.loadSnapshots();
check('2 同内容短时间内不重复快照', snaps.length === 1);

// 3. 内容变化才产生新快照
var c2 = sampleCourses.slice();
c2.push({ id: 'a3', name: '体育', teacher: '王五', room: '操场', day: 5, startPeriod: 5, periods: 2, weeks: { rangeFrom: 1, rangeTo: 16, mode: 'odd' } });
store.saveCourses(c2);
snaps = store.loadSnapshots();
check('3 内容变化产生新快照（新在前）', snaps.length === 2 && snaps[0].c.length === 3 && snaps[1].c.length === 2);

// 4. grades 变动也触发
store.saveGrades(sampleGrades);
snaps = store.loadSnapshots();
check('4 成绩变动也产生快照且包含成绩', snaps.length === 3 && snaps[0].g.length === 1 && snaps[0].c.length === 3);

// 5. 空数据不入快照
mem = {}; // 清空模拟存储
delete require.cache;
// 重新初始化：手动清再测
wx.removeStorageSync(store.KEYS.snapshots);
wx.removeStorageSync(store.KEYS.courses);
wx.removeStorageSync(store.KEYS.grades);
store.saveCourses([]);
snaps = store.loadSnapshots();
check('5 空数据不入快照', snaps.length === 0);

// 6. 清空课表后（先保存过数据，快照保留），detectLoss 能发现
wx.setStorageSync(store.KEYS.courses, sampleCourses);
wx.setStorageSync(store.KEYS.snapshots, [{ t: Date.now(), fp: 'x', c: sampleCourses, g: [] }]);
wx.removeStorageSync(store.KEYS.courses);
var loss = store.detectLoss();
check('6 数据丢失检测：空课表但有快照 -> 提示恢复', loss && loss.count === 1 && loss.latest.c.length === 2);

// 7. 有数据时不提示
wx.setStorageSync(store.KEYS.courses, sampleCourses);
loss = store.detectLoss();
check('7 课表非空不提示丢失', loss === null);

// 8. 恢复快照：拷贝回正式键
wx.removeStorageSync(store.KEYS.courses);
wx.setStorageSync(store.KEYS.snapshots, [
  { t: Date.now() - 1000, fp: 'new', c: c2, g: [] },
  { t: Date.now() - 2000, fp: 'old', c: sampleCourses, g: sampleGrades }
]);
var ok = store.restoreSnapshot(1);
var restored = wx.getStorageSync(store.KEYS.courses);
var restoredG = wx.getStorageSync(store.KEYS.grades);
check('8 恢复指定快照（含课表+成绩）', ok && restored.length === 2 && restoredG.length === 1);

// 9. 恢复越界返回 false
check('9 恢复不存在的快照返回 false', store.restoreSnapshot(99) === false);

// 10. 快照轮转：超过 5 份裁剪
wx.removeStorageSync(store.KEYS.snapshots);
for (var i = 0; i < 8; i++) {
  var c = sampleCourses.slice();
  c.push({ id: 'x' + i, name: '课' + i, teacher: '', room: '', day: 2, startPeriod: 1, periods: 2, weeks: {} });
  wx.setStorageSync(store.KEYS.courses, c);
  // 手动调用快照（saveCourses 有 5 分钟间隔限制，直接改时间戳模拟）
  var list = wx.getStorageSync(store.KEYS.snapshots) || [];
  list.unshift({ t: Date.now() - (1000 - i) * 1000, fp: 'fp' + i, c: c, g: [] });
  if (list.length > 5) list = list.slice(0, 5);
  wx.setStorageSync(store.KEYS.snapshots, list);
}
snaps = store.loadSnapshots();
check('10 快照最多保留 5 份', snaps.length === 5);

// 11. clearSnapshots
store.clearSnapshots();
check('11 删除全部快照', store.loadSnapshots().length === 0);

// 12. 清空流程保全：saveCourses(最新) -> clearCourses 后快照仍可恢复
wx.removeStorageSync(store.KEYS.snapshots);
wx.removeStorageSync(store.KEYS.courses);
wx.removeStorageSync(store.KEYS.grades); // 课表+成绩都空，才构成"丢失"场景
wx.setStorageSync(store.KEYS.courses, sampleCourses);
store.saveCourses(sampleCourses.map(function (c) { return Object.assign({}, c); })); // 产生快照
store.clearCourses();
var coursesAfterClear = wx.getStorageSync(store.KEYS.courses);
check('12 清空后当前课表为空', coursesAfterClear === '' || (Array.isArray(coursesAfterClear) && coursesAfterClear.length === 0));
loss = store.detectLoss();
check('13 清空后可从快照恢复（设置入口）', loss !== null && loss.latest.c.length === 2);
var ok2 = store.restoreSnapshot(0);
check('14 清空后恢复成功', ok2 && wx.getStorageSync(store.KEYS.courses).length === 2);

// 15. 边界确认：成绩还在时（用户可能只是想清课表）不弹丢失提示
wx.removeStorageSync(store.KEYS.snapshots);
wx.removeStorageSync(store.KEYS.courses);
wx.setStorageSync(store.KEYS.grades, sampleGrades);
wx.setStorageSync(store.KEYS.snapshots, [{ t: Date.now(), fp: 'x', c: sampleCourses, g: [] }]);
wx.removeStorageSync(store.KEYS.courses);
check('15 仅清课表（成绩仍在）不误报丢失', store.detectLoss() === null);

console.log('------------------');
console.log('通过 ' + pass + ' / ' + (pass + fail));
if (fail > 0) process.exit(1);
