# My Class 课助

山东大学个人课程表微信小程序（个人主体）。课表展示、截图 OCR 导入、分享码互导、课前订阅消息提醒、云同步与快照备份。

- **代码位置**：`C:\Users\mzzzz\Desktop\MyClass课助`（本目录即开发主副本）
- **GitHub**：`https://github.com/mzmm0/my-class-kezhu`（私有仓库，凭据已存 Windows 凭据管理器）
- **微信 AppID**：见 `project.config.json`；**云环境 ID**：见 `utils/cloudconf.js`
- **当前版本**：v1.2.3（提交历史见 `git log`，从 v1.0 至今全程可溯）

## 项目结构

```
app.js / app.json / app.wxss    小程序入口（两 tab：课表/设置）
pages/schedule/                 课表页（网格渲染、OCR 导入流程、导出图片、分享码）
pages/settings/                 设置页（学期起止、周数、云同步、快照、清空、课前提醒订阅）
utils/ocrparse.js               OCR 解析器（行带算法：行头切带归位大节，1 大节=2 小节）
utils/parse.js / store.js / sync.js / sharecode.js / gpa.js / presets.js / date.js
cloudfunctions/ocrTable/        OCR 云函数（腾讯云三层引擎：RecognizeTableOCR→TableOCR→GeneralAccurateOCR，返回 points 坐标+row/rowSpan 行号）
cloudfunctions/courseRemind/    每日 07:00 定时扫描云端课表，推送订阅消息（模板 ID 走环境变量）
assets/ocr-sample.jpg           截图导入的教学示例图（教务课表）
tests/                          6 套回归测试（可独立 node 运行）
```

## 关键换算约定（教务课表 → 小程序）

教务"第 N 大节" = 小程序第 **2N-1、2N** 小节（如第 1 大节 = 第 1、2 节）。

## 如何跑测试

```
cd tests
node test-ocrparse.js     # 32 项（解析器）
node test-mp-utils.js     # 73 项（工具函数）
node test-snapshot.js     # 15 项（快照）
node test-sync.js         # 12 项（云同步）
node test-schedule.js     # 课表页逻辑
node verify-import.js     # 真实教务课表文本校验
```

## 如何部署云函数（改动 cloudfunctions/ 后必做）

微信开发者工具 → 云开发 → 对应云函数右键 → **上传并部署（云端安装依赖）**。
`ocrTable` 需在云开发控制台配环境变量：`TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY`（腾讯云密钥，不写进代码）。
`courseRemind` 需配 `REMIND_TEMPLATE_ID`（公众平台申请的订阅消息模板 ID）。

## 如何上传新版

微信开发者工具 → 右上角"上传"（版本号递增）→ 公众平台设为体验版/提交审核。

## 桌面这份被误删后如何恢复（重要）

任选其一：

1. **找 AI 助手（推荐）**：开新对话说——
   > "帮我把 GitHub 上的 mzmm0/my-class-kezhu 仓库克隆到我的桌面，文件夹叫 MyClass课助"
   助手执行 `git clone` 即可完整恢复（含全部历史提交）。git 不在 PATH 时用完整路径：`C:\Program Files\Git\cmd\git.exe`。
2. **网页手动下载**：打开 github.com 登录账号 mzmm0 → 进入 my-class-kezhu → 绿色 Code 按钮 → Download ZIP → 解压到桌面。注意：ZIP **不含 git 历史**，恢复的是文件；要继续推送 GitHub 需重新关联远程或在文件夹里 `git init` 后重连。
3. **另一台电脑**：同样 `git clone`，但需先在 Windows 凭据管理器（或 git 命令行）登录一次 GitHub 账号。

注意 GitHub 是**私有仓库**：不登录任何人都看不到，所以账号密码别丢（浏览器记住了，别清）；即使仓库也误删，桌面回收站、`.temp/` 旧副本仍可能留有文件。

## 给接手 AI 的上下文提示

- 修改代码后跑 `tests/` 回归，全绿再 `git add -A && git commit && git push`
- 网络偶发连接重置：已配 `http.version HTTP/1.1` 与大 postBuffer，失败等待后重试即可
- 微信小程序无法读系统闹钟，提醒用订阅消息实现（个人主体仅一次性订阅）
- 勿在云开发控制台手动编辑 `kb_user_data` 记录（会被同步逻辑覆盖）

> AI生成
