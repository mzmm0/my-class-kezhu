// 云同步层自测：模拟 wx.cloud 与数据库，验证 push/pull/restore 逻辑
var fs = require('fs');
var path = require('path');
var base = path.resolve(__dirname, '..//utils');

// ---- 模拟本地存储 ----
var mem = {};
// ---- 模拟云数据库（单用户，一条记录） ----
var cloud = { doc: null, autoId: 'doc_1' };

global.wx = {
  getStorageSync: function (k) { return (k in mem) ? mem[k] : ''; },
  setStorageSync: function (k, v) { mem[k] = v; },
  removeStorageSync: function (k) { delete mem[k]; },
  cloud: {
    init: function () { return true; },
    database: function () {
      return {
        collection: function () {
          return {
            limit: function () {
              return {
                get: function () {
                  return Promise.resolve({ data: cloud.doc ? [JSON.parse(JSON.stringify(cloud.doc))] : [] });
                }
              };
            },
            add: function (opt) {
              var d = JSON.parse(JSON.stringify(opt.data));
              d._id = cloud.autoId;
              d._openid = 'openid_test';
              cloud.doc = d;
              return Promise.resolve({ _id: cloud.autoId });
            },
            doc: function (id) {
              return {
                update: function (opt) {
                  if (!cloud.doc || cloud.doc._id !== id) return Promise.reject(new Error('not found'));
                  Object.keys(opt.data).forEach(function (k) { cloud.doc[k] = JSON.parse(JSON.stringify(opt.data[k])); });
                  return Promise.resolve({ stats: { updated: 1 } });
                }
              };
            }
          };
        }
      };
    }
  }
};

function load(name) {
  var src = fs.readFileSync(path.join(base, name), 'utf8');
  var m = { exports: {} };
  new Function('module', 'exports', 'require', src)(m, m.exports, function (n) {
    return require(path.join(base, n));
  });
  return m.exports;
}

var sync = load('sync.js');

var pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name); }
}

var courses = [{ id: 'c1', name: '高等数学', day: 1, startPeriod: 1, periods: 2 }];
var grades = [{ name: '高等数学', credit: 4, score: 90 }];

(async function run() {
  // 1. init 成功
  check('1 sync.init 成功', sync.init() === true && sync.getStatus().ready === true);

  // 2. 默认开启
  check('2 默认开启云同步', sync.isEnabled() === true);

  // 3. 首次 pushAll 走 add（云端无记录 -> 创建）
  mem['kb_courses'] = courses;
  mem['kb_grades'] = grades;
  mem['kb_settings'] = { totalWeeks: 20 };
  var r1 = await sync.pushAll();
  check('3 首次推送创建云端记录', r1 === true && !!cloud.doc && cloud.doc.courses.length === 1 && cloud.doc.grades.length === 1);

  // 4. 再次推送走 update（不重复建）
  cloud.doc.courses = [{ id: 'c2', name: '大学英语' }];
  mem['kb_courses'] = [{ id: 'c2', name: '大学英语' }, { id: 'c3', name: '体育' }];
  var r2 = await sync.pushCourses(mem['kb_courses']);
  check('4 二次推送更新同一条记录', r2 === true && cloud.doc.courses.length === 2 && cloud.doc.grades.length === 1);

  // 5. 单字段推送不影响其他字段
  var r3 = await sync.pushGrades([{ name: '体育', credit: 1, score: 85 }]);
  check('5 单字段推送不覆盖其他字段', r3 === true && cloud.doc.grades.length === 1 && cloud.doc.grades[0].name === '体育' && cloud.doc.courses.length === 2);

  // 6. pullAll：本地空、云端有 -> 补回本地
  mem['kb_courses'] = [];
  mem['kb_grades'] = [];
  delete mem['kb_settings'];
  var doc = await sync.pullAll();
  check('6 本地空时从云端补回', !!doc && mem['kb_courses'].length === 2 && mem['kb_grades'].length === 1 && mem['kb_settings'].totalWeeks === 20);

  // 7. pullAll 不覆盖本地已有数据
  mem['kb_courses'] = [{ id: 'local1', name: '本地课' }];
  await sync.pullAll();
  check('7 本地有数据时不被云端覆盖', mem['kb_courses'].length === 1 && mem['kb_courses'][0].name === '本地课');

  // 8. 关闭同步后不再推送
  sync.setEnabled(false);
  var beforeUpdate = cloud.doc.updatedAt;
  mem['kb_courses'] = [{ id: 'x', name: '新' }];
  var r4 = await sync.pushCourses(mem['kb_courses']);
  check('8 关闭后不推送', r4 === false && cloud.doc.updatedAt === beforeUpdate);

  // 9. 重新开启会自动全量推送
  sync.setEnabled(true);
  await new Promise(function (r) { setTimeout(r, 50); });
  check('9 重新开启自动全量推送', cloud.doc.courses.length === 1 && cloud.doc.courses[0].name === '新');

  // 10. restoreFromCloud 覆盖本地
  cloud.doc.courses = [{ id: 'cloud1', name: '云课1' }, { id: 'cloud2', name: '云课2' }];
  cloud.doc.grades = [{ name: '云成绩', credit: 2, score: 70 }];
  mem['kb_courses'] = [{ id: 'z', name: '将被覆盖' }];
  var res = await sync.restoreFromCloud();
  check('10 从云端恢复覆盖本地', res.ok === true && mem['kb_courses'].length === 2 && mem['kb_grades'].length === 1);

  // 11. 云端无记录时恢复失败并给出提示
  cloud.doc = null;
  var res2 = await sync.restoreFromCloud();
  check('11 云端无数据时恢复返回错误', res2.ok === false && !!res2.error);

  // 12. 推送失败时记录错误但不抛异常（模拟查询被拒绝）
  wx.cloud.database = function () {
    return {
      collection: function () {
        return {
          limit: function () {
            return { get: function () { return Promise.reject({ errMsg: 'db request failed' }); } };
          }
        };
      }
    };
  };
  var syncFresh = load('sync.js'); // 全新实例（state 未初始化）
  syncFresh.init();
  var r5 = await syncFresh.pushCourses([{ id: 'q' }]);
  check('12 推送失败不抛异常且记录错误', r5 === false && syncFresh.getStatus().lastError.indexOf('failed') >= 0);

  console.log('------------------');
  console.log('通过 ' + pass + ' / ' + (pass + fail));
  if (fail > 0) process.exit(1);
})();