# 2026-09-20 · signal-rain-v1 新故事验证

对象：默认 `templateId=signal-rain-v1/version=1`《红灯下的第三次回声》。任务 MW-28–31，要求 SP-11–16，验收 MW-AC-28–31。来源见[研究记录](../research/2026-09-20-signal-man-adaptation.md)，规则见[故事规格](../specs/004-multi-agent-world/tutorial-story.md)。当前三日短篇本机可通关，不代表长篇内容或完整预发布完成。

## 自动化与实际试玩

- Python 3.9.6：`PYTHONPATH=. python3 -m unittest discover -s backend/tests -q` **159/159**；其中新故事专项 **14/14**。
- Node v22.23.1：`npm test` **96/96**；`npm run typecheck`、`npm run build`、`npm run hex:build`、`python3 -m compileall -q backend`、`git diff --check` 通过。
- 独立临时 SQLite、127.0.0.1:18769 的真实 socket HTTP **220 次请求全部成功**，包括 trust/station、audit/station、protect/kitchen、missed，以及 audit/kitchen 导出后在新 cookie 会话导入续玩。包含源码校验值的[摘要](2026-09-20-signal-http-summary.json)已保存；完整轨迹仅在 `/tmp/voodoo-signal-final-http-results.json`，不作为长期仓库依赖。此 HTTP 轮次后增加了中文笔记展示、睡眠事件真实耗时与严格存档结构校验；其增量以最终专项测试为准。
- 内置浏览器工具报告 `unsupported Codex auth method: apikey`。改用 Playwright 启动独立无头 Google Chrome，临时数据库及 18770，按真实页面按钮完成故事。没有直接改游戏状态来跳步。
- **390×844：trust/station，320×844：protect/kitchen，320×568：audit/station** 均从故事库确认到 complete。每条正常流程 21 次确认行动；逐句点击约 168 次（含环境反馈和回家/到馆场景变化）。自动点击耗时不是人的完整阅读时长。每段检查无横向溢出，三条路线均无页面脚本错误。
- 浏览器还验证开篇刷新保留阅读位置、剧情动作高亮/明确入口、睡前回家入口、结局差异；第三条路线额外检查输入示例来自可执行 intent，以及调查笔记出现。可复核[前两路线结果](2026-09-20-signal-browser.json)和[界面修正后审计路线](2026-09-20-signal-browser-polish.json)。截图位于 `/tmp/voodoo-signal-{320,390}-{opening,ending}.png`，本轮已实际查看；临时截图不代替 JSON/测试证据。

## 行为矩阵

| 范围 | 实际结果 |
| --- | --- |
| 三日剧情与明确选择 | 三种立场均能完成，最终立场可不同于首日；“不要公开”优先识别为保护 |
| 普通动作 | 开门、看桌子、闲聊不会自动选择结局；等待、观察、只看录音机不获得录音 |
| 证据分路 | 车站获得交班材料，厨房获得录音；结局、当面回应、笔记不声称另一项已得 |
| 时限 | 首日开篇或选择阶段错过10点、第三日错过中午均成为不可逆missed；结束仍可自由探索 |
| 角色离场 | 绕路到花园与周野交班后均无缺席NPC对白；过沈青窗口不授予录音；公开交班簿仍需实际查看 |
| 回家/睡眠 | 回家不跳日；只允许对应阶段在家明确睡觉；最终时钟、事件耗时、人物位置一致，不再声称只等120分钟 |
| 预览/恢复 | 睡眠预览/取消无变化；新世界导入恢复道具/事实/日期后可通关；旧模板原回归通过 |
| 模板隔离 | 发布与导入 v1/v2/custom 六种组合清理信号道具、桌子说明、日程和环境音 |
| 阅读与行动 | 世界权威与阅读游标分离；新signal动作归入剧情推进；输入提示不再用无法解析的按钮标题；调查笔记可回看 |

## 本机入口与上传边界

原本 18766 进程实际使用 `/tmp/voodoo-review.sqlite3`，不是旧文档写的 data/world.sqlite3。重启前通过 SQLite backup 保存到 `/tmp/voodoo-review-before-signal-20260920.sqlite3`，随后使用原数据库启动新代码；未清空用户会话或故事。`http://127.0.0.1:18766/`、`/healthz` 和首页引用资产均返回200。刷新后从“故事库 → 开始新手故事”使用新模板，旧故事不自动升级；确认新故事沿用前端原有旧进度备份流程。这只是本机HTTP验证。

GitHub `vchive/voodoo-doll/main` 已成功推送实现提交 `63c12a2`；同步与站点部署分开管理。上传排除密钥、数据库和构建产物。上传复核发现五张 LPC 本地比较图曾被历史提交跟踪，本次仅从当前索引移除并加入ignore，本机图保留；没有改写历史，详见 CREDITS.md。

## 评测结论与未完成项

新版能够靠推荐行动从开场通关；比旧稿增加了日常细节、明确人物动机、重复警报的伏笔回收和缺证据结局。当前依然主要靠固定文稿，只有一条核心调查链及第二日二选一入口；每个推荐动作仍需预览确认，长文本页面仍需滚动。多人路线、持续生活后果、演出层次和长时间阅读体验仍需继续制作，不能称为用户要求的长篇标杆已经完成。

未验证：完整人工阅读时长、微信iOS/Android真机、公网HTTPS、完整网络丢响应/存储失败矩阵。旧rainy-office-v2四类已知问题未修，仅保留兼容；原旧测试通过不证明那些玩法缺陷已消失。
