// 小程序工具模块逻辑自测（node 环境跑，不依赖 wx）
const path = require('path');
const proj = path.join(__dirname, '..', 'utils');
const gpa = require(path.join(proj, 'gpa.js'));
const parse = require(path.join(proj, 'parse.js'));
const sharecode = require(path.join(proj, 'sharecode.js'));
const dateUtil = require(path.join(proj, 'date.js'));

let pass = 0, fail = 0;
function eq(actual, expect, label) {
  const a = JSON.stringify(actual), b = JSON.stringify(expect);
  if (a === b) { pass++; console.log('PASS', label, '=>', a); }
  else { fail++; console.log('FAIL', label, '\n  expect:', b, '\n  actual:', a); }
}

// ---- GPA ----
eq(gpa.scoreToGpa(92, '4.0std'), 4.0, 'scoreToGpa 92 4.0std');
eq(gpa.scoreToGpa(85, '4.0std'), 3.7, 'scoreToGpa 85 4.0std');
eq(gpa.scoreToGpa(59, '4.0std'), 0, 'scoreToGpa 59 4.0std');
eq(gpa.scoreToGpa('优', '4.0std'), 4.0, 'scoreToGpa 优');
eq(gpa.scoreToGpa('良好', '4.0std'), 3.7, 'scoreToGpa 良好');
eq(gpa.scoreToGpa('xyz', '4.0std'), null, 'scoreToGpa 非法');
const stats = gpa.calcStats([
  { name: 'A', credit: 4, score: 92 },
  { name: 'B', credit: 2, score: 80 },
  { name: 'C', credit: 2, score: '良好' }
], '4.0std');
// GPA: (4*4.0 + 2*3.0 + 2*3.7) / 8 = (16+6+7.4)/8 = 3.675 -> 3.68
eq(stats.gpa, 3.68, 'calcStats gpa');
// 均分只算数字分：(4*92+2*80)/6 = (368+160)/6 = 88
eq(stats.avg, 88, 'calcStats avg');
eq(stats.creditSum, 8, 'calcStats creditSum');

// ---- 周次 ----
eq(dateUtil.getWeekNo('2026-09-07', 20), dateUtil.getWeekNo('2026-09-07', 20), 'getWeekNo 稳定');
eq(dateUtil.parseDate('2026-09-07').getFullYear(), 2026, 'parseDate');
eq(dateUtil.todayIndex() >= 1 && dateUtil.todayIndex() <= 7, true, 'todayIndex 范围');
eq(dateUtil.addMinutes('08:45', 45), '09:30', 'addMinutes 跨小时');
eq(dateUtil.addMinutes('10:50', 45), '11:35', 'addMinutes 10:50');
eq(dateUtil.addMinutes('19:45', 45), '20:30', 'addMinutes 晚课');
eq(dateUtil.addMinutes('23:30', 45), '00:15', 'addMinutes 跨天');
eq(dateUtil.addMinutes('', 45), '', 'addMinutes 非法输入');
eq(dateUtil.timeToMinutes('08:00'), 480, 'timeToMinutes 08:00');
eq(dateUtil.timeToMinutes('16:05'), 965, 'timeToMinutes 16:05');
eq(dateUtil.timeToMinutes('23:59'), 1439, 'timeToMinutes 23:59');
eq(dateUtil.timeToMinutes('abc'), null, 'timeToMinutes 非法');

// ---- 分享码 ----
const payload = { name: '高等数学', day: 1 };
const code = sharecode.encodeShare('schedule', [payload]);
eq(code.startsWith('KBQ1:'), true, 'encodeShare 前缀');
const back = sharecode.decodeShare(code);
eq(back.t, 'schedule', 'decodeShare type');
eq(back.d[0].name, '高等数学', 'decodeShare 中文无乱码');
eq(sharecode.decodeShare('垃圾输入'), null, 'decodeShare 非法输入');

// ---- 课表：行模板模式 ----
const tpl = [
  '高等数学\t周一\t1\t2\t1-16周\t教A-101\t张三',
  '大学英语\t周三\t3\t2\t1-16周(双)\t教B-202\t李四',
  '体育\t周五\t5\t2\t单周\t操场\t王五'
].join('\n');
const r1 = parse.parseScheduleText(tpl, 20);
eq(r1.ok, true, '行模板 ok');
eq(r1.courses.length, 3, '行模板 3 门课');
eq(r1.courses[0].day, 1, '行模板 day');
eq(r1.courses[0].weeks.mode, 'range', '行模板 1-16周 → range');
eq(r1.courses[1].weeks.mode, 'even', '行模板 双周 → even');
eq(r1.courses[2].weeks.mode, 'odd', '行模板 单周 → odd');
eq(r1.courses[2].room, '操场', '行模板 教室');
eq(r1.courses[2].teacher, '王五', '行模板 老师');

// ---- 课表：网格模式（模拟教务导出）----
const grid = [
  '节次\t周一\t周二\t周三\t周四\t周五',
  '1,2节\t高等数学 张三 教A101 1-16周\t大学英语 李四 教B202 1-16周(双)\t\t数据结构 王五 机房 1-8周\t体育 赵六 操场 单周',
  '3,4节\t高等数学 张三 教A101 1-16周\t\t物理实验 孙七 实验楼 9-16周\t\t',
  '5,6节\t\t\t\t\t'
].join('\n');
const r2 = parse.parseScheduleText(grid, 20);
eq(r2.ok, true, '网格 ok');
// 高等数学：day1 第1-2节 + 第3-4节 同名同教师同周次 → 合并为 4 节
const math = r2.courses.find(c => c.name === '高等数学');
eq(math.periods, 4, '网格 连堂合并 4 节');
eq(math.startPeriod, 1, '网格 起始节');
eq(math.teacher, '张三', '网格 老师');
const eng = r2.courses.find(c => c.name === '大学英语');
eq(eng.weeks.mode, 'even', '网格 双周');
eq(r2.courses.length, 5, '网格 共5门(去连堂后)');

// ---- 周次可见性 ----
eq(parse.weekVisible({ mode: 'all', rangeFrom: 1, rangeTo: 20 }, 11, 20), true, 'visible all w11');
eq(parse.weekVisible({ mode: 'odd', rangeFrom: 1, rangeTo: 20 }, 11, 20), true, 'visible odd w11');
eq(parse.weekVisible({ mode: 'odd', rangeFrom: 1, rangeTo: 20 }, 12, 20), false, 'visible odd w12');
eq(parse.weekVisible({ mode: 'even', rangeFrom: 1, rangeTo: 20 }, 12, 20), true, 'visible even w12');
eq(parse.weekVisible({ mode: 'range', rangeFrom: 1, rangeTo: 8 }, 11, 20), false, 'visible range w11>8');
eq(parse.weekVisible(null, 11, 20), true, 'visible null 默认全周');

// ---- GPA：长大方案（÷10−5）----
eq(gpa.scoreToGpa(92, '5.0linear'), 4.2, 'linear 92');
eq(gpa.scoreToGpa(100, '5.0linear'), 5, 'linear 100');
eq(gpa.scoreToGpa(60, '5.0linear'), 1, 'linear 60');
eq(gpa.scoreToGpa(55, '5.0linear'), 0.5, 'linear 55');
eq(gpa.scoreToGpa(40, '5.0linear'), 0, 'linear 40 clamp');
eq(gpa.scoreToGpa('优', '5.0linear'), 4.5, 'linear 优');
eq(gpa.scoreToGpa('不及格', '5.0linear'), 0, 'linear 不及格');
eq(gpa.GPA_TABLES['5.0linear'].name, '长大方案（成绩÷10−5）', 'linear 名称');
const statsL = gpa.calcStats([
  { name: 'A', credit: 4, score: 92 },
  { name: 'B', credit: 2, score: 80 }
], '5.0linear');
// (4*4.2 + 2*3.0) / 6 = (16.8+6)/6 = 3.8
eq(statsL.gpa, 3.8, 'linear calcStats');

// ---- 周次：单双周 × 自定义区间 组合（如 1-13 的单周）----
const wOdd = parse.parseWeeks('1-13周(单)', 20);
eq(wOdd.mode, 'odd', '组合 1-13周(单) mode');
eq(wOdd.rangeFrom, 1, '组合 1-13周(单) from');
eq(wOdd.rangeTo, 13, '组合 1-13周(单) to');
eq(parse.parseWeeks('1-13的单周', 20).mode, 'odd', '口语化 1-13的单周');
const oddRange = { mode: 'odd', rangeFrom: 1, rangeTo: 13 }; // 编辑器选 1-13 周 × 单周
eq(parse.weekVisible(oddRange, 1, 20), true, 'odd×1-13 第1周');
eq(parse.weekVisible(oddRange, 2, 20), false, 'odd×1-13 第2周');
eq(parse.weekVisible(oddRange, 13, 20), true, 'odd×1-13 第13周');
eq(parse.weekVisible(oddRange, 15, 20), false, 'odd×1-13 第15周(超区间)');
const evenRange = { mode: 'even', rangeFrom: 1, rangeTo: 13 }; // 1-13 周 × 双周
eq(parse.weekVisible(evenRange, 2, 20), true, 'even×1-13 第2周');
eq(parse.weekVisible(evenRange, 14, 20), false, 'even×1-13 第14周(超区间)');

// ---- 成绩导入：表头模式 ----
const gh = [
  '课程名称\t学分\t总评成绩\t学年学期',
  '高等数学\t4\t92\t2025-2026-1',
  '大学英语\t3\t85\t2025-2026-1',
  '体育\t1\t优\t2025-2026-2'
].join('\n');
const g1 = parse.parseGradesText(gh);
eq(g1.ok, true, '成绩表头 ok');
eq(g1.grades.length, 3, '成绩表头 3 行');
eq(g1.grades[0].name, '高等数学', '成绩表头 课程名');
eq(g1.grades[0].credit, 4, '成绩表头 学分');
eq(g1.grades[2].score, '优', '成绩表头 等级');
eq(g1.grades[2].term, '2025-2026-2', '成绩表头 学期');

// ---- 成绩导入：行模板 ----
const gt = '高等数学 4 92 2025-2026-1\n大学英语,3,85\n体育 1 优';
const g2 = parse.parseGradesText(gt);
eq(g2.ok, true, '成绩模板 ok');
eq(g2.grades.length, 3, '成绩模板 3 行');
eq(g2.grades[1].term, '', '成绩模板 空学期');

console.log('----');
console.log('PASS=' + pass + ' FAIL=' + fail);
process.exit(fail ? 1 : 0);
