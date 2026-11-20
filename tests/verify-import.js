// 验证修正后的导入文本：按（星期+起始小节）精确比对
const fs = require('fs');
const path = require('path');
const parse = require('../../utils/parse.js');
const text = fs.readFileSync(path.join(__dirname, '我的课表导入文本.txt'), 'utf8');
const res = parse.parseScheduleText(text, 20);
console.log('ok =', res.ok, '| 课程数 =', res.courses.length);
// 期望清单：[课程名, 星期, 起始小节]
const expected = [
  ['普通化学A', 1, 3],
  ['体育（篮球）', 1, 5],
  ['大学英语读写（3）', 1, 7],
  ['大学物理实验A（上）', 1, 9],
  ['大学物理A（下）', 2, 1],
  ['大学英语读写（3）', 2, 5],
  ['高等数学A（上）', 3, 3],
  ['线性代数', 3, 7],
  ['大学物理A（下）', 4, 3],
  ['基础化学实验B', 4, 5],
  ['形势与政策3', 4, 11],
  ['高等数学A（上）', 5, 1],
  ['线性代数', 5, 5],
  ['普通地质学', 5, 7]
];
let fail = 0;
expected.forEach(function (kv) {
  const c = res.courses.find(x => x.name === kv[0] && x.day === kv[1] && x.startPeriod === kv[2]);
  if (!c) { console.log('!! 缺失或不匹配: ' + kv[0] + ' 周' + kv[1] + ' 小节' + kv[2]); fail++; }
});
if (res.courses.length !== 14) { console.log('!! 课程数不是 14: ' + res.courses.length); fail++; }
console.log(fail ? ('FAIL ' + fail) : '14 门课的星期与节次全部校验通过');
process.exit(fail ? 1 : 0);
