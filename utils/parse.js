// 导入解析：课表（网格识别 + 行模板）与成绩（表头识别 + 行模板）
var DAY_ALIASES = {
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7,
  '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7
};

function newId() {
  return 'id' + Date.now().toString(36) + Math.floor(Math.random() * 1000000).toString(36);
}

function splitCells(line) {
  var s = String(line);
  if (s.indexOf('\t') >= 0) return s.split('\t');
  if (/ {2,}/.test(s)) return s.split(/ {2,}/);
  if (s.indexOf(',') >= 0) return s.split(',');
  return [s];
}

// 解析“周一 / 星期三 / 1~7”为 1~7
function parseDay(v) {
  var s = String(v === null || v === undefined ? '' : v).trim();
  if (!s) return null;
  var m = /(?:周|星期)\s*([一二三四五六日天1-7])/.exec(s);
  if (m) return DAY_ALIASES[m[1]];
  if (/^[1-7]$/.test(s)) return +s;
  return null;
}

// 解析周次描述：1-16周 / 单周 / 双周 / 1-16周(双) / 空(全部周)
function parseWeeks(v, totalWeeks) {
  var s = String(v === null || v === undefined ? '' : v).trim();
  var max = totalWeeks || 20;
  var mode = 'all', from = 1, to = max;
  if (/单周|[(（]单[)）]/.test(s)) mode = 'odd';
  else if (/双周|[(（]双[)）]/.test(s)) mode = 'even';
  var rangeM = /(\d{1,2})\s*[-~—至]\s*(\d{1,2})/.exec(s);
  if (rangeM) {
    from = Math.max(1, +rangeM[1]);
    to = Math.min(max, +rangeM[2]);
    if (mode === 'all') mode = 'range';
  }
  return { mode: mode, rangeFrom: from, rangeTo: to };
}

// 判断某课程在某周是否上课
function weekVisible(weeks, week, totalWeeks) {
  var w = weeks || { mode: 'all', rangeFrom: 1, rangeTo: totalWeeks || 20 };
  var from = w.rangeFrom || 1;
  var to = w.rangeTo || (totalWeeks || 20);
  var inBounds = week >= from && week <= to;
  if (w.mode === 'odd') return week % 2 === 1 && inBounds;
  if (w.mode === 'even') return week % 2 === 0 && inBounds;
  if (w.mode === 'range') return inBounds;
  return true;
}

// 从一段课程单元格文本中提取 课程名/老师/教室/周次（尽力识别）
function parseCourseCell(text, totalWeeks) {
  var raw = String(text === null || text === undefined ? '' : text).replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  var weeks = parseWeeks(raw, totalWeeks);
  var name = raw
    .replace(/\d{1,2}\s*[-~—至]\s*\d{1,2}\s*周?[(（]?[单双]?[)）]?/g, ' ')
    .replace(/(单周|双周|全周|[(（][单双][)）])/g, ' ')
    .replace(/\s+/g, ' ').trim();
  var tokens = name.split(' ').filter(function (t) { return t; });
  var course = {
    name: tokens[0] || raw,
    teacher: '',
    room: '',
    weeks: weeks
  };
  if (tokens.length >= 2) course.teacher = tokens[1];
  if (tokens.length >= 3) course.room = tokens.slice(2).join(' ');
  return course;
}

function sameWeeks(a, b) {
  return a.mode === b.mode && a.rangeFrom === b.rangeFrom && a.rangeTo === b.rangeTo;
}

// 合并同一天、同名、连续节次的课
function mergeContinuous(list) {
  var sorted = list.slice().sort(function (a, b) {
    if (a.day !== b.day) return a.day - b.day;
    if (a.startPeriod !== b.startPeriod) return a.startPeriod - b.startPeriod;
    return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
  });
  var out = [];
  sorted.forEach(function (c) {
    var prev = out.length ? out[out.length - 1] : null;
    if (prev && prev.day === c.day && prev.name === c.name &&
        prev.teacher === c.teacher && prev.room === c.room &&
        prev.startPeriod + prev.periods === c.startPeriod &&
        sameWeeks(prev.weeks, c.weeks)) {
      prev.periods += c.periods;
    } else {
      out.push(c);
    }
  });
  return out;
}

function withIds(list) {
  return list.map(function (c) {
    var o = Object.assign({}, c);
    o.id = newId();
    return o;
  });
}

// 网格模式：识别“周一~周日”表头，逐行读取课程单元格
function parseGrid(lines, headerIdx, dayCols, totalWeeks) {
  var courses = [], warnings = [];
  var lastStart = 0;
  for (var i = headerIdx + 1; i < lines.length; i++) {
    var cells = splitCells(lines[i]);
    var label = String(cells[0] || '').trim();
    // 时间样式行首（如 08:00）不作为节次号
    var rowStart, rowSpan = 1;
    if (/^\d{1,2}:\d{2}/.test(label)) {
      rowStart = lastStart + 1;
    } else {
      var spanM = /(\d{1,2})\s*[,，、~\-]\s*(\d{1,2})/.exec(label);
      var numM = /(\d{1,2})/.exec(label);
      if (spanM && +spanM[2] > +spanM[1]) {
        rowStart = +spanM[1];
        rowSpan = Math.min(5, +spanM[2] - +spanM[1] + 1);
      } else if (numM) {
        rowStart = +numM[1];
      } else {
        rowStart = lastStart + 1;
      }
    }
    if (rowStart < 1) rowStart = 1;
    lastStart = rowStart + rowSpan - 1;

    Object.keys(dayCols).forEach(function (dayKey) {
      var idx = dayCols[dayKey];
      var content = String(cells[idx] === undefined ? '' : cells[idx]).trim();
      if (!content) return;
      if (/^\d{1,2}:\d{2}/.test(content)) return; // 时间单元格
      var c = parseCourseCell(content, totalWeeks);
      if (!c || !c.name) return;
      c.day = +dayKey;
      c.startPeriod = rowStart;
      c.periods = rowSpan;
      courses.push(c);
    });
  }
  var merged = mergeContinuous(courses);
  if (!merged.length) {
    return { ok: false, error: '识别到星期表头，但没有读到课程内容' };
  }
  warnings.push('自动识别请核对周次与老师/教室');
  return { ok: true, courses: withIds(merged), warnings: warnings };
}

// 行模板模式：课程名 星期 开始节次 节长 周次 教室 老师
function parseRows(lines, totalWeeks) {
  var courses = [], skipped = [];
  lines.forEach(function (line) {
    var cells = splitCells(line).map(function (c) { return c.trim(); });
    if (cells.length < 4) {
      // 降级：按单空格拆分，如“高等数学 周一 1 2 1-16周 教A-101 张三”
      var toks = String(line).trim().split(/\s+/);
      if (toks.length >= 4 && parseDay(toks[1]) && parseInt(toks[2], 10) > 0) {
        cells = toks;
      }
    }
    if (cells.length < 4) {
      if (line.trim()) skipped.push(line.trim());
      return;
    }
    var name = cells[0];
    var day = parseDay(cells[1]);
    var start = parseInt(cells[2], 10);
    var periods = Math.max(1, parseInt(cells[3], 10) || 1);
    if (!name || !day || !start) {
      skipped.push(line.trim());
      return;
    }
    var weeks = parseWeeks(cells[4], totalWeeks);
    courses.push({
      name: name,
      teacher: cells[6] || '',
      room: cells[5] || '',
      day: day,
      startPeriod: start,
      periods: periods,
      weeks: weeks
    });
  });
  if (!courses.length) {
    return { ok: false, error: '没有解析出课程，请查看格式说明', skipped: skipped };
  }
  return { ok: true, courses: withIds(courses), skipped: skipped };
}

// 课表导入总入口
function parseScheduleText(text, totalWeeks) {
  var lines = String(text === null || text === undefined ? '' : text).replace(/\r/g, '\n').split('\n').filter(function (l) { return l.trim(); });
  if (!lines.length) return { ok: false, error: '没有可解析的内容' };

  // 尝试网格模式
  for (var i = 0; i < Math.min(lines.length, 15); i++) {
    var cells = splitCells(lines[i]).map(function (c) { return c.trim(); });
    var map = {}, hits = 0;
    cells.forEach(function (c, idx) {
      var m = /(?:周|星期)\s*([一二三四五六日天])/.exec(c);
      if (m && DAY_ALIASES[m[1]] && map[DAY_ALIASES[m[1]]] === undefined) {
        map[DAY_ALIASES[m[1]]] = idx;
        hits++;
      }
    });
    if (hits >= 3) return parseGrid(lines, i, map, totalWeeks);
  }
  // 行模板模式
  return parseRows(lines, totalWeeks);
}

// 成绩导入：优先识别表头（课程名/学分/成绩/学期），否则按行模板
function parseGradesText(text) {
  var lines = String(text === null || text === undefined ? '' : text).replace(/\r/g, '\n').split('\n').filter(function (l) { return l.trim(); });
  if (!lines.length) return { ok: false, error: '没有可解析的内容' };

  for (var i = 0; i < Math.min(lines.length, 10); i++) {
    var cells = splitCells(lines[i]).map(function (c) { return c.trim(); });
    var iCredit = -1, iScore = -1, iTerm = -1, nameIdx = -1;
    cells.forEach(function (c, idx) {
      if (iCredit < 0 && c.indexOf('学分') >= 0) iCredit = idx;
      else if (iScore < 0 && (c.indexOf('成绩') >= 0 || c.indexOf('总评') >= 0)) iScore = idx;
      else if (iTerm < 0 && (c.indexOf('学期') >= 0 || c.indexOf('学年') >= 0)) iTerm = idx;
      else if (nameIdx < 0 && c.indexOf('课程') >= 0) nameIdx = idx;
    });
    if (iCredit >= 0 && iScore >= 0) {
      // 课程名列：优先“课程名称/课程名”
      var exact = -1;
      cells.forEach(function (c, idx) {
        if (exact < 0 && (c === '课程名称' || c === '课程名')) exact = idx;
      });
      if (exact >= 0) nameIdx = exact;
      if (nameIdx < 0) nameIdx = 0;
      var grades = [], skipped = [];
      for (var j = i + 1; j < lines.length; j++) {
        var cs = splitCells(lines[j]).map(function (c) { return c.trim(); });
        if (!cs.some(function (c) { return c; })) continue;
        var name = cs[nameIdx] || '';
        var credit = parseFloat(cs[iCredit]);
        var score = cs[iScore] || '';
        var term = iTerm >= 0 ? (cs[iTerm] || '') : '';
        if (!name || !(credit > 0) || !score) {
          skipped.push(lines[j].trim());
          continue;
        }
        grades.push({ name: name, credit: credit, score: score, term: term });
      }
      if (grades.length) return { ok: true, grades: withIds(grades), skipped: skipped };
      return { ok: false, error: '按表头识别，但没有读到有效成绩行' };
    }
  }

  // 行模板：课程名 学分 成绩 学期(可空)
  var list = [], skipped2 = [];
  lines.forEach(function (line) {
    var cs = splitCells(line).map(function (c) { return c.trim(); });
    if (cs.length < 3) {
      // 降级：按单空格拆分，如“高等数学 4 92 2025-2026-1”
      var toks = String(line).trim().split(/\s+/);
      if (toks.length >= 3 && parseFloat(toks[1]) > 0) {
        cs = [toks[0], toks[1], toks[2], toks.slice(3).join(' ')];
      }
    }
    if (cs.length < 3) {
      if (line.trim()) skipped2.push(line.trim());
      return;
    }
    var name = cs[0];
    var credit = parseFloat(cs[1]);
    var score = cs[2];
    var term = cs[3] || '';
    if (!name || !(credit > 0) || !score) {
      skipped2.push(line.trim());
      return;
    }
    list.push({ name: name, credit: credit, score: score, term: term });
  });
  if (!list.length) return { ok: false, error: '没有解析出成绩，请查看格式说明' };
  return { ok: true, grades: withIds(list), skipped: skipped2 };
}

module.exports = {
  parseDay: parseDay,
  parseWeeks: parseWeeks,
  weekVisible: weekVisible,
  parseCourseCell: parseCourseCell,
  parseScheduleText: parseScheduleText,
  parseGradesText: parseGradesText
};
