const store = require('./utils/store');

App({
  onLaunch: function () {
    // 初始化本地设置（仅本机存储，不上传任何数据）
    store.loadSettings();
  },
  globalData: {}
});
