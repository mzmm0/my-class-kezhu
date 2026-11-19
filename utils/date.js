// 日期 / 周次计算
function parseDate(s) {
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s === null || s === undefined ? '' : s));
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]);
}

// 今天是星期几（1~7，周一为 1）
function todayIndex() {
  var d = new Date().getDay();
  return d === 0 ? 7 : d;
}

// 根据学期开始日期（第一周周一）计算当前是第几周，范围限制在 1~totalWeeks
function getWeekNo(semesterStart, totalWeeks) {
  var start = parseDate(semesterStart);
  if (!start) return 1;
  var n = new Date();
  var t = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  var diff = Math.floor((t - start) / 604800000) + 1;
  var max = totalWeeks || 20;
  if (diff < 1) diff = 1;
  if (diff > max) diff = max;
  return diff;
}

// 时间字符串 "HH:mm" 加分钟数，返回 "HH:mm"；非法输入返回 ''
function addMinutes(t, mins) {
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(t === null || t === undefined ? '' : t));
  if (!m) return '';
  var total = (+m[1]) * 60 + (+m[2]) + (mins || 0);
  total = ((total % 1440) + 1440) % 1440;
  var h = Math.floor(total / 60);
  var mm = total % 60;
  return (h < 10 ? '0' + h : String(h)) + ':' + (mm < 10 ? '0' + mm : String(mm));
}

// "HH:mm" 转当日分钟数；非法返回 null
function timeToMinutes(t) {
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(t === null || t === undefined ? '' : t));
  if (!m) return null;
  return (+m[1]) * 60 + (+m[2]);
}

module.exports = {
  parseDate: parseDate,
  todayIndex: todayIndex,
  getWeekNo: getWeekNo,
  addMinutes: addMinutes,
  timeToMinutes: timeToMinutes
};
