// 绩点计算：支持 4.0（标准/简化）、4.5、5.0 制；等级成绩按标准 4.0 折算分数
var GPA_TABLES = {
  '5.0linear': {
    name: '长大方案（成绩÷10−5）',
    linear: true
  },
  '4.0std': {
    name: '4.0 制（标准分段）',
    segs: [[90, 4.0], [85, 3.7], [82, 3.3], [78, 3.0], [75, 2.7], [72, 2.3], [68, 2.0], [64, 1.5], [60, 1.0], [0, 0]]
  },
  '4.0simple': {
    name: '4.0 制（简化分段）',
    segs: [[90, 4.0], [80, 3.0], [70, 2.0], [60, 1.0], [0, 0]]
  },
  '4.5': {
    name: '4.5 制',
    segs: [[90, 4.5], [85, 4.0], [80, 3.5], [75, 3.0], [70, 2.5], [65, 2.0], [60, 1.5], [0, 0]]
  },
  '5.0': {
    name: '5.0 制（通用分段）',
    segs: [[90, 5.0], [80, 4.0], [70, 3.0], [60, 2.0], [0, 0]]
  }
};

// 等级成绩折算分数（用于 GPA 与平均分）
var LEVEL_MAP = {
  '优': 95, '优秀': 95,
  '良': 85, '良好': 85,
  '中': 75, '中等': 75,
  '及格': 65, '合格': 65,
  '不及格': 40, '不合格': 40,
  '通过': 80, '免修': 90
};

function round2(v) {
  return Math.round(v * 100) / 100;
}

// 分数（或等级）→ 绩点；无法识别返回 null
function scoreToGpa(score, type) {
  var num = Number(score);
  if (isNaN(num)) {
    var s = String(score === null || score === undefined ? '' : score).trim();
    if (LEVEL_MAP[s] !== undefined) {
      num = LEVEL_MAP[s];
    } else {
      return null;
    }
  }
  var table = GPA_TABLES[type] || GPA_TABLES['4.0std'];
  // 线性制式（如长大方案）：绩点 = 成绩 ÷ 10 − 5，不足 0 按 0 计
  if (table.linear) {
    var g = num / 10 - 5;
    if (g < 0) g = 0;
    if (g > 5) g = 5;
    return round2(g);
  }
  for (var i = 0; i < table.segs.length; i++) {
    if (num >= table.segs[i][0]) return table.segs[i][1];
  }
  return 0;
}

// 计算加权 GPA / 加权平均分 / 总学分
function calcStats(grades, type) {
  var creditSum = 0, scoreCredit = 0, weightedGpa = 0, weightedScore = 0;
  var count = 0, valid = 0;
  (grades || []).forEach(function (g) {
    count++;
    var credit = Number(g.credit) || 0;
    if (credit <= 0) return;
    var gp = scoreToGpa(g.score, type);
    if (gp === null) return;
    valid++;
    creditSum += credit;
    weightedGpa += gp * credit;
    var sc = Number(g.score);
    if (!isNaN(sc)) {
      scoreCredit += credit;
      weightedScore += sc * credit;
    }
  });
  return {
    count: count,
    valid: valid,
    creditSum: round2(creditSum),
    gpa: creditSum > 0 ? round2(weightedGpa / creditSum) : 0,
    avg: scoreCredit > 0 ? round2(weightedScore / scoreCredit) : 0
  };
}

module.exports = {
  GPA_TABLES: GPA_TABLES,
  LEVEL_MAP: LEVEL_MAP,
  scoreToGpa: scoreToGpa,
  calcStats: calcStats
};
