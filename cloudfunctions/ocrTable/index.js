// 云函数：课表截图 -> 腾讯云 TableOCR 表格识别 -> 返回单元格文本网格
// 密钥通过云函数环境变量注入（TENCENT_SECRET_ID / TENCENT_SECRET_KEY），不写入代码
const cloud = require('wx-server-sdk');
const https = require('https');
const crypto = require('crypto');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// ---------- 腾讯云 API 3.0 签名请求（最小实现，不引入额外依赖） ----------
function tencentRequest(action, payload, credentials) {
  const service = 'ocr';
  const host = 'ocr.tencentcloudapi.com';
  const region = 'ap-guangzhou';
  const version = '2018-11-19';
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);

  const payloadStr = JSON.stringify(payload);
  // 1) 拼接规范请求串
  const httpRequestMethod = 'POST';
  const canonicalUri = '/';
  const canonicalQueryString = '';
  const canonicalHeaders =
    'content-type:application/json\n' +
    'host:' + host + '\n';
  const signedHeaders = 'content-type;host';
  const hashedRequestPayload = crypto.createHash('sha256').update(payloadStr).digest('hex');
  const canonicalRequest =
    httpRequestMethod + '\n' + canonicalUri + '\n' + canonicalQueryString + '\n' +
    canonicalHeaders + '\n' + signedHeaders + '\n' + hashedRequestPayload;

  // 2) 拼接待签名字符串
  const algorithm = 'TC3-HMAC-SHA256';
  const credentialScope = date + '/' + service + '/tc3_request';
  const hashedCanonicalRequest = crypto.createHash('sha256').update(canonicalRequest).digest('hex');
  const stringToSign =
    algorithm + '\n' + timestamp + '\n' + credentialScope + '\n' + hashedCanonicalRequest;

  // 3) 计算签名密钥
  const secretDate = crypto.createHmac('sha256', 'TC3' + credentials.secretKey).update(date).digest();
  const secretService = crypto.createHmac('sha256', secretDate).update(service).digest();
  const secretSigning = crypto.createHmac('sha256', secretService).update('tc3_request').digest();
  const signature = crypto.createHmac('sha256', secretSigning).update(stringToSign).digest('hex');

  const authorization =
    algorithm + ' ' +
    'Credential=' + credentials.secretId + '/' + credentialScope + ', ' +
    'SignedHeaders=' + signedHeaders + ', ' +
    'Signature=' + signature;

  // 4) 发请求
  const options = {
    hostname: host,
    method: 'POST',
    path: '/',
    headers: {
      'Content-Type': 'application/json',
      'Host': host,
      'X-TC-Action': action,
      'X-TC-Version': version,
      'X-TC-Region': region,
      'X-TC-Timestamp': timestamp,
      'Authorization': authorization
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(payloadStr);
    req.end();
  });
}

// 图片下载为 Buffer
function downloadToBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) { reject(new Error('下载失败 ' + res.statusCode)); return; }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

exports.main = async (event) => {
  const secretId = process.env.TENCENT_SECRET_ID;
  const secretKey = process.env.TENCENT_SECRET_KEY;
  if (!secretId || !secretKey) {
    return { ok: false, error: '云函数未配置腾讯云密钥（环境变量 TENCENT_SECRET_ID / TENCENT_SECRET_KEY）' };
  }

  let imageBase64 = '';
  if (event.fileID) {
    // 云存储文件：下载后转 base64
    const dl = await cloud.downloadFile({ fileID: event.fileID });
    imageBase64 = dl.fileContent.toString('base64');
  } else if (event.imageBase64) {
    imageBase64 = event.imageBase64;
  } else if (event.imageUrl) {
    const buf = await downloadToBuffer(event.imageUrl);
    imageBase64 = buf.toString('base64');
  } else {
    return { ok: false, error: '未提供图片（fileID / imageBase64 / imageUrl）' };
  }

  // ---------- 识别：三层策略 ----------
  try {
    const creds = { secretId, secretKey };
    let result = null;
    let engineUsed = '';
    let points = null;
    let debugCell = null;

    // 层1：表格识别 V3（RecognizeTableOCR，对彩色/难例表格效果好）
    try {
      const respV3 = await tencentRequest('RecognizeTableOCR', { ImageBase64: imageBase64 }, creds);
      const b3 = respV3.Response || {};
      if (!b3.Error && b3.TableDetections && b3.TableDetections.length) {
        const det = (b3.TableDetections && b3.TableDetections[0]) || {};
        const v3Cells = det.Cells || det.MergedCells || [];
        result = normalizeV3(b3);
        engineUsed = 'v3';
        // 坐标提取：V3 Cell 自带 Polygon（四角点矩形），取 bounding box；
        // 同时透传行号语义（RowTl/RowBr）——行头 cell 建立 RowTl->大节号 映射，
        // 课程 cell 附带 row（所在大节）/rowSpan（跨大节数），前端优先用行号归位
        const rowToPeriod = {};
        v3Cells.forEach(c => {
          if (c.RowTl === undefined) return;
          const t = String(c.Text || '').replace(/\s/g, '');
          const re = /第([0-9一二三四五六七八九十]+)节/g;
          const ks = [];
          let mm;
          while ((mm = re.exec(t))) {
            const nn = cnToIntTencent(mm[1]);
            if (nn >= 1 && nn <= 12) ks.push(nn);
          }
          if (!ks.length) return;
          const rowsSpan = (c.RowBr !== undefined ? c.RowBr : c.RowTl + 1) - c.RowTl;
          ks.forEach((nn, i) => {
            const r = c.RowTl + Math.round(rowsSpan * i / ks.length);
            if (!rowToPeriod[r]) rowToPeriod[r] = nn;
          });
        });
        points = v3Cells.filter(c => c.Text && String(c.Text).trim()).map(c => {
          const rc = rectFromPolygon(c.Polygon) || deepFindRect(c);
          const p = { text: c.Text, x: rc.x, y: rc.y, w: rc.w, h: rc.h };
          if (c.RowTl !== undefined) {
            if (rowToPeriod[c.RowTl]) p.row = rowToPeriod[c.RowTl];
            if (c.RowBr !== undefined && c.RowBr - c.RowTl > 1) p.rowSpan = c.RowBr - c.RowTl;
          }
          return p;
        });
        // 调试：透传第一个单元格的原始 JSON（定位真实字段名后移除）
        if (v3Cells.length) {
          try { debugCell = JSON.stringify(v3Cells[0]).slice(0, 600); } catch (e) {}
        }
      }
    } catch (e) { /* 降级 */ }

    // 层2：表格识别 V2（TableOCR）
    if (!result || !result.rows.length) {
      const respV2 = await tencentRequest('TableOCR', { ImageBase64: imageBase64 }, creds);
      const b2 = respV2.Response || {};
      if (b2.Error) {
        return { ok: false, error: 'OCR失败: ' + b2.Error.Code + ' ' + b2.Error.Message };
      }
      const detections = b2.TableDetections || [];
      if (detections.length) {
        const v2Cells = detections[0].Cells || [];
        result = normalizeV2(v2Cells);
        engineUsed = 'v2';
        points = v2Cells.filter(c => c.Text && String(c.Text).trim()).map(c => {
          const rc = rectFromPolygon(c.Polygon) || deepFindRect(c);
          return { text: c.Text, x: rc.x, y: rc.y, w: rc.w, h: rc.h };
        });
        if (v2Cells.length) {
          try { debugCell = JSON.stringify(v2Cells[0]).slice(0, 600); } catch (e) {}
        }
      }
    }

    // 层3：通用文字识别（GeneralAccurateOCR）+ 坐标聚类重建网格
    if (!result || !result.rows.length) {
      const respGen = await tencentRequest('GeneralAccurateOCR', { ImageBase64: imageBase64 }, creds);
      const bG = respGen.Response || {};
      if (bG.Error) {
        return { ok: false, error: 'OCR失败: ' + bG.Error.Code + ' ' + bG.Error.Message };
      }
      const texts = bG.TextDetections || [];
      // 同时返回：坐标重建的行 + 原始带坐标文本块（前端可精确对齐列）
      result = normalizeGeneric(texts);
      engineUsed = 'generic';
      // 注意：GeneralAccurateOCR 返回的坐标字段是 ItemPolygon（X/Y/Width/Height）与 Polygon（四角点），
      // 并无 ItemCoord（那是 GeneralBasicOCR 的字段）；这里按优先级兼容三者，取不到坐标的块直接丢弃
      const rawPoints = texts.map(t => {
        const c = t.ItemPolygon || t.ItemCoord;
        if (c && typeof c.X === 'number') {
          return { text: t.DetectedText || '', x: c.X, y: c.Y, w: c.Width || 0, h: c.Height || 0 };
        }
        if (t.Polygon && t.Polygon.length >= 4) {
          const xs = t.Polygon.map(p => p.X), ys = t.Polygon.map(p => p.Y);
          const x0 = Math.min.apply(null, xs), y0 = Math.min.apply(null, ys);
          return { text: t.DetectedText || '', x: x0, y: y0, w: Math.max.apply(null, xs) - x0, h: Math.max.apply(null, ys) - y0 };
        }
        return null;
      }).filter(p => p && p.text && p.text.trim());
      return { ok: true, engine: 'generic', rows: result.rows, points: rawPoints };
    }

    if (!result || !result.rows.length) {
      return { ok: false, error: '未识别到表格内容，请换一张更清晰、完整包含表头的课表截图' };
    }
    return { ok: true, engine: engineUsed, rows: result.rows, points: points, debugCell: debugCell, cells: result.cells || null };
  } catch (e) {
    return { ok: false, error: '云函数异常: ' + e.message };
  }
};

// 四角点 Polygon（[{X,Y}...至少3个不共线顶点]）-> 矩形 bounding box
// V3/V2 表格引擎的 Cell 坐标即此形态；取不到返回 null 走 deepFindRect 兜底
function rectFromPolygon(poly) {
  if (!poly || !poly.length || typeof poly[0].X !== 'number') return null;
  const xs = poly.map(p => p.X), ys = poly.map(p => p.Y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
}

// 中文数字 -> 阿拉伯数字（行头"第X节"编号用）
const CN_NUM_T = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
function cnToIntTencent(s) {
  s = String(s || '').trim();
  if (/^\d+$/.test(s)) return +s;
  if (s === '十') return 10;
  if (s.length === 2 && s[0] === '十') return 10 + (CN_NUM_T[s[1]] || 0);
  if (s.length === 2 && s[1] === '十') return (CN_NUM_T[s[0]] || 0) * 10;
  if (s.length === 3 && s[1] === '十') return (CN_NUM_T[s[0]] || 0) * 10 + (CN_NUM_T[s[2]] || 0);
  return CN_NUM_T[s] || 0;
}

// 深度递归在任意 JSON 结构中找矩形坐标：
// 匹配 PointX/PointY 或 X/Y（配 Width/Height 可选），返回首个命中
function deepFindRect(obj, depth) {
  depth = depth || 0;
  if (depth > 8 || !obj || typeof obj !== 'object') return { x: 0, y: 0, w: 0, h: 0 };
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const r = deepFindRect(item, depth + 1);
      if (r.x || r.y) return r;
    }
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  // 本层是否像坐标对象
  const hasPX = typeof obj.PointX === 'number';
  const hasX = typeof obj.X === 'number';
  if (hasPX || hasX) {
    return {
      x: hasPX ? obj.PointX : obj.X,
      y: hasPX ? (typeof obj.PointY === 'number' ? obj.PointY : 0) : (typeof obj.Y === 'number' ? obj.Y : 0),
      w: typeof obj.Width === 'number' ? obj.Width : (typeof obj.CW === 'number' ? obj.CW : 0),
      h: typeof obj.Height === 'number' ? obj.Height : (typeof obj.CH === 'number' ? obj.CH : 0)
    };
  }
  // 递归子属性
  for (const k of Object.keys(obj)) {
    const r = deepFindRect(obj[k], depth + 1);
    if (r.x || r.y) return r;
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}

// ---------- 结果归一化 ----------
// V3：TableDetections[0].Cells 带 RowIndex/ColIndex（或 Type/Coord）——按官方返回字段适配
function normalizeV3(body) {
  const det = (body.TableDetections && body.TableDetections[0]) || {};
  const cells = det.Cells || det.MergedCells || [];
  const hasIdx = cells.length && (cells[0].RowIndex !== undefined || cells[0].ColIndex !== undefined);
  if (hasIdx) {
    let maxR = 0, maxC = 0;
    cells.forEach(c => {
      const r = c.RowIndex || 0, co = c.ColIndex || 0;
      if (r > maxR) maxR = r;
      if (co > maxC) maxC = co;
    });
    const grid = [];
    for (let i = 0; i <= maxR; i++) grid.push(new Array(maxC + 1).fill(''));
    cells.forEach(c => { grid[c.RowIndex || 0][c.ColIndex || 0] = (c.Text || '').trim(); });
    return { rows: grid.filter(r => r.join('')) };
  }
  // 无行列号时按坐标聚类
  return normalizeByCoord(cells.map(c => ({
    text: c.Text || (c.Contents && c.Contents.Text) || '',
    x: c.Coord ? c.Coord.PointX : 0,
    y: c.Coord ? c.Coord.PointY : 0
  })));
}

// V2：Cells 只有 Coord（PointX/PointY 中心点）与 Text，按坐标聚成行列
function normalizeV2(cells) {
  return normalizeByCoord(cells.map(c => ({
    text: c.Text || '',
    x: c.Coord ? c.Coord.PointX : 0,
    y: c.Coord ? c.Coord.PointY : 0
  })));
}

// 通用 OCR：按 ItemPolygon（优先）/ItemCoord/Polygon 提取坐标，行聚类、列分桶
function normalizeGeneric(items) {
  if (!items.length) return { rows: [] };
  const pts = items.map(it => {
    const c = it.ItemPolygon || it.ItemCoord;
    if (c && typeof c.X === 'number') {
      return { text: it.DetectedText || '', x: c.X + (c.Width || 0) / 2, y: c.Y + (c.Height || 0) / 2, h: c.Height || 0 };
    }
    if (it.Polygon && it.Polygon.length >= 4) {
      const xs = it.Polygon.map(p => p.X), ys = it.Polygon.map(p => p.Y);
      const x0 = Math.min.apply(null, xs), y0 = Math.min.apply(null, ys);
      return { text: it.DetectedText || '', x: x0 + (Math.max.apply(null, xs) - x0) / 2, y: y0 + (Math.max.apply(null, ys) - y0) / 2, h: Math.max.apply(null, ys) - y0 };
    }
    return { text: it.DetectedText || '', x: 0, y: 0, h: 0 };
  }).filter(p => p.text && String(p.text).trim());
  return normalizeByCoord(pts);
}

// 坐标聚类：y 接近的为一行；行内按 x 排序；再按 x 空档分列
function normalizeByCoord(pts) {
  pts = pts.filter(p => p.text && String(p.text).trim());
  if (!pts.length) return { rows: [] };
  pts.sort((a, b) => a.y - b.y || a.x - b.x);
  // 行聚类：y 差超过行高阈值（取前 3 个文本块高度的中位数，缺省 20px）即换行
  const hs = pts.slice(0, 5).map(p => p.h || 0);
  const rowH = Math.max(12, (hs[0] || 20));
  const rows = [];
  let cur = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (Math.abs(pts[i].y - cur[0].y) > rowH) {
      rows.push(cur);
      cur = [pts[i]];
    } else cur.push(pts[i]);
  }
  rows.push(cur);
  // 输出：每行为 [text, ...]（按 x 排序拼接）
  const outRows = rows.map(r => {
    r.sort((a, b) => a.x - b.x);
    return r.map(c => c.text.trim());
  });
  return { rows: outRows.filter(r => r.join('')) };
}