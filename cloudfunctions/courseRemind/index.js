// 云函数：课前提醒（定时触发器每天 07:00 扫描今日有课的用户并推送订阅消息）
// 部署后在 config.json 配定时触发器；模板 ID 通过环境变量传入
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 消息模板 ID（环境变量 REMIND_TEMPLATE_ID）
const TEMPLATE_ID = process.env.REMIND_TEMPLATE_ID || '';

// ---------- 工具 ----------
function pad(n) { return (n < 10 ? '0' : '') + n; }

// 学期周次：semesterStart(周一) + totalWeeks
function weekNo(semesterStart, now) {
  if (!semesterStart) return 1;
  var start = new Date(semesterStart + 'T00:00:00');
  var diff = now.getTime() - start.getTime();
  if (diff < 0) return 1;
  return Math.floor(diff / (7 * 24 * 3600 * 1000)) + 1;
}

// 周几（1=周一）
function dayNo(now) { var d = now.getDay(); return d === 0 ? 7 : d; }

// 课程是否本周可见：weeks { rangeFrom, rangeTo, mode }
function courseVisible(c, week) {
  var w = c.weeks || {};
  var from = w.rangeFrom || 1;
  var to = w.rangeTo || 25;
  if (week < from || week > to) return false;
  if (w.mode === 'odd' && week % 2 === 0) return false;
  if (w.mode === 'even' && week % 2 === 1) return false;
  return true;
}

// ---------- 主入口 ----------
exports.main = async (event) => {
  // 支持手动测试调用：{ test: true, date: '2026-11-20' }
  var now = event && event.date ? new Date(event.date + 'T07:00:00') : new Date();
  var day = dayNo(now);

  // 1) 读所有开了提醒的用户档案（kb_user_data 里 remindOn 字段）
  var res = await db.collection('kb_user_data').where({ remindOn: true }).get();
  var users = res.data || [];
  var sent = 0, skipped = 0, errors = [];

  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    try {
      var settings = u.settings || {};
      var week = weekNo(settings.semesterStart, now);
      var courses = (u.courses || []).filter(function (c) {
        return c.day === day && courseVisible(c, week);
      }).sort(function (a, b) { return (a.startPeriod || 1) - (b.startPeriod || 1); });

      if (!courses.length) { skipped++; continue; }

      // 今日课程摘要文本
      var lines = courses.slice(0, 5).map(function (c) {
        return '第' + (c.startPeriod || 1) + '节 ' + (c.name || '') + (c.room ? '@' + c.room : '');
      });
      var summary = lines.join('\n');
      if (courses.length > 5) summary += '\n...共' + courses.length + '门';
      var first = courses[0];

      // 2) 发送订阅消息（openid 用记录里的 _openid）
      if (!TEMPLATE_ID) { errors.push('未配置 REMIND_TEMPLATE_ID'); break; }
      var sendRes = await cloud.openapi.subscribeMessage.send({
        touser: u._openid,
        templateId: TEMPLATE_ID,
        page: 'pages/schedule/schedule',
        miniprogramState: 'trial', // 体验版（正式发布后改 formal）
        data: {
          // 模板字段按实际模板调整；这里按"课程名/时间/地点/第N节"常见字段
          thing1: { value: (first.name || '').slice(0, 20) },
          thing2: { value: '今日共' + courses.length + '门课' },
          thing3: { value: (first.room || '').slice(0, 20) },
          time4: { value: now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) }
        }
      }).catch(function (e) {
        errors.push((u._openid || '').slice(0, 8) + ': ' + (e.errMsg || e.message));
        return null;
      });
      if (sendRes) sent++;
    } catch (e) {
      errors.push(e.message || String(e));
    }
  }

  return { ok: true, date: now.toISOString().slice(0, 10), day: day, users: users.length, sent: sent, skipped: skipped, errors: errors.slice(0, 5) };
};