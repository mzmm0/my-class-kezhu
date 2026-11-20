// 验证云函数时段筛选逻辑（模拟用户周一/周五课表）
const PERIOD_TIMES = ['08:00','08:45','10:05','10:50','14:00','14:45','16:05','16:50','19:00','19:45','20:05','20:50'];

// 模拟用户课表（周五：大学物理2大节=第3-4节10:05、基础化学实验3-4大节=第5-8节14:00、形势与政策第6大节=11-12节 晚上）
const courses = [
  { name: '大学英语读写(3)', day: 5, startPeriod: 5, periods: 2, weeks: { rangeFrom: 2, rangeTo: 16, mode: 'even' } },
  { name: '线性代数', day: 5, startPeriod: 5, periods: 2, weeks: { rangeFrom: 1, rangeTo: 13, mode: 'odd' } },
  { name: '大学物理A(下)', day: 5, startPeriod: 3, periods: 2, weeks: { rangeFrom: 1, rangeTo: 15, mode: 'all' } },
  { name: '形势与政策3', day: 5, startPeriod: 11, periods: 2, weeks: { rangeFrom: 5, rangeTo: 8, mode: 'all' } }
];

function dayNo(d) { var w = d.getDay(); return w === 0 ? 7 : w; }
function weekNo(start, now) {
  const s = new Date(start + 'T00:00:00');
  const diff = now - s;
  return diff < 0 ? 1 : Math.floor(diff / (7*24*3600*1000)) + 1;
}
function courseVisible(c, week) {
  const w = c.weeks || {};
  const from = w.rangeFrom || 1, to = w.rangeTo || 25;
  if (week < from || week > to) return false;
  if (w.mode === 'odd' && week % 2 === 0) return false;
  if (w.mode === 'even' && week % 2 === 1) return false;
  return true;
}

function run(dateStr, timeStr) {
  const now = new Date(dateStr + 'T' + timeStr);
  const day = dayNo(now);
  const hour = now.getHours();
  const isMorning = hour < 12;
  const ptArr = PERIOD_TIMES;
  const week = weekNo('2026-09-07', now); // 假设学期9/7开始

  function slotOf(c) {
    const hh = parseInt(String(ptArr[(c.startPeriod||1)-1] || '08:00').split(':')[0], 10) || 8;
    if (hh < 12) return 'am';
    if (hh < 18) return 'pm';
    return 'night';
  }
  const slot = isMorning ? 'am' : 'pm';
  const list = courses.filter(c => c.day === day && courseVisible(c, week) && slotOf(c) === slot)
    .sort((a,b) => a.startPeriod - b.startPeriod);
  const label = isMorning ? '上午' : '下午';
  const dig = list.map(c => {
    const t = ptArr[(c.startPeriod||1)-1];
    const nm = String(c.name||'').replace(/[（(][^)）]*[)）]/g, '').trim();
    return t + nm.slice(0,4);
  }).join(' ').slice(0,20);
  console.log(`${dateStr} ${timeStr} → 星期${day} 第${week}周 [${label}档] ${list.length}门课`);
  if (list.length) {
    console.log('   thing5: ' + (label + list.length + '节课 ' + ptArr[list[0].startPeriod-1] + '起'));
    console.log('   thing11: ' + dig);
  } else {
    console.log('   （无课 → 不推送 ✅）');
  }
  return list.length;
}

// 2026-11-20 是周五，第11周
console.log('--- 周五（第11周）---');
run('2026-11-20', '07:30:00');  // 上午档：大学物理 10:05
run('2026-11-20', '13:30:00');  // 下午档：英语+线代 14:00（11周单周，线代在）
console.log('--- 周六（第11周，无课）---');
run('2026-11-21', '07:30:00');
run('2026-11-21', '13:30:00');
console.log('--- 周四（第11周，形势与政策5-8周已过，晚上课不提醒）---');
run('2026-11-19', '07:30:00');
run('2026-11-19', '13:30:00');