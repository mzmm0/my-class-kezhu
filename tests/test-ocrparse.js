// 教务课表 OCR 解析器自测（以山教务真实格式为样例）
var path = require('path');
var ocr = require(path.resolve(__dirname, '..//utils/ocrparse'));

var pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? '  -> ' + JSON.stringify(extra) : '')); }
}

// ---- 用例 1：真实课表格式（模拟 OCR 网格输出，行x列）----
// 列：节次 | 周一 | 周二 | 周三 | 周四 | 周五
var grid = [
  ['节次/周次', '星期一', '星期二', '星期三', '星期四', '星期五'],
  ['第一节', '', '大学物理A（下）(786341)(鄢嫣) (1-15,武教A-103)', '', '', ''],
  ['第二节', '普通化学A(786590)(马超) (1-10,武教B-308)', '', '', '', '线性代数(786555)(刘畅) (1-16,武教A-201)'],
  ['第三节', '体育（篮球）(807741)(王春波) (3-17,武体育馆篮球场)', '', '', '', ''],
  ['第四节', '', '', '大学英语(786600)(李芳) (1-16双周,武教B-402)', '', ''],
  ['第五节', '', '', '', '形势与政策3(786174)(谭梦媛) (5-8,武教B-108)', ''],
  ['第六节', '', '数据结构(786700)(张伟) (1-8单周,武教C-305)', '', '', '']
];
var r = ocr.parseGrid(grid, 20);
check('1 解析成功', r.ok, r);
check('2 课程数量 7', r.courses.length === 7, r.courses && r.courses.map(c => c.name));
check('3 无警告', r.warnings.length === 0, r.warnings);

var phys = r.courses.find(c => c.name.indexOf('大学物理') >= 0);
check('4 大学物理：周二 day=2', phys && phys.day === 2, phys);
check('5 大学物理：大节1 -> 小节1起2节', phys && phys.startPeriod === 1 && phys.periods === 2, phys);
check('6 大学物理：教师/教室/周次', phys && phys.teacher === '鄢嫣' && phys.room === '武教A-103' && phys.weeks.rangeFrom === 1 && phys.weeks.rangeTo === 15, phys);

var chem = r.courses.find(c => c.name.indexOf('普通化学') >= 0);
check('7 普通化学：周一', chem && chem.day === 1 && chem.startPeriod === 3, chem);
check('8 普通化学：周次1-10', chem && chem.weeks.rangeTo === 10, chem);

var pe = r.courses.find(c => c.name.indexOf('体育') >= 0);
check('9 体育：名称含（篮球）', pe && pe.name.indexOf('篮球') >= 0, pe);
check('10 体育：3-17周', pe && pe.weeks.rangeFrom === 3 && pe.weeks.rangeTo === 17, pe);

var engl = r.courses.find(c => c.name.indexOf('大学英语') >= 0);
check('11 大学英语：双周', engl && engl.weeks.mode === 'even', engl);

var ds = r.courses.find(c => c.name.indexOf('数据结构') >= 0);
check('12 数据结构：单周', ds && ds.weeks.mode === 'odd' && ds.room === '武教C-305', ds);

var la = r.courses.find(c => c.name.indexOf('线性代数') >= 0);
check('13 线性代数：周五 第二节 -> 小节3', la && la.day === 5 && la.startPeriod === 3, la);

// ---- 用例 2：OCR 单元格坐标形态输入 ----
var cells = [
  { row: 0, col: 0, text: '节次/周次' },
  { row: 0, col: 1, text: '星期一' },
  { row: 0, col: 2, text: '星期二' },
  { row: 1, col: 0, text: '第一节' },
  { row: 1, col: 1, text: '思想道德与法治(786111)(陈强) (1-16,武教A-101)' },
  { row: 2, col: 0, text: '第二节' }
];
var grid2 = ocr.toGrid(cells);
check('14 cells 形态转网格成功', grid2 && grid2.length === 3 && grid2[1][1].indexOf('思想道德') >= 0, grid2);
var r2 = ocr.parseGrid(grid2, 20);
check('15 cells 形态解析成功', r2.ok && r2.courses.length === 1 && r2.courses[0].name.indexOf('思想道德') >= 0, r2);

// ---- 用例 3：一格两门课 ----
var grid3 = [
  ['节次', '星期一', '星期二'],
  ['第一节', '课A(1234)(师1) (1-8,楼1) 课B(5678)(师2) (9-16,楼2)', '']
];
var r3 = ocr.parseGrid(grid3, 20);
check('16 一格两门课都解析出', r3.ok && r3.courses.length === 2, r3.courses);
if (r3.courses.length === 2) {
  check('17 两门课周次正确分离', r3.courses[0].weeks.rangeTo === 8 && r3.courses[1].weeks.rangeFrom === 9, r3.courses.map(c => c.weeks));
}

// ---- 用例 4：换行断裂修复（OCR 常见）----
var grid4 = [
  ['节次', '星期一', '星期二'],
  ['第一节', '大学物理A（下）\n(786341)(鄢嫣)\n(1-15,武教A-103)', '']
];
var r4 = ocr.parseGrid(grid4, 20);
check('18 换行断裂修复', r4.ok && r4.courses[0].name.indexOf('大学物理') >= 0 && r4.courses[0].room === '武教A-103', r4);

// ---- 用例 5：表头识别失败给出明确错误 ----
var grid5 = [['无表头', 'x', 'y'], ['第一节', '课A(1)(师1) (1-8,楼)', '']];
var r5 = ocr.parseGrid(grid5, 20);
check('19 无星期表头时报错', !r5.ok && /表头/.test(r5.error), r5);

// ---- 用例 6：纯文本兜底形态 ----
var text = '节次\t星期一\t星期二\n第一节\t课C(9999)(师3) (1-8,东楼)\t';
var grid6 = ocr.toGrid(text);
var r6 = ocr.parseGrid(grid6, 20);
check('20 纯文本兜底解析', r6.ok && r6.courses[0].name === '课C', r6);

// ---- 用例 7：大节编号边界（中文数字）----
var grid7 = [
  ['节次', '星期一', '星期二'],
  ['第十节', '军事理论(1234)(师1) (1-4,楼)', '']
];
var r7 = ocr.parseGrid(grid7, 20);
check('21 中文数字大节（十 -> 小节19起）', r7.ok && r7.courses[0].startPeriod === 19, r7.courses && r7.courses[0]);

// ---- 用例 8：行带归行（真实教务布局：行头垂直居中，课程文字从格顶开始、可高于行头）----
var pts8 = [
  { text: '节次/周次', x: 85, y: 9, w: 102, h: 27 },
  { text: '星期一', x: 265, y: 10, w: 70, h: 27 },
  { text: '星期二', x: 446, y: 10, w: 70, h: 26 },
  { text: '第一节', x: 101, y: 98, w: 72, h: 27 },
  { text: '第二节', x: 101, y: 244, w: 72, h: 27 },
  // 第1大节课程（y=43，高于第一节行头 y=98——旧算法会归错行/丢弃）
  { text: '大学物理A(下)', x: 399, y: 43, w: 150, h: 25 },
  { text: '(786341)(鄢嫣)', x: 409, y: 73, w: 143, h: 24 },
  { text: '(1-15,武教A-103)', x: 402, y: 158, w: 158, h: 24 },
  // 第2大节课程（y=187）
  { text: '普通化学', x: 257, y: 187, w: 87, h: 29 },
  { text: 'A(786590)(马超)', x: 216, y: 216, w: 166, h: 27 },
  { text: '(1-10,武教B-308)', x: 217, y: 301, w: 165, h: 25 }
];
var r8 = ocr.parseByPoints(pts8, 20);
check('22 行带归行：格顶课程（高于行头）归第1大节 P1', r8.ok && !!r8.courses.find(c => c.name.indexOf('大学物理') >= 0 && c.startPeriod === 1 && c.periods === 2), r8.courses);
check('23 行带归行：第2大节课程 P3', r8.ok && !!r8.courses.find(c => c.name.indexOf('普通化学') >= 0 && c.startPeriod === 3 && c.weeks.rangeTo === 10), r8.courses);

// ---- 用例 9：断行锚点跨块拼接收尾（防吞下一格）----
var pts9 = pts8.concat([
  { text: '第三节', x: 101, y: 417, w: 72, h: 26 },
  { text: '第四节', x: 101, y: 606, w: 72, h: 26 },
  // 第3大节体育格：锚点断行成两块，跨块拼接后闭合
  { text: '体育(篮球)', x: 235, y: 347, w: 118, h: 27 },
  { text: '(807741)(王春波)', x: 216, y: 375, w: 166, h: 27 },
  { text: '(3-17,武体育馆篮', x: 219, y: 461, w: 159, h: 27 },
  { text: '球场)', x: 274, y: 488, w: 52, h: 25 },
  // 第4大节大学英语格
  { text: '大学英语读写', x: 235, y: 535, w: 128, h: 28 },
  { text: '(3)(797475)(韩', x: 226, y: 562, w: 160, h: 30 },
  { text: '静芸)', x: 274, y: 591, w: 52, h: 27 },
  { text: '(1-16,武教A-109)', x: 220, y: 677, w: 159, h: 24 }
]);
var r9 = ocr.parseByPoints(pts9, 20);
var pe9 = r9.courses.find(c => c.name.indexOf('体育') >= 0);
var en9 = r9.courses.find(c => c.name.indexOf('大学英语') >= 0);
check('24 断行锚点收尾：体育 P5 2节（不吞下一格）', pe9 && pe9.startPeriod === 5 && pe9.periods === 2 && pe9.room === '武体育馆篮球场', pe9);
check('25 断行锚点收尾：大学英语独立成课 P7', en9 && en9.startPeriod === 7 && en9.periods === 2 && en9.teacher === '韩静芸', en9);

// ---- 用例 10：单格文本——混合锚点 / 纯锚点段并入 ----
var mixed = ocr.parseCellText('线性代数(786280) (王静茹) (单1-13,武教B- 103) 普通地质学 (806476)(张三) (7-10组2)');
check('26 混合锚点：两门课都解析出', mixed.length === 2, mixed);
check('27 混合锚点：线代 1-13 单周', mixed.length > 0 && mixed[0].name === '线性代数' && mixed[0].weeks.rangeTo === 13 && mixed[0].weeks.mode === 'odd' && mixed[0].room === '武教B-103', mixed[0]);
check('28 混合锚点：地质 7-10（无逗号锚点）', mixed.length > 1 && mixed[1].name === '普通地质学' && mixed[1].weeks.rangeFrom === 7 && mixed[1].weeks.rangeTo === 10 && mixed[1].teacher === '张三', mixed[1]);
var stuck = ocr.parseCellText('线性代数(786280)(9-12,实验武实验 (王静茹) (1-14,武教B-103)');
check('29 纯锚点段并入：周次取后者 1-14', stuck.length === 1 && stuck[0].weeks.rangeFrom === 1 && stuck[0].weeks.rangeTo === 14, stuck);
check('30 纯锚点段并入：名称无未闭合尾巴、教室正确', stuck.length === 1 && stuck[0].name === '线性代数' && stuck[0].room === '武教B-103' && stuck[0].teacher === '王静茹', stuck[0]);
var frag = ocr.parseCellText('基础化学实验 B(786269)(陈炼) (实验) 楼A106)');
check('31 无锚点格：名称剔除教室碎片', frag.length === 1 && frag[0].name === '基础化学实验 B', frag[0]);

// ---- 用例 11：跨大节合并单元格（实验课，组跨两带无锚点、间距小）----
var pts11 = [
  { text: '节次/周次', x: 85, y: 9, w: 102, h: 27 },
  { text: '星期三', x: 628, y: 10, w: 68, h: 26 },
  { text: '星期四', x: 808, y: 10, w: 70, h: 26 },
  { text: '第一节', x: 101, y: 98, w: 72, h: 27 },
  { text: '第二节', x: 101, y: 244, w: 72, h: 27 },
  { text: '第三节', x: 101, y: 417, w: 72, h: 26 },
  { text: '第四节', x: 101, y: 606, w: 72, h: 26 },
  { text: '第五节', x: 101, y: 763, w: 72, h: 29 },
  // 实验格跨第3、4大节：文字从 y=435（带2）延伸到 y=600（带3）
  { text: '基础化学实验', x: 778, y: 435, w: 130, h: 26 },
  { text: 'B(786269)(陈炼)', x: 760, y: 463, w: 163, h: 25 },
  { text: '(实验)', x: 812, y: 518, w: 61, h: 28 },
  { text: '楼A106)', x: 805, y: 576, w: 76, h: 24 }
];
var r11 = ocr.parseByPoints(pts11, 20);
var exp11 = r11.courses.find(c => c.name.indexOf('基础化学实验') >= 0);
check('32 跨大节实验课：P5 起 4 节', exp11 && exp11.startPeriod === 5 && exp11.periods === 4, r11.courses);

console.log('------------------');
console.log('通过 ' + pass + ' / ' + (pass + fail));
if (fail > 0) process.exit(1);