const store = require('./utils/store');
const sync = require('./utils/sync');

App({
  onLaunch: function () {
    // 本地优先：先保证本地可用（秒开、离线可用）
    store.loadSettings();

    // 云端兜底：初始化云开发，本地缺失的数据从云端补回
    if (sync.init()) {
      sync.pullAll().then(function (doc) {
        if (doc) {
          // 云端有数据且本地缺失 -> 通知页面刷新
          var pages = getCurrentPages();
          if (pages && pages.length) {
            var cur = pages[pages.length - 1];
            if (cur && typeof cur.refresh === 'function') cur.refresh();
            else if (cur && typeof cur.onShow === 'function') cur.onShow();
          }
        }
      });
    }
  },
  globalData: {}
});