# 002 技术方案 · Pi 角色与像素展示

2026-09-18。用户已批准实施决策 0004，并选择「精致像素小人：保留像素房间，提升人物比例和动作」。本轮范围为运行时、确认存档和人物展示；002 其他叙事功能继续单独跟踪。

## 接入边界

- 保留 Node ESM、PixiJS、v3 beats 契约和房间寻路。Pi Core/Pi AI 管角色工具循环，固定版本的社区 Team core 管定向通讯；不加载 coding/TUI/文件或 Shell 工具。
- 玩家输入与确认故事只传娃娃。A/B/C 获得自己已确认的记忆和当前公开舞台事件；ENV 仅反馈环境交互。角色输出先校验再提交为草稿。
- `GameStore` 使用服务端 SQLite，匿名凭证由同源 HttpOnly cookie 持有。客户端不能用 worldId 访问他人世界。生成、确认、取消有 turnId/version，确认原子且幂等；重启作废未确认草稿，恢复已确认状态。
- `GET/POST /api/session` 获取/建立会话，`POST /api/profile` 确认故事或舞台设置；`POST /api/write` 生成草稿；`POST /api/confirm` 提交；`POST /api/cancel` 取消。不把头像发服务端。
- 已有浏览器 v5 首次显式导入，不覆盖已存在服务器世界；v1 仅只读迁入可复用的娃娃资料，原存档保留。离线演出存本机，重新联网时若与服务器版本分歧则让玩家选择保留方向，不静默覆盖。
- 模型请求在 provider 层统计并发、次数与 token；取消信号贯穿 HTTP/编排/模型。浏览器断网直接运行同一份纯本地剧本，触控/动画不等待模型。

## 展示方案

原创 32×48 像素小人，现代日常穿搭，五个身份使用不同发型、衣着和轮廓；四向行走、呼吸、说话动作。舞台地板/家具使用原创绘制，保留 18×16 网格与碰撞。旧素材原件保留，构建不复制未获分发许可的 donarg 目录。

适配 320/390/430 CSS px；输入/生成取消/确认都可触控。桌面模拟和真实微信验收分别记录。

## 文件责任与并行约定

| Owner | 文件 |
| --- | --- |
| 运行时 agent | `server/agents/`、`server/orchestrator.js`、package/lock、agents/orchestrator tests |
| 状态 agent | `server/state/`、state tests |
| 视觉 agent | `hex/stage.js`、`hex/characters.js`、`hex/styles.css`、`hex/index.html`、CREDITS |
| 集成 agent | HTTP 服务、前端主流程/存储/请求层、共享本地脚本/契约、SDD/交接、集成验证 |

先通过适配器与存档隔离测试，再连接主链。集成与视觉可独立推进。构建通过不能代替真实工具调用、恢复或手机交互验收。
