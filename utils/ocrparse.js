// 教务课表 OCR 解析器：把 OCR 表格识别结果（单元格网格）转换为课程数组
// 适配格式（山东大学教务）：
//   行头：第一节、第二节...（大节，1 大节 = 2 小节；教务第 N 大节 -> 小程序第 2N-1、2N 节）
//   列头：星期一、星期二...星期日
//   格子文本：课程名(课程编号)(教师) 换行 (起周-止周,教室)，周次可带 单/双 修饰
// 兼容云端 OCR 的两种输入：
//   A. TableOCR 结构化输出：[{ row, col, text }] 或 { cells: [...] }
//   B. 纯文本行数组（前端兜底）：[['第一节','星期一','课程...'], ...]

var DAY_MAP = {
  '星期一': 1, '周一': 1, '礼拜一': 1, '一': 1,
  '星期二': 2, '周二': 2, '礼拜二': 2, '二': 2,
  '星期三': 3, '周三': 3, '礼拜三': 3, '三': 3,
  '星期四': 4, '周四': 4, '礼拜四': 4, '四': 4,
  '星期五': 5, '周五': 5, '礼拜五': 5, '五': 5,
  '星期六': 6, '周六': 6, '礼拜六': 6, '六': 6,
  '星期日': 7, '周日': 7, '星期天': 7, '礼拜日': 7, '礼拜天': 7, '日': 7
};

// 中文数字 -> 阿拉伯数字（大节编号用）
var CN_NUM = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };

function cnToInt(s) {
  s = String(s || '').trim();
  if (/^\d+$/.test(s)) return +s;
  if (s === '十') return 10;
  if (s.length === 2 && s[0] === '十') return 10 + (CN_NUM[s[1]] || 0);
  if (s.length === 2 && s[1] === '十') return (CN_NUM[s[0]] || 0) * 10;
  if (s.length === 3 && s[1] === '十') return (CN_NUM[s[0]] || 0) * 10 + (CN_NUM[s[2]] || 0);
  return CN_NUM[s] || 0;
}

// ---------- 规范化单元格网格 ----------
// 输入多种 OCR 输出形态，统一为 grid: [[cell, cell, ...], ...]（行 x 列）
function toGrid(input) {
  if (!input) return null;
  if (Array.isArray(input) && input.length && Array.isArray(input[0])) {
    // B 形态：已经是行数组。若每行只有 1 格（平铺流式输出），尝试重组
    var rows0 = input.map(function (row) {
      return row.map(function (c) {
        return typeof c === 'string' ? c : (c && c.text) || '';
      });
    }).filter(function (row) { return row.join('').trim(); });
    var flatCount = rows0.filter(function (r) { return r.length === 1; }).length;
    if (flatCount >= 5 && flatCount / rows0.length > 0.6) {
      return rebuildFromFlat(rows0);
    }
    return rows0;
  }
  var cells = null;
  if (Array.isArray(input)) {
    if (input.length && typeof input[0] === 'object' && input[0] !== null && 'text' in input[0]) {
      cells = input; // A 形态
    } else {
      return null;
    }
  } else if (input.cells && Array.isArray(input.cells)) {
    cells = input.cells; // A 形态变体
  } else if (input.grid && Array.isArray(input.grid)) {
    return input.grid;
  } else if (typeof input === 'string') {
    return input.split(/\r?\n/).map(function (line) {
      return line.replace(/\s{2,}|\t/g, '\u0001').split('\u0001').map(function (s) { return s.trim(); });
    }).filter(function (row) { return row.length > 1 && row.join(''); });
  } else {
    return null;
  }
  if (!cells.length) return null;
  // 按 row/col 装配矩阵
  function cellRC(c) {
    var r = c.row;
    if (r === undefined) r = c.Row;
    if (r === undefined) r = 0;
    var co = c.col;
    if (co === undefined) co = c.Col;
    if (co === undefined) co = c.column;
    if (co === undefined) co = 0;
    return { r: +r || 0, c: +co || 0 };
  }
  var maxR = 0, maxC = 0;
  cells.forEach(function (c) {
    var rc = cellRC(c);
    if (rc.r > maxR) maxR = rc.r;
    if (rc.c > maxC) maxC = rc.c;
  });
  var grid = [];
  for (var i = 0; i <= maxR; i++) grid.push(new Array(maxC + 1).fill(''));
  cells.forEach(function (c) {
    var rc = cellRC(c);
    grid[rc.r][rc.c] = String(c.text || c.Text || '').trim();
  });
  return grid;
}

// ---------- 平铺流式重组 ----------
// OCR 把每个单元格单独输出成一行（每行 1 格，顺序大致为按列/按行流式）：
// 依据语义重建矩阵：星期X 定列、第X节 定行、其余文本按"离哪个表头近"归位。
// 输入 rows0: [['课表格式说明:...'], ['节次/周次'], ['星期一'], ...]
function rebuildFromFlat(rows0) {
  // 1) 展平为带原始顺序的格子列表
  var flats = [];
  rows0.forEach(function (row, ri) {
    row.forEach(function (txt, ci) {
      var t = String(txt || '').trim();
      if (t) flats.push({ text: t, ri: ri, ci: ci });
    });
  });
  if (!flats.length) return rows0;

  // 2) 找星期表头（连续出现的 星期X 序列）
  var dayCells = flats.filter(function (f) {
    return DAY_MAP[f.text.replace(/\s/g, '')] && f.text.replace(/\s/g, '').length <= 3;
  });
  var daySet = {};
  dayCells.forEach(function (f) {
    var d = DAY_MAP[f.text.replace(/\s/g, '')];
    if (!daySet[d]) daySet[d] = f; // 保留首个
  });
  var dayCount = Object.keys(daySet).length;

  // 3) 找节次表头（第X节）
  var periodCells = {};
  flats.forEach(function (f) {
    var m = f.text.replace(/\s/g, '').match(/^第([0-9一二三四五六七八九十]+)节/);
    if (m) {
      var n = cnToInt(m[1]);
      if (n >= 1 && n <= 12 && !periodCells[n]) periodCells[n] = f;
    }
  });
  var periodCount = Object.keys(periodCells).length;

  if (dayCount < 2 || periodCount < 1) {
    // 无法重组，原样返回（外层会给出错误提示）
    return rows0;
  }

  // 4) 建矩阵骨架：第0行 = 节次/周次 + 星期列头；后续每行 = 第X节 + 各天
  var days = Object.keys(daySet).map(Number).sort(function (a, b) { return a - b; });
  var periods = Object.keys(periodCells).map(Number).sort(function (a, b) { return a - b; });
  // 列顺序按星期排，行按大节排
  var grid = [];
  var headRow = new Array(days.length + 1).fill('');
  headRow[0] = '节次/周次';
  days.forEach(function (d, i) { headRow[i + 1] = '星期' + '一二三四五六日'.charAt(d - 1); });
  grid.push(headRow);
  periods.forEach(function (p) {
    var row = new Array(days.length + 1).fill('');
    row[0] = '第' + '一二三四五六七八九十'.charAt(p - 1) + '节';
    grid.push(row);
  });

  // 5) 剩余文本归位：课程格子按"出现顺序 + 当前扫描位置"分配到矩阵
  //    策略：遍历 flats（跳过表头格子），把课程文本依次填入下一个空位（按行优先）
  var headerTexts = {};
  dayCells.forEach(function (f) { headerTexts[f.text] = 1; });
  Object.keys(periodCells).forEach(function (k) { headerTexts[periodCells[k].text] = 1; });
  headerTexts['节次/周次'] = 1;

  var rest = flats.filter(function (f) {
    return !headerTexts[f.text] &&
      !/^课表格式说明/.test(f.text) &&
      !/(午间课|晚间课)/.test(f.text);
  });

  // 课程格的归属：OCR 输出顺序通常按"列"（先星期一所有节，再星期二...）或按"行"。
  // 用位置试探：找到第一个课程格，看它出现在哪个星期表头之后最近 -> 归属该列
  // 简化实现：按出现顺序，把每个课程格分配给"序号对应的天"：天序 = 课程格序号 % 天数（配合列流假设）
  // 更稳的办法：利用原始 ri（行号）——列流时同一列的格 ri 相邻；行流时同一行 ri 相同
  // 这里采用：按天表头的 ri 分界，后续格属于 ri 最近的前一个表头天
  var dayOrder = [];
  flats.forEach(function (f, i) {
    if (headerTexts[f.text] && DAY_MAP[f.text.replace(/\s/g, '')]) {
      dayOrder.push({ idx: i, day: DAY_MAP[f.text.replace(/\s/g, '')] });
    }
  });
  var colAssign = {};
  if (dayOrder.length >= dayCount) {
    // 表头都在前面：列流分配（格子在表头之间的属于前一个表头）
    for (var d = 0; d < dayOrder.length; d++) {
      var start = dayOrder[d].idx;
      var end = (d + 1 < dayOrder.length) ? dayOrder[d + 1].idx : flats.length;
      var day = dayOrder[d].day;
      // 收集该列的课程格（跳过表头与节次头）
      var colTexts = [];
      for (var k2 = start + 1; k2 < end; k2++) {
        var f2 = flats[k2];
        if (headerTexts[f2.text] || /^课表格式说明/.test(f2.text) || /(午间课|晚间课)/.test(f2.text)) continue;
        var mm = f2.text.replace(/\s/g, '').match(/^第([0-9一二三四五六七八九十]+)节/);
        if (mm) continue; // 节次头
        colTexts.push(f2.text);
      }
      colAssign[day] = colTexts;
    }
  }
  // 6) 写入矩阵：每列的课程格，按顺序对应各节行
  days.forEach(function (day) {
    var texts = colAssign[day] || [];
    periods.forEach(function (p, pi) {
      if (pi < texts.length) {
        grid[pi + 1][days.indexOf(day) + 1] = texts[pi];
      }
    });
  });
  return grid;
}

// ---------- 定位表头 ----------
// 返回 { dayCols: {colIdx: day}, periodRows: {rowIdx: periodNo}, headerRowIdx, headerColIdx }
function locateHeaders(grid) {
  var dayCols = {}, periodRows = {};
  var headerRowIdx = -1, headerColIdx = -1;
  // 找列头行（含 星期X 的行）
  for (var r = 0; r < Math.min(grid.length, 6); r++) {
    var found = 0, cols = {};
    for (var c = 0; c < grid[r].length; c++) {
      var t = String(grid[r][c] || '').trim();
      var day = DAY_MAP[t.replace(/\s/g, '')];
      if (day) { cols[c] = day; found++; }
    }
    if (found >= 2) { dayCols = cols; headerRowIdx = r; break; }
  }
  // 找行头列（含 第X节 的列）
  for (var c2 = 0; c2 < Math.min((grid[0] || []).length, 3); c2++) {
    var found2 = 0, rows = {};
    for (var r2 = 0; r2 < grid.length; r2++) {
      var t2 = String((grid[r2] || [])[c2] || '').trim();
      var m = t2.replace(/\s/g, '').match(/^第([0-9一二三四五六七八九十]+)节/);
      if (m) {
        var n = cnToInt(m[1]);
        if (n >= 1 && n <= 12) { rows[r2] = n; found2++; }
      }
    }
    if (found2 >= 1) { periodRows = rows; headerColIdx = c2; break; }
  }
  return { dayCols: dayCols, periodRows: periodRows, headerRowIdx: headerRowIdx, headerColIdx: headerColIdx };
}

// ---------- 单元格文本 -> 课程条目 ----------
// 格式：课程名(编号)(教师) (起周-止周[,单双],教室) [课程名(编号)(教师) (周次,教室)...]
// 以 "(周次,教室)" 锚点切段：每段 = 锚点前的课程信息 + 锚点本身
// 锚点提取（供分组判定与文本解析共用）：
//   标准锚点：括号内含数字且用逗号分隔（周次,教室），如 (1-15,武教A-103)
//   无逗号变体：(7-10组2)、(1-15) —— 仅当括号内是周次形态（区间/含周/含组）才视为锚点；
//   纯课程编号如 (786341) 不含这些特征，不算锚点
function findAnchors(t) {
  var spans = [], m;
  var reStd = /[（(]\s*([^()（）]*?\d[^()（）]*?)\s*[,，]\s*([^()（）]*?)\s*[)）]/g;
  while ((m = reStd.exec(t))) {
    spans.push({ start: m.index, end: m.index + m[0].length, weeksRaw: m[1].trim(), room: m[2].trim(), full: m[0] });
  }
  // 第二遍：无逗号变体（周次形态：区间 或 含周/组）——始终执行，
  // 补充与第一遍区间不重叠的无逗号锚点（同格可同时存在带逗号与无逗号两种锚点，
  // 如"线性代数(单1-13,武教B-103) 普通地质学(7-10组2)"）
  {
    var reNoComma = /[（(]\s*([^()（）]*?\d[^()（）]*?)\s*[)）]/g;
    while ((m = reNoComma.exec(t))) {
      var wtxt = m[1].trim();
      var isWeekForm = /\d\s*[-–~至]\s*\d/.test(wtxt) || /周|组/.test(wtxt);
      if (!isWeekForm) continue;
      var st = m.index, en = m.index + m[0].length;
      var overlap = spans.some(function (s0) { return st < s0.end && en > s0.start; });
      if (!overlap) spans.push({ start: st, end: en, weeksRaw: wtxt, room: '', full: m[0] });
    }
    spans.sort(function (a, b) { return a.start - b.start; });
  }
  return spans;
}

function parseCellText(text) {
  var items = [];
  var t = String(text || '').replace(/\r/g, ' ').replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!t) return items;

  var spans = findAnchors(t);

  if (!spans.length) {
    // 无锚点：整格按一门课处理（信息不全时仍给用户预览修正的机会）
    var name0 = t.replace(/[（(][^()（）]*[)）]/g, ' ').trim();
    // OCR 断行拼接会留下未闭合的锚点尾巴（如"线性代数(9-12,实验武实验"），剔除；
    // 教室碎片尾部可能残留未配对的右括号（如"楼A106)"）
    name0 = name0.replace(/\s*[（(][^()（）]*$/, '').trim();
    name0 = name0.replace(/\s*[楼栋][A-Za-z]?\d*\)?\s*$/, '').trim();
    // 教师尝试：末尾短括号人名（排除含数字与实验标注）
    var teacher0 = '';
    var mT0 = t.match(/[（(]\s*([^()（）]{2,4})\s*[)）]\s*$/);
    if (mT0) {
      var cand0 = mT0[1].replace(/\s+/g, '');
      if (!/\d/.test(cand0) && !/实验|项目|分组|上机|实践/.test(cand0)) teacher0 = cand0;
    }
    if (name0) items.push({ name: name0, teacher: teacher0, room: '', weeks: { rangeFrom: 1, rangeTo: 20, mode: 'all' }, raw: t });
    return items;
  }

  var prevEnd = 0;
  spans.forEach(function (sp) {
    var seg = t.slice(prevEnd, sp.end).trim();
    prevEnd = sp.end;
    var prefixLen = seg.length - sp.full.length;
    var prefix = prefixLen > 0 ? seg.slice(0, prefixLen).trim() : '';
    if (!prefix && items.length) {
      // 纯锚点段（无课程名，多为 OCR 横行粘连/断行把别的格子的周次行拼进来）：
      // 并入前一门课，用本锚点的周次/教室覆盖（本锚点更靠近课程自己格子的概率更高）
      var last = items[items.length - 1];
      last.weeks = parseWeeksRaw(sp.weeksRaw);
      if (sp.room) last.room = sp.room.replace(/\s+/g, '');
      return;
    }
    var it = parseOneCourse(seg, sp);
    if (it) items.push(it);
  });
  return items;
}

// 周次文本 -> weeks 对象
function parseWeeksRaw(w) {
  var weeks = { rangeFrom: 1, rangeTo: 20, mode: 'all' };
  var mR = w.match(/(\d+)\s*[-–~至]\s*(\d+)/);
  if (mR) {
    weeks.rangeFrom = +mR[1];
    weeks.rangeTo = +mR[2];
  } else {
    var mS = w.match(/(\d+)/);
    if (mS) { weeks.rangeFrom = +mS[1]; weeks.rangeTo = +mS[1]; }
  }
  if (/单周|单/.test(w) && !/双/.test(w)) weeks.mode = 'odd';
  else if (/双周|双/.test(w)) weeks.mode = 'even';
  return weeks;
}

// 单段（含尾部锚点）解析
function parseOneCourse(seg, sp) {
  // 前缀 = 段去掉尾部锚点
  var prefix = seg.slice(0, seg.length - sp.full.length).trim();

  var weeks = parseWeeksRaw(sp.weeksRaw);

  // 教师：前缀末尾的短括号（2-4 字人名）；
  // 排除实验类标注（实验/项目/组N/分组等）——它们并入课程名备注
  var teacher = '';
  var mT = prefix.match(/[（(]\s*([^()（）]{2,4})\s*[)）]\s*$/);
  if (mT) {
    var cand = mT[1].trim().replace(/\s+/g, '');
    var isExpMark = /实验|项目|分组|上机|实践/.test(cand);
    if (!isExpMark) {
      teacher = cand;
      prefix = prefix.slice(0, mT.index).trim();
    }
  }
  // 课程名：去掉编号括号（4 位以上数字）与实验类标注括号；清理 OCR 乱码杂字（替换问号/菱形/星开头的杂字）
  var name = prefix.replace(/[（(]\s*\d{4,}\s*[)）]/g, '').trim();
  name = name.replace(/[（(]\s*(实验|物电实验项目|上机|实践)[)）]/g, '').replace(/\s+/g, ' ').trim();
  // OCR 断行拼接会留下未闭合的锚点尾巴（如"线性代数(9-12,实验武实验"），剔除
  name = name.replace(/\s*[（(][^()（）]*$/, '').trim();
  name = name.replace(/^[\uFFFD\u25C6\u2605\u2047\u2048\u2049]+\s*/, ''); // 开头乱码杂字（� ◆ ★ ⁇ ⁈ ⁉）
  name = name.replace(/[\uFFFD\u25C6\u2605]/g, ''); // 内嵌乱码字符
  name = name.replace(/^(星|期|星期|期星)+\s*/, ''); // 表头碎片混入（"星""期""星期"开头的杂字）
  if (!name) return null;
  return { name: name, teacher: teacher, room: (sp.room || '').replace(/\s+/g, ''), weeks: weeks, raw: seg };
}

// ---------- 主入口 ----------
// grid: 二维文本数组；totalWeeks: 学期总周数（默认周次上限）
// 返回 { ok, courses, warnings, stats }
function parseGrid(grid, totalWeeks) {
  totalWeeks = totalWeeks || 20;
  if (!grid || !grid.length) return { ok: false, error: '空表格' };
  var loc = locateHeaders(grid);
  var dayCount = Object.keys(loc.dayCols).length;
  if (dayCount < 2) return { ok: false, error: '未识别到星期表头（请确认截图包含完整的表头行）' };
  var courses = [];
  var warnings = [];
  var cellCount = 0;
  Object.keys(loc.dayCols).forEach(function (colKey) {
    var colIdx = +colKey;
    var day = loc.dayCols[colKey];
    Object.keys(loc.periodRows).forEach(function (rowKey) {
      var rowIdx = +rowKey;
      if (rowIdx <= loc.headerRowIdx) return;
      var cellText = String((grid[rowIdx] || [])[colIdx] || '').trim();
      if (!cellText) return;
      cellCount++;
      var items = parseCellText(cellText);
      if (!items.length) {
        warnings.push('第' + day + '天 第' + loc.periodRows[rowIdx] + '节：未能解析「' + cellText.slice(0, 20) + '」');
        return;
      }
      items.forEach(function (it) {
        // 教务大节 N -> 小程序小节 2N-1 起，2 小节
        var big = loc.periodRows[rowIdx];
        var rec = {
          id: 'ocr_' + day + '_' + big + '_' + (courses.length + 1),
          name: it.name,
          teacher: it.teacher,
          room: it.room,
          day: day,
          startPeriod: big * 2 - 1,
          periods: 2,
          weeks: it.weeks
        };
        if (it.weeks.rangeTo > totalWeeks) {
          warnings.push('「' + it.name + '」周次上限 ' + it.weeks.rangeTo + ' 超过学期总周数 ' + totalWeeks + '，已保留原值');
        }
        courses.push(rec);
      });
    });
  });
  // 去重：同 day + startPeriod + name 只留一条
  var seen = {};
  var uniq = courses.filter(function (c) {
    var k = c.day + '|' + c.startPeriod + '|' + c.name;
    if (seen[k]) return false;
    seen[k] = 1;
    return true;
  });
  return {
    ok: uniq.length > 0,
    courses: uniq,
    warnings: warnings,
    stats: {
      cellCount: cellCount,
      courseCount: uniq.length,
      dayCount: dayCount,
      periodCount: Object.keys(loc.periodRows).length
    }
  };
}

// ---------- 坐标对齐解析（通用 OCR 输出 points: [{text,x,y,w,h}]） ----------
// 思路：
//   1) 找出星期表头块与"第X节"行头块（按文本匹配）
//   2) 每个星期表头的 x 范围决定一列的边界（相邻表头中点分界）
//   3) 每个行头块的 y 范围决定一行的边界
//   4) 其余文本块按 x/y 归列归行；同一格的多块文字按 y 拼接
//   5) 每格文本走 parseCellText 解析为课程
function parseByPoints(points, totalWeeks) {
  totalWeeks = totalWeeks || 20;
  if (!points || !points.length) return { ok: false, error: '无识别结果' };
  var pts = points.map(function (p) {
    var t = String(p.text || '').trim();
    var cx = p.x + (p.w || 0) / 2; // 中心点
    var cy = p.y + (p.h || 0) / 2;
    return { text: t, x: p.x, y: p.y, w: p.w || 0, h: p.h || 0, cx: cx, cy: cy };
  }).filter(function (p) { return p.text; });

  // 2) 行头块（第X节）——先于表头识别（表头 y 判定要用行头位置）
  var rowHeads = {};
  pts.forEach(function (p) {
    var m = p.text.replace(/\s/g, '').match(/^第([0-9一二三四五六七八九十]+)节/);
    if (m) {
      var n = cnToInt(m[1]);
      if (n >= 1 && n <= 12 && !rowHeads[n]) rowHeads[n] = p;
    }
  });
  var periodNos = Object.keys(rowHeads).map(Number).sort(function (a, b) { return rowHeads[a].cy - rowHeads[b].cy; });
  if (!periodNos.length) return { ok: false, error: '未识别到节次行头' };

  // 1) 表头块（容忍 OCR 噪声："星�三""星期三”“星期=三"等）
  //    硬约束：表头必须在表格顶部区域（第一个行头上方的带内），正文课程文字不得当表头
  //    匹配形态约束：只认"星期X/周X/礼拜X"形态或完整3字（'一''二'等单字必须排除，
  //    否则"第一节"含'一'字会被误当表头，导致整个列边界错位）
  function dayFromText(raw) {
    var k = String(raw || '').replace(/\s/g, '');
    if (DAY_MAP[k] && k.length >= 2) return DAY_MAP[k]; // 完整形态（星期X/周X/礼拜X，≥2字）
    // 宽容匹配：去掉非表头字符后剩"星X/期X"式 2 字残留（乱码表头"星�三"清洗后为"星三"）
    var cleaned = k.replace(/[^星期一二三四五六日]/g, '');
    if (cleaned.length === 2 && /星|期/.test(cleaned) && DAY_MAP[cleaned.charAt(1)]) {
      return DAY_MAP[cleaned.charAt(1)];
    }
    if (cleaned.length >= 2 && cleaned.length <= 3 && DAY_MAP[cleaned] && /星|期/.test(cleaned)) {
      return DAY_MAP[cleaned];
    }
    return 0;
  }
  var firstRowY = rowHeads[periodNos[0]].y;
  var dayHeads = pts.filter(function (p) {
    if (!dayFromText(p.text)) return false;
    // 表头带：顶部区域（行头上方的 2.2 倍行高带内），且 x 必须在行头右侧（课程列区域）
    if (p.y > firstRowY + 30) return false;
    return true;
  });
  if (dayHeads.length < 2) return { ok: false, error: '未识别到星期表头' };
  // 去重（同一天取最左）
  var dayMap = {};
  dayHeads.forEach(function (p) {
    var d = dayFromText(p.text);
    if (!dayMap[d] || p.cx < dayMap[d].cx) dayMap[d] = p;
  });
  var days = Object.keys(dayMap).map(Number).sort(function (a, b) { return dayMap[a].cx - dayMap[b].cx; }); // 按 x 位置排序

  // 1b) 缺列推断：仅当表头间距均匀（每对相邻表头间距偏差 < 15%）才插值；
  //     且只补主课表区（周一~周五）内的缺口。防止截图右侧截断的周六列引发错位
  var dayNums = days.slice().sort(function (a, b) { return a - b; });
  var xs = dayNums.map(function (d) { return dayMap[d].cx; });
  var spacings = [];
  for (var si = 1; si < xs.length; si++) spacings.push(xs[si] - xs[si - 1]);
  var spAvg = spacings.length ? spacings.reduce(function (s, v) { return s + v; }, 0) / spacings.length : 0;
  var uniform = spacings.length > 0 && spacings.every(function (s) { return Math.abs(s - spAvg) < spAvg * 0.15; });
  var filled = [];
  for (var di = 0; di < dayNums.length; di++) {
    var cur = dayNums[di];
    filled.push(cur);
    if (di + 1 < dayNums.length && uniform) {
      var nxt = dayNums[di + 1];
      if (nxt - cur === 2) {
        // 缺一个中间日：位置取两表头 x 中点；仅补 1~5（主课表区）
        var missDay = cur + 1;
        if (missDay <= 5) {
          var mid = (dayMap[cur].cx + dayMap[nxt].cx) / 2;
          dayMap[missDay] = { cx: mid, text: '星期' + '一二三四五六日'.charAt(missDay - 1), virtual: true };
          filled.push(missDay);
        }
      }
    }
  }
  days = filled.sort(function (a, b) { return dayMap[a].cx - dayMap[b].cx; });

  // 3) 列边界：相邻表头中点分界；列区间 = [左界, 右界)
  var colBounds = [];
  for (var i = 0; i < days.length; i++) {
    var d = days[i];
    var left = i === 0 ? 0 : (dayMap[days[i - 1]].cx + dayMap[d].cx) / 2;
    var right = i === days.length - 1 ? Infinity : (dayMap[days[i + 1]].cx + dayMap[d].cx) / 2;
    colBounds.push({ day: d, left: left, right: right });
  }
  // 行归属由列内 y 聚类 + 最近行头确定（见下方步骤 4）

  // 4) 归位：跳过表头块与行头块
  var headerTexts = {};
  dayHeads.forEach(function (p) { headerTexts[p.text] = 1; });
  // 任何能被识别为星期表头的文本（含乱码变体）都跳过，防止其被当课程
  pts.forEach(function (p) { if (dayFromText(p.text)) headerTexts[p.text] = 1; });
  Object.keys(rowHeads).forEach(function (k) { headerTexts[rowHeads[k].text] = 1; });
  var skipRe = /^课表格式说明|午间课|晚间课|节次|周次/;
  // 先按列收集（x 归列），列内再按 y 聚类成"格"（同格多行文字 y 间距小）
  var colCells = {}; // day -> [块]
  pts.forEach(function (p) {
    if (headerTexts[p.text] || skipRe.test(p.text)) return;
    var day = 0;
    for (var a = 0; a < colBounds.length; a++) {
      if (p.cx >= colBounds[a].left && p.cx < colBounds[a].right) { day = colBounds[a].day; break; }
    }
    if (!day) return;
    if (!colCells[day]) colCells[day] = [];
    colCells[day].push(p);
  });
  // 4b) 行带划分（核心：往左找大节数的坐标化实现）
  //     教务课表的行头"第X节"文字在格内垂直居中，而课程文字从格顶开始（可高于行头半个格高），
  //     故不能用"行头 y <= 课程顶"归行；改为：相邻行头中心的中点把 y 轴切成行带，
  //     每块文字按中心 cy 归带，带序号即大节序号（第 N 带 = 第 N 大节 = 小节 2N-1、2N）
  var headCys = periodNos.map(function (n) { return rowHeads[n].cy; }); // 已按 cy 升序
  var bandEdges = [];
  for (var b = 1; b < headCys.length; b++) bandEdges.push((headCys[b - 1] + headCys[b]) / 2);
  function bandOf(cy) {
    var bi = 0;
    for (var b2 = 0; b2 < bandEdges.length; b2++) { if (cy >= bandEdges[b2]) bi = b2 + 1; }
    return bi;
  }
  var headGaps = [];
  for (var hg = 1; hg < headCys.length; hg++) headGaps.push(headCys[hg] - headCys[hg - 1]);
  var gapAvg = headGaps.length ? headGaps.reduce(function (s, v) { return s + v; }, 0) / headGaps.length : 80;
  // 块文本是否含周次锚点（格子"收尾行"特征：周次+教室）
  function hasAnchorText(t) { return findAnchors(String(t || '')).length > 0; }

  // 列内分组：同带必并（格内行距可达 0.6*行距，纯间距阈值会拆格）；
  // 跨带仅当"组未收尾（无锚点）+ 只进下一带 + 间距很小"才延续（覆盖跨大节合并单元格，如实验课）
  var courses = [];
  var warnings = [];
  Object.keys(colCells).forEach(function (dayStr) {
    var day = +dayStr;
    var blocks = colCells[day].slice().sort(function (a, b) { return a.y - b.y; });
    var groups = [];
    var cur = null;
      blocks.forEach(function (p) {
        if (!cur) {
          cur = { blocks: [p], minY: p.y, maxY: p.y + p.h, anchored: hasAnchorText(p.text) };
          return;
        }
        var bNew = bandOf(p.cy);
        var gap = p.y - cur.maxY;
        var tailBand = bandOf(cur.blocks[cur.blocks.length - 1].cy);
        var canJoin = false;
        if (bNew === tailBand) {
          canJoin = true; // 与组尾块同带（格内行距可达 0.6 行距，纯间距阈值会拆格）
        } else if (bNew === tailBand + 1 && !cur.anchored && gap < gapAvg * 0.35) {
          canJoin = true; // 跨带延续：组未收尾（无锚点）且间距很小——跨大节合并单元格
        }
      if (canJoin) {
        cur.blocks.push(p);
        if (p.y + p.h > cur.maxY) cur.maxY = p.y + p.h;
        // 锚点判定用组内拼接文本：断行锚点（如"(3-17,武体育馆篮"+"球场)"）跨块拼才能闭合
        if (!cur.anchored && hasAnchorText(cur.blocks.map(function (q) { return q.text; }).join(' '))) cur.anchored = true;
      } else {
        groups.push(cur);
        cur = { blocks: [p], minY: p.y, maxY: p.y + p.h, anchored: hasAnchorText(p.text) };
      }
    });
    if (cur) groups.push(cur);
    // 每组归行：主带 = 组内块带序的众数（平局取靠前的带，即首块所在带）
    groups.forEach(function (grp) {
      var counts = {}, order = [];
      grp.blocks.forEach(function (p) {
        var b3 = bandOf(p.cy);
        if (counts[b3] === undefined) { counts[b3] = 0; order.push(b3); }
        counts[b3]++;
      });
      var band = order[0], maxN = -1;
      order.forEach(function (b4) { if (counts[b4] > maxN) { maxN = counts[b4]; band = b4; } });
      if (band >= periodNos.length) band = periodNos.length - 1;
      var period = periodNos[band];
      if (!period) return;
      // 跨大节节数：组底越过带边界 + 余量（文字底边压线不算，防误判）
      var span = 1;
      for (var s2 = band; s2 < bandEdges.length; s2++) {
        if (grp.maxY > bandEdges[s2] + gapAvg * 0.1) span++;
        else break;
      }
      var text = grp.blocks.map(function (p) { return p.text; }).join(' ');
      parseCellText(text).forEach(function (it) {
        courses.push({
          id: 'ocr_' + day + '_' + period + '_' + (courses.length + 1),
          name: it.name,
          teacher: it.teacher,
          room: it.room,
          day: day,
          startPeriod: period * 2 - 1,
          periods: span * 2,
          weeks: it.weeks
        });
      });
    });
  });

  var seen = {};
  var uniq = courses.filter(function (c) {
    var k = c.day + '|' + c.startPeriod + '|' + c.name;
    if (seen[k]) return false;
    seen[k] = 1;
    return true;
  });
  if (!uniq.length) return { ok: false, error: '识别到文字但未解析出课程，请确认截图为教务课表' };
  return {
    ok: true,
    courses: uniq,
    warnings: warnings,
    stats: { dayCount: days.length, periodCount: periodNos.length, courseCount: uniq.length }
  };
}

module.exports = {
  toGrid: toGrid,
  locateHeaders: locateHeaders,
  parseCellText: parseCellText,
  parseGrid: parseGrid,
  parseByPoints: parseByPoints,
  DAY_MAP: DAY_MAP,
  cnToInt: cnToInt
};