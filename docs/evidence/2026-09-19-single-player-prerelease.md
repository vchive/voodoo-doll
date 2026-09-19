# 2026-09-19 至 2026-09-20 单人预发布闭环验证记录

范围：`MW-27` / `MW-AC-27`，关联 `SP-01` 至 `SP-10`。本记录区分源码存在、自动化通过和真实环境验证；未执行项不视为通过。

## 当前实现

- `backend/app/sessions.py`：匿名 `voodoo_session` cookie 解析为 SQLite `sessions` 表中的唯一 world；进程内 kernel cache 只作优化。
- `backend/app/gameplay.py`：首次故事与行动均先生成草稿；确认/取消复用 Kernel，故事和行动确认回执按 world 持久化；移动确认后按服务端新房间刷新兴趣范围。
- `backend/app/api/app.py`：提供 `/api/v4/session`、`/api/v4/play/story*`、`/api/v4/play/intent*` 和存档导入导出端点，同时保留已有 `/api/v4` Kernel API；API/健康检查路由优先于可选的同源 `dist-hex` 静态入口。
- HTTP 边界：产品写请求校验同源/允许的 `Origin` 和请求体大小；非产品 `/api/v4/*` 与 `/internal/*` 在未配置 `WORLD_ADMIN_TOKEN` 时关闭，配置后要求 Bearer token。
- `backend/app/store/event_store.py`：保存 session-world 映射与 gameplay receipts；事件身份按 `(world_id, event_id)` 隔离并可迁移旧 schema。
- `hex/play-state.ts`、`hex/play-api.ts`、`hex/play.ts`、`hex/play.css`：本机状态校验与旧记录归一化、同源 cookie API 客户端、故事/行动预览确认、快捷行动、中文错误和无网络本地回退入口。离线保存使用带 `sourceKey`/`schemaVersion` 的单人 envelope；旧的裸 `LocalState` 导出仍可识别。

## 已执行自动化

命令：

```text
PYTHONPATH=. python3 -m unittest backend.tests.test_single_player_api -v
```

结果：7/7 通过，耗时 0.341 秒。

覆盖：

- 两个匿名 cookie 创建不同 world；在请求体伪造另一 world 的 `worldId` 不能切换所有权。
- 行动预览不推进 `worldVersion`；同一行动确认重试返回完全相同结果。
- 故事确认重试返回首次回执；未知故事草稿返回 404。
- 故事/行动取消后不能确认；另一匿名会话不能确认或取消不属于自己的草稿。
- 移动到办公室后快照和兴趣范围包含 A，随后询问由 A 产生回应事件。
- 使用同一 SQLite 和 cookie 重建应用后，娃娃资料恢复；当前 `voodoo-single-v1` 导出可以重新导入当前 world。
- `voodoo-hex-v5` 和 `voodoo-cabinet-v1` 可通过 HTTP 导入并强制为 SFW；坏档返回 422 且不覆盖当前状态。
- 跨站写请求返回 403，超过配置上限的请求体返回 413；未配置管理令牌时非产品 Kernel/internal 路由不可用，配置后只接受正确的 Bearer token。

同轮最终已执行：

```text
PYTHONPATH=. python3 -m unittest backend.tests.test_world_kernel -v
PYTHONPATH=. python3 -m unittest discover -s backend/tests -v
npm test
npm run typecheck
npm run build
npm run hex:build
python3 -m compileall -q backend
node --check app.js
```

2026-09-20 最终结果：Python 全量 103/103 通过，Node 79/79 通过，TypeScript 类型检查、两个 Vite 构建、Python 编译检查和旧入口语法检查均通过。新增 Node 用例覆盖旧/损坏本机状态归一化、明确的离线存档格式标识、旧裸 `LocalState` 导入格式推断、本机已完成世界识别，以及未确认故事预览和原始世界版本恢复。`test_static_serving.py` 3/3 覆盖配置构建目录的首页与资产、健康检查和 API 路由优先、未知 API 404、构建目录缺失时 API-only 启动，以及源码、`.env`、SQLite、目录列表和路径穿越拒绝。运行于 `http://127.0.0.1:18766` 的同源服务上复核这些敏感路径，均返回 404。

## 桌面 Chrome 移动视口验收

Chrome 153 在 320×568、390×844、430×932 三档移动视口仿真中均完成故事预览与确认、移动到办公室、激活并询问 A、刷新恢复和双浏览器上下文隔离。故事预览不推进世界；刷新后保持 `roomId=office`、`worldVersion=5`；两个上下文的 `worldId` 不同，第二个 profile 为空。422 领域错误保持在线且不生成本地 pending 分叉。三档页面均无横向溢出、控件重叠、文字裁切、未预期控制台错误或网络失败。Canvas 内部分辨率为 288×256；390×844 下显示区域为 322×286，像素范围与人工截图检查均确认非空。

自动化记录位于 `/tmp/voodoo-prerelease-browser-report.json` 和 `/tmp/voodoo-layout-report.json`；过程截图为 `/tmp/voodoo-prerelease-01-story-preview.png` 至 `/tmp/voodoo-prerelease-07-isolated-context.png`，补充布局截图为 `/tmp/voodoo-layout-320-onboarding.png`、`/tmp/voodoo-layout-320-play.png`、`/tmp/voodoo-layout-430-onboarding.png` 和 `/tmp/voodoo-layout-430-play.png`。

人物合法选择 `silence` 时，前端现在显示“沉默了一会儿，没有回答。”，避免用户误以为响应丢失。以上仅是桌面 Chrome 移动视口仿真验收，不代表微信 iOS/Android 真机或公网/HTTPS 验证通过。

## 2026-09-20 SP-07–10 增量验收

在 Chrome 153、390×844 桌面移动视口中补测了新增的启动恢复、行动可发现性、防重复和中文错误路径：

- 旧格式缓存会补齐缺失的日志、快照和时钟字段；非法地点、损坏日志/角色/关系项和无效 pending 被清除。完全损坏或非对象缓存不造成白屏，可从服务端世界恢复或回到首次进入界面。
- 主界面显示当前地点和在场角色，并提供观察、等待、与在场人物交谈及地点移动按钮。11 个注册地点逐一点击并确认后，服务端返回的 `roomId` 与所选地点精确一致。
- 故事、行动、确认、取消和导入期间显示处理状态并禁用冲突控件；快速重复触发只产生一个预览/确认链，没有重复世界变更。
- 稳定错误码在产品界面显示中文说明；没有向玩家暴露英文协议错误、异常正文或堆栈。
- 取消行动后 `worldVersion`、`roomId` 和事件均不变化，pending 被清除，证明取消没有副作用。
- 离线试玩导出带 `sourceKey=voodoo-single-v1`、`schemaVersion=1` 和单人 payload；随后在在线会话中导入，娃娃资料、故事和地点恢复。旧版裸 `LocalState` 文件也会推断为 `voodoo-single-v1`，不会误判为旧单娃娃格式。
- 未确认的故事预览刷新后仍显示原草稿，可继续确认；保存的 `worldVersion` 用于原版本确认，不会默认为刷新后的快照版本。
- 清除匿名 cookie、让服务端创建空 world 后，本机已完成世界的办公室位置和版本保持不变，页面明确提示先导出再导入或重新确认故事；导出的仍是保留的本机进度。
- 导入请求进行时，导出、再次导入、输入框和全部快捷行动均被禁用；行动预览存在时导入/导出同样禁用，避免与确认响应竞态。
- 导入损坏 JSON 后，首次进入表单和“搭一个预览”按钮恢复可用，无需刷新页面。
- 故事确认已在服务端成功、但浏览器连接在收到响应前中断时，本机仍保留 story pending；刷新后通过服务端 ready profile 消解该 pending，主游戏、输入和导入/导出均恢复可用。
- 导出请求挂起时，输入框和发送按钮锁定；请求失败回退为本机导出后，未提交的输入原文保持不变。
- 即时行动行改为换行显示并提高视觉对比；进入有角色的地点后，“和角色聊聊”不会隐藏在横向滚动区域，地点列表仍保持横向滚动以控制页面长度。

截图：

- `/tmp/voodoo-prerelease-actions.png`：当前地点、在场人物、中文错误与快捷行动。
- `/tmp/voodoo-prerelease-all-locations.png`：11 个地点逐一精确移动的结果。
- `/tmp/voodoo-prerelease-offline-imported.png`：离线导出后在线导入的恢复结果。
- `/tmp/voodoo-prerelease-recovery.png`：cookie 变化后的本机进度恢复及导入完成结果。

四张截图均为 390×844。它们只证明桌面 Chrome 移动视口中的前端与本机同源服务路径，不代替微信 WebView 或公网环境验收。

补充恢复脚本 `/tmp/voodoo-prerelease-edge-playtest.mjs` 返回 `badImportRecovered=true`、`lostStoryResponseRecovered=true`、`exportLocksAndPreservesInput=true`，且 `errors=[]`。该脚本是本轮临时验收工具，不属于产品运行时。

## 尚待验证

- 跨连接/重启后的故事与行动重复确认回执。
- 非产品 Kernel 路由默认关闭已有单例测试；伪造 `viewer`、`sessionId` 路径和 private 事件读取的完整端到端越权矩阵仍待验证。
- `WORLD_DB_PATH`、`WORLD_STATIC_DIR`、cookie secure 的生产默认值冻结；多进程下 per-world 串行策略。
- 微信 iOS/Android 真机、模型开启路径和服务器外公网/HTTPS 均未执行。
- 当前试玩内容仍以基本叙述、移动、等待和对话为主，世界丰富度与长期游玩内容尚未达到正式发布标准。

## 结论

本机单人预发布候选已收口，可以进入预发布阶段。MW-27 仍按 SDD 记为“部分完成”，因为它还包含正式发布环境的验收。匿名 world 隔离、preview-confirm-cancel、跨会话草稿隔离、幂等回执、移动后的兴趣范围、SQLite 重启恢复、当前/旧格式导入导出、旧/损坏缓存恢复、快捷行动、请求防重复、中文产品错误、取消无副作用、11 地点精确移动、离线导出到在线导入往返、坏导入恢复、故事确认响应丢失恢复、输入保护、HTTP 写入保护、管理接口令牌、静态敏感路径拒绝、320×568/390×844/430×932 基础闭环及 390×844 SP-07–10 增量桌面 Chrome 移动视口验收已有证据。完整越权矩阵、生产配置、微信 iOS/Android 真机、公网/HTTPS 和试玩内容丰富度仍需完成。
