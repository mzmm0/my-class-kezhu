// 分享码 / 备份码：纯文本编码，不需要服务器
var PREFIX = 'KBQ1:';

function encodeShare(type, data) {
  try {
    return PREFIX + encodeURIComponent(JSON.stringify({ t: type, d: data }));
  } catch (e) {
    return '';
  }
}

function decodeShare(code) {
  try {
    var s = String(code === null || code === undefined ? '' : code).trim();
    if (s.indexOf(PREFIX) !== 0) return null;
    s = decodeURIComponent(s.slice(PREFIX.length));
    var obj = JSON.parse(s);
    if (!obj || !obj.t) return null;
    return obj;
  } catch (e) {
    return null;
  }
}

module.exports = {
  encodeShare: encodeShare,
  decodeShare: decodeShare
};
