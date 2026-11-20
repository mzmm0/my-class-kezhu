// 云函数：课前提醒（定时触发器每天 07:00 扫描今日有课的用户并推送订阅消息）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 消息模板 ID（公众平台-订阅消息-我的模板「日程提醒」）
// 直接写死，不读环境变量——避免控制台里配错的环境变量覆盖正确值
const TEMPLATE_ID = 'c0cTNkSZxz5BG1kFdux4EfAF-7whJZAWYDF02aToV9M';

// 每个节次（小节）的上课开始时刻（与前端 utils/presets.js 保持一致）
var PERIOD_TIMES = [
  '08:00', '08:45', '10:05', '10:50',
  '14:00', '14:45', '16:05', '16:50',
  '19:00', '19:45', '20:05', '20:50',
  '21:30', '22:15', '23:00'
];

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
// 每天两次：上午 7:30 推上午的课，下午 13:30 推下午的课；该时段没课不推
// 手动测试：{ test: true, date: '2026-11-24', time: '13:30' }（time 不传默认 07:30）
exports.main = async (event) => {
  var now;
  if (event && event.date) {
    now = new Date(event.date + 'T' + (event.time || '07:30:00'));
  } else {
    // 云函数运行时区是 UTC：+8 小时后 get* 得到的才是北京时间钟面
    now = new Date(Date.now() + 8 * 3600 * 1000);
  }
  var day = dayNo(now);
  var hour = now.getHours();
  var isMorning = hour < 12; // 7:30 触发=上午档，13:30 触发=下午档

  // 1) 读所有开了提醒的用户档案（kb_user_data 里 remindOn 字段）
  var res = await db.collection('kb_user_data').where({ remindOn: true }).get();
  var users = res.data || [];
  var sent = 0, skipped = 0, errors = [];

  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    try {
      var settings = u.settings || {};
      var week = weekNo(settings.semesterStart, now);
      var ptArr = (settings.periodTimes && settings.periodTimes.length) ? settings.periodTimes : PERIOD_TIMES;
      // 课程归上午/下午/晚上（按作息表该课的开始时刻）
      function slotOf(c) {
        var t = ptArr[(c.startPeriod || 1) - 1] || '08:00';
        var hh = parseInt(String(t).split(':')[0], 10) || 8;
        if (hh < 12) return 'am';
        if (hh < 18) return 'pm';
        return 'night';
      }
      // 今天该时段的课（上午档只看上午课，下午档只看下午课；晚上课不提醒）
      var slot = isMorning ? 'am' : 'pm';
      var courses = (u.courses || []).filter(function (c) {
        return c.day === day && courseVisible(c, week) && slotOf(c) === slot;
      }).sort(function (a, b) { return (a.startPeriod || 1) - (b.startPeriod || 1); });

      if (!courses.length) { skipped++; continue; } // 该时段没课：不推送

      var first = courses[0];
      var startTime = ptArr[(first.startPeriod || 1) - 1] || '08:00';
      var label = isMorning ? '上午' : '下午';
      // 摘要（thing 限 20 字）："8:00高数 10:05英语"
      var digest = courses.map(function (c) {
        var t = ptArr[(c.startPeriod || 1) - 1] || '08:00';
        var nm = String(c.name || '').replace(/[（(][^)）]*[)）]/g, '').trim();
        return t + nm.slice(0, 4);
      }).join(' ').slice(0, 20);

      // 2) 发送订阅消息
      // 模板「日程提醒」字段编号：日程标题=thing5 / 上课时间=time57 / 地点=thing10 / 备注=thing11
      if (!TEMPLATE_ID) { errors.push('未配置模板ID'); break; }
      var sendRes = await cloud.openapi.subscribeMessage.send({
        touser: u._openid,
        templateId: TEMPLATE_ID,
        page: 'pages/schedule/schedule',
        miniprogramState: 'formal',
        data: {
          thing5: { value: (label + courses.length + '节课 ' + startTime + '起').slice(0, 20) },
          time57: { value: now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日 ' + startTime },
          thing10: { value: (first.room || '见课表').slice(0, 20) },
          thing11: { value: (digest || (first.name || '')).slice(0, 20) }
        }
      }).catch(function (e) {
        errors.push((u._openid || '').slice(0, 8) + ': ' + (e.errMsg || e.message));
        return null;
      });
      if (sendRes) {
        sent++;
        // 扣减剩余额度（微信不提供查询接口，靠自己记账）
        if (typeof u.remindQuota === 'number') {
          try {
            await db.collection('kb_user_data').doc(u._id).update({
              data: { remindQuota: Math.max(0, u.remindQuota - 1) }
            });
          } catch (e2) { /* 扣减失败不影响已发出的消息 */ }
        }
      }
    } catch (e) {
      errors.push(e.message || String(e));
    }
  }

  return { ok: true, date: now.toISOString().slice(0, 10), day: day, users: users.length, sent: sent, skipped: skipped, errors: errors.slice(0, 5) };
};