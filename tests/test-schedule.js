// 本地模拟测试：不依赖微信运行时，验证 buildGrid 的置灰逻辑与导出绘制流程
const path = require('path');
const PAGE = path.join(__dirname, '..', 'pages', 'schedule', 'schedule.js');

let pageCfg = null;
let drawCalls = 0;
let captured = null;

function ctxStub() {
  const noop = () => {};
  return {
    setFillStyle: noop, setStrokeStyle: noop, setLineWidth: noop,
    setFontSize: noop, setTextAlign: noop, setTextBaseline: noop,
    setGlobalAlpha: noop, fillRect: noop, fillText: noop, moveTo: noop,
    lineTo: noop, arc: noop, beginPath: noop, closePath: noop,
    stroke: noop, fill: noop, save: noop, restore: noop,
    measureText: (t) => ({ width: String(t).length * 10 }),
    draw: (reserve, cb) => { drawCalls++; if (typeof cb === 'function') cb(); }
  };
}

global.wx = {
  getStorageSync: (k) => (k === 'kb_courses' ? courses : undefined),
  setStorageSync: () => {},
  removeStorageSync: () => {},
  showToast: () => {},
  showLoading: () => {},
  hideLoading: () => {},
  showModal: () => {},
  previewImage: () => {},
  saveImageToPhotosAlbum: (o) => { captured = { step: 'save', filePath: o.filePath }; o.success && o.success(); },
  openSetting: () => {},
  createCanvasContext: () => ctxStub(),
  canvasToTempFilePath: (o) => { captured = { step: 'tempfile', w: o.width, h: o.height }; o.success && o.success({ tempFilePath: '/tmp/x.png' }); },
  setClipboardData: () => {}
};
global.Page = (cfg) => { pageCfg = cfg; };
global.getApp = () => ({});

require(PAGE);

const settings = {
  semesterStart: '2026-09-07', totalWeeks: 20, periodCount: 12,
  periodTimes: ['08:00','08:55','10:00','10:55','14:00','14:55','16:00','16:55','19:00','19:55','20:50','21:45']
};

const courses = [
  { id: 'a', name: '高等数学', day: 1, startPeriod: 1, periods: 2, room: '教A101', teacher: '张三', weeks: { mode: 'all', rangeFrom: 1, rangeTo: 20 } },
  { id: 'b', name: '大学物理', day: 3, startPeriod: 3, periods: 2, room: '教B202', teacher: '李四', weeks: { mode: 'range', rangeFrom: 1, rangeTo: 8 } },
  { id: 'c', name: '体育', day: 5, startPeriod: 5, periods: 2, room: '操场', teacher: '王五', weeks: { mode: 'odd', rangeFrom: 1, rangeTo: 20 } },
  { id: 'd', name: '大学英语', day: 2, startPeriod: 1, periods: 2, room: '教C303', teacher: '赵六', weeks: { mode: 'even', rangeFrom: 1, rangeTo: 20 } },
  { id: 'e', name: '程序设计', day: 4, startPeriod: 7, periods: 2, room: '机房', teacher: '孙七', weeks: { mode: 'all', rangeFrom: 1, rangeTo: 20 } },
  // 名字很长，用来验证导出时的折行
  { id: 'f', name: '马克思主义基本原理概论', day: 6, startPeriod: 9, periods: 1, room: '教D-大阶梯教室101', teacher: '周八', weeks: { mode: 'all', rangeFrom: 1, rangeTo: 20 } }
];

const page = Object.assign({}, pageCfg, { data: { week: 10 } });
page.setData = function (patch, cb) {
  Object.keys(patch).forEach(k => { this.data[k] = patch[k]; });
  if (typeof cb === 'function') cb();
};

console.log('=== 第 10 周 ===');
const grid = page.buildGrid(settings, courses, 10);
grid.blocks.forEach(b => console.log(
  (b.dim ? '[灰] ' : '[正常] ') + b.name + ' | tag=' + (b.tag || '-') +
  ' | ' + b.style.replace(/;/g, '; ')
));
console.log('block 顺序: ', grid.blocks.map(b => b.dim ? 'dim' : 'active').join(','));

console.log('\n=== 第 2 周 ===');
const g2 = page.buildGrid(settings, courses, 2);
g2.blocks.forEach(b => console.log((b.dim ? '[灰] ' : '[正常] ') + b.name + ' ' + (b.tag || '')));

console.log('\n=== 第 20 周（全部结课）===');
const g3 = page.buildGrid(settings, courses, 20);
console.log('总块数=' + g3.blocks.length + '，其中置灰=' + g3.blocks.filter(b => b.dim).length);

console.log('\n=== 导出绘制 ===');
page.exportImage.call(page);
setTimeout(() => {
  console.log('draw 调用次数=' + drawCalls);
  console.log('canvas 尺寸: ' + page.data.exportW + 'x' + page.data.exportH);
  console.log('结果: ' + JSON.stringify(captured));
}, 300);