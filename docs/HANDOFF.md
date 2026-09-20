# 巫柜 · SDD 交接入口

> 更新日期：2026-09-20（Asia/Shanghai）。当前阶段：**默认新手故事已收口为 `rainy-office-v2`《雨停以前》三日主线：第一日通行证、通勤、校对与限时谈话；第二日地铁站/厨房双入口；第三日回执、听证和最终决定。`trust`、`audit`、`protect` 三条路线及 `missed` 迟到结果已写入服务端状态机，并复用 Galgame 对话窗、推荐动作、自由输入和统一时钟。** Python 145/145、Node 95/95、类型检查及 Hex 构建通过；当前 v2 只有后端/无模型基础回归，尚未取得独立的完整浏览器、微信真机、公网和故障矩阵证据。`rainy-office-v1` 五章短篇及旧伞支线只作为旧档兼容和历史回归模板，不能替代 v2 的完整故事验收。详见[完整故事规格](specs/004-multi-agent-world/tutorial-story.md)、[对话窗证据](evidence/2026-09-20-galgame-dialogue.md)和[教程扩展记录](evidence/2026-09-20-tutorial-extension.md)。

本次已将本地开发快照同步到 GitHub `vchive/voodoo-doll` 的 `main` 分支。此次上传包含教程、对话窗、推荐行动、Python World Kernel 和 SDD 文档；`.env`、SQLite 数据、构建产物和付费素材仍按 `.gitignore` 排除。独立 HTTP 试玩还发现 v2 的四条路线存在待修问题：最终决定前的普通动作可能误选 `trust`，`missed` 可能被覆盖，离场角色仍可能出现在对白中，部分时间/线索文案与实际状态不一致。它们已记录为下一轮修复项，本次同步是可审阅的开发快照，不代表预发布验收通过。

当前自动化快照：`npm test` 95/95、Python 145/145；正文中的旧测试数量仅为历史记录。

## 1. 最新任务与约束

用户要求：**采用 SDD（Specification-Driven Development，规格驱动开发），按已确认的 TypeScript/Python 方案继续重写或分段迁移，先达到单人可用的预发布状态。最新用户目标是制作一部可长时间游玩、完整通关的教程游戏，偏好 Fate/stay night 的日常、异常、结盟与立场冲突结构，并通过制作故事完善交互。当前默认教程是原创 `rainy-office-v2` 三日闭环，后续扩写多日生活和多人物路线；`rainy-office-v1` 五章短篇只保留旧存档兼容。推荐行动与自由输入并存，主角有工作职责，NPC机会按统一时钟关闭。** 当前工作区已新增 004 的规格、技术方案、任务清单和验收清单；Python World Kernel、SQLite 事件存储、单人 FastAPI 产品接口和 TypeScript/PixiJS 单人前端已经落地。新的本地单人预发布入口是 `WORLD_STATIC_DIR=./dist-hex npm run prerelease`；Node/Pi `legacy-v2` 继续保留以便回滚。后续 agent 仍须先读本文与任务证据再接手；本文不代表微信 iOS/Android 真机或公网/HTTPS 上线。

最新任务是按 [004 · 多 Agent 世界内核与角色交互](specs/004-multi-agent-world/spec.md) 迁移到 **TypeScript 前端 + Python FastAPI World Kernel**，再承载多目标关系、开放世界和可选成人表现层。纯 TypeScript 的本地单机模式可以作为离线试玩和无模型回退，但不替代正式世界的服务端权威；“语言统一”与“无服务化”按[决策 0008](decisions/0008-typescript-and-service-boundary.md)分开管理。用户确认 DeepSeek Harness 指 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)；框架比较和 Pi 选型仍作为 Agent Adapter 参考，不能把开发协作 agent 与线上角色运行时混为一谈。

已完成 [决策 0004 · 运行时选型](decisions/0004-agent-runtime-selection.md)：推荐并已接入 **Pi Agent Core + Pi AI，按需复用社区 Pi Team 的独立调度核心**；LangGraph JS 为主备选。三个假角色的 Team core 实验已通过私邮投递、结果脱敏、续轮和释放检查；002 的游戏运行时已用自定义适配器接入，真实网关仍只有小样本证据。[研究证据](research/2026-09-18-agent-framework-evidence.md) 记录了版本与未测边界。

运行时任务 AR-01–05 已实现并通过本地自动化证据；AR-06（真实设备、双玩家并发、公网）仍待验证。Pi Team 是社区扩展，当前 peer 版本不覆盖最新 Pi，因此项目只 vendored 其 MIT 调度核心并使用自定义游戏角色适配器，不加载 coding/TUI 工具。

已确认的产品方向：

- 手机用户为主，微信收到链接后可打开，无安装、无注册前置步骤。
- 初版无业务后端；后续 002 已有 Node 模型服务原型。用户接受提供服务器，入口可以是公网 IP + 端口。
- 自定义头像，诅咒/施法、解压和摆件；优先级为 **玩法与摆件优先，外观精修靠后**。
- 从单娃娃扩展到多人物关系玩法，支持同一仪式中的多目标集合；先做双目标、关系线、组合仪式。
- 大模型可做仪式编剧/旁白；应保留没有模型也可玩的本地脚本。
- 用户追加开放世界与 R18 元素。[003 · 开放关系世界与成人表现层](specs/003-open-world-adult/spec.md) 在 legacy-v2 已有部分注册表、关系、target-set 和 policy gate 代码；默认 SFW，mature 由服务端年龄/渠道策略控制，只允许成年虚构角色的非露骨成熟表达。完整多目标结算、分享降级与 Python 接管仍需按 003 任务实现。
- 用户确认的新运行时边界见 [决策 0006](decisions/0006-python-world-kernel.md)：`PLAYER_DOLL` 与 `YOU` 共用一个执行 Agent；A–Y 是独立长期人物槽位，当前 A/B/C 主要、Z 为可复用临时角色；ENV 只做规则反馈；玩家不能直控 A–Y/Z。004 明确覆盖 0002 中“娃娃与玩家身体分开为两个 agent”的旧实现建议。
- 用户确认 Galgame 是对话型开放世界：NPC 各有统一世界时间下的工作/生活表；教程必须展示公开行程和可交互时间窗，未按时进入场景会错过当前机会或改变剧情分支。该判定由服务端 WorldClock、公开日程和 PresenceProjection 完成，不能只做前端倒计时。
- 用户提供了服务器 `115.190.174.39`，SSH 用户 `root`，尚无域名。后续工作已配置模型网关（见 002 状态）；本轮没有读取或更改密钥。


### 本轮开发与下一步（2026-09-20）

- 最新用户要求：参照其图片的 Galgame 对话窗组织文字，明确“谁在说话/思考”。已新增 `MW-30 / SP-15 / MW-AC-30`：后端公开 `dialogueId/dialogue`，前端 `hex/play-dialogue.ts` 保存独立阅读游标，`hex/play.ts`/`play.css` 渲染名字牌与逐句窗口。思考只公开主角 YOU 的心声，不泄露 NPC 私有状态。阅读不额外结算行动，也不暂停服务端时钟。见[本轮实际证据](evidence/2026-09-20-galgame-dialogue.md)。
- 本轮修复：离线移动不再重播原地点 NPC 对白；已知人物回应返回纯台词，动作留给旁白；320宽度自动滚动保留完整名字牌。另修复旧版本非线性教程存档：保留三次真实“去开门”历史事件，按已确认事实将章节纠偏到地铁站目标，写入幂等 `chapter_reconciled` 审计事件；短句接话会校验唯一/最近同场对象，多对象或离场对象要求重新选择。下一步在这个演出底座上扩写多日后果、线索与人物支线，避免重新制作已可用的对话窗。
- 实际来源核对已落盘：[开源与剧情资料研究](research/2026-09-20-playable-galgame-sources.md)。已下载固定版本 inkjs、AI Town、Generative Agents 并读关键源码/许可，阅读 Fate/STEINS;GATE 官方资料；未运行上游或实玩商业作品。此前对话提到的 `docs/evidence/2026-09-20-open-source-galgame-research.md` 与 `research-decisions.md` 并未落盘，不能作为证据。
- 入口 `http://127.0.0.1:18766/`：首次点“开始新手故事”，旧玩家点“故事库”。确认新篇章前保留一次原存档备份，可从“旧进度”导出。数据库仍为 `data/world.sqlite3`，未删旧档。仅本机HTTP，不代表公网发布。
- 本轮接口级回归使用独立临时数据库和 `18767` 端口：新会话创建模板、确认后返回 `dialogueId` 与旁白/心声/对白，随后预览并确认“观察周围”，服务端返回环境反馈、下一段对话和推荐动作；本轮未修改用户的 `18766` 数据库。失败输入的原文与提示会持久保留在行动记录中，但不会创建成功行动、推进时钟/地点/章节或生成世界事件。当前 Codex 浏览器连接因宿主 Mac 锁定且认证方式不可用，未新增截图试玩证据，仍以已有对话窗/短篇证据为准。
- 关键文件：`backend/app/narrative.py`（章节/反馈/推荐/时间）、`gameplay.py`（自然语言和生命周期）、`hex/play.ts`（故事库/目标/动作/备份），见[完整故事规格](specs/004-multi-agent-world/tutorial-story.md)。
- 剧情底座验证以[短篇证据](evidence/2026-09-20-playable-tutorial.md)为准，对话窗、MW-31 和 MW-32 增量以对应证据为准；下文 123/83、103/79 等数字是历史基线。行动记录新条目显示发生时的日期、时间、地点和执行状态，并以 turn/event id 防止确认或事件回放重复追加；未知输入固定显示“你 · 未执行”和“巫柜 · 提示”，失败不推进时钟、地点、章节或世界版本；旧日志保持兼容，不补造历史上下文。行动记录仍是本机展示/恢复数据，服务端快照、时钟和事件才是权威。下一步优先做第二天支线的浏览器/真机验收，再扩写章节中的多轮对话、可收集线索与人物路线；完整模型/ToolCompiler/观察者按原依赖推进，不把短篇或支线成功等同世界架构全部完成。

## 2. 阅读顺序

1. [产品规格 spec.md](specs/001-mobile-relationship-theater/spec.md)：需求编号、范围、用户流程、边界。
2. [技术方案 plan.md](specs/001-mobile-relationship-theater/plan.md)：状态迁移、模块划分、仪式状态机、可选模型协议、发布方案。
3. [任务清单 tasks.md](specs/001-mobile-relationship-theater/tasks.md)：依赖、文件责任和完成定义。
4. [验收清单 acceptance.md](specs/001-mobile-relationship-theater/acceptance.md)：需求追踪、可执行用例、手机/微信测试矩阵。
5. [仓库 AGENTS.md](../AGENTS.md)：后续 agent 的 SDD 工作约定。
6. [003 开放世界与成人表现层](specs/003-open-world-adult/spec.md)：规格、方案、任务和验收四件套；legacy-v2 已有部分关系、target-set 和 policy gate 基础能力，Python 迁移与完整验收仍待完成。
7. [004 多 Agent 世界内核](specs/004-multi-agent-world/spec.md)：当前主线规格；随后阅读同目录的 `plan.md`、`tasks.md`、`acceptance.md`。单人预发布链路已经迁到 TypeScript/Python，完整世界生成、观察者和正式发布仍未完成。
8. [决策 0006 · Python World Kernel](decisions/0006-python-world-kernel.md)：运行时架构和 YOU/DOLL 边界的最新决定。

这些文档中的能力只有在任务和验收表标为通过、且附有命令或网络证据后，才能写成已完成。

### 规格 002（新增）

用户在同一工作区追加了第二个方向，已写成 [002 · 巫柜夜场](specs/002-hex-theater/spec.md)。核心循环：**讲述 → 澄清 → 造景 → 预演 → 确认 → 报复 → 写进娃娃记忆 → 影响下次造景**。巫毒娃娃不是旁白而是同谋：玩家讲故事，娃娃把故事搭成舞台，玩家布场，娃娃动手演出报复。

形态已定为**俯视像素小房间**（娃娃屋的平面版），不是"电子蛐蛐"：玩家是俯身看进盒子的人，主角必须是场景内有位置与状态的像素小人，娃娃本体也在房间里、是玩家伸进这个世界的唯一一只手。场景由**内置可拼接元件**组装，创作层只负责组装与写台词，不自由生成视觉。

三条设计硬约束：娃娃不得发明玩家没讲过的事实（造景后有「它听成了这样」确认页）；预演让娃娃可能出错、玩家可纠正；娃娃在若干节点后开始劝阻，**由角色推动收尾**而不是菜单按钮。全部报复发生在房间内，不提供任何指向真人的机制。

002 复用 001 plan.md 的技术底座（v2 状态协议、v1 迁移、仪式状态机、编剧契约、发布设计），新增讲述与记忆、澄清、造景与确认、预演、布场交互、跨夜因果、战报卡片、娃娃迟疑与收尾。002 已补齐 `plan.md`、`tasks.md` 和 `acceptance.md`；当前实现证据与未完成项以这三份文件为准。

### 002 已接通模型（多角色编排）

`hex/` 是前端，`server/` 是服务端，`shared/` 是双方共用的契约。核心规则：**玩家只能说话，房间里的一切动作由娃娃执行**——没有拖拽、没有点选角色。

一晚的流程：玩家说一句话 → 服务端编排 → 玩家确认 → 演出 → 战报。

**多角色是每个角色一个独立 agent**：一场戏里每个主要角色分别调用模型，各带自己的记忆与立场，单个人失败只跳过该人。见 [server/orchestrator.js](../server/orchestrator.js)。

| 项目 | 现状 |
| --- | --- |
| 角色 | 六个 agent 位（2026-09-18 定稿，见 [决策 0003](decisions/0003-environment-agent.md)）：娃娃&&玩家身体、**环境**、A/B/C（可改名）、Z（路人，本地模板） |
| 环境 | 是独立 agent，**只反馈、无意志**：人物对物件做动作，环境应一句可观察的现象，或改天气/灯光。物件与动作表驱动（`shared/environment.js`） |
| 房间 | 6 个，各有地板配色、实心/非实心家具、7 个站位；BFS 寻路，角色绕开实心家具 |
| 渲染 | PixiJS 8；当前默认使用本项目原创现代像素人物，保留可替换的自测 LPC 图层入口与 fallback；奇幻风格旧图集已弃用 |
| 模型 | 服务端通过 `MODEL_BASE_URL` 接入兼容 OpenAI/Anthropic 的网关；密钥只读服务端 `.env`，不写入前端 |
| 默认模型 | 由 `MODEL_NAME` 配置；未配置或预算不足时自动走本地剧本 |
| 并发 | 默认并发（总耗时≈单次）；`AGENT_MODE=sequential` 换真实接话但延迟×人数 |
| 存档 key | `voodoo-hex-v5`（角色表换了：旧版 B 是玩家，新版 B 是别人，所以直接升版不做映射） |

**密钥与配置**：`.env`（已被 gitignore）保存 `MODEL_API_KEY` 等，**不要提交**。自检命令 `node --env-file=.env scripts/check-model.mjs`。运行 `node --env-file=.env server/index.js` 或 `npm run hex:serve`。详见 [server/README.md](../server/README.md)。

**素材授权状态**：分两类。`hex/public/oga/`（Office worker，CC-BY 4.0；Fukushima 工人，CC0）**可以随仓库分发**，署名在 [CREDITS.md](../CREDITS.md)。`hex/public/donarg/`（Donarg 地板图块，付费素材，**禁止分发素材文件本身**）仍被 gitignore，仅本机验证；其中的 lucca/robo 旧图集为奇幻风格且未声明许可，已弃用。

**历史原型采用的设计决策**：[决策 0002](decisions/0002-agent-split.md) 和 [决策 0003](decisions/0003-environment-agent.md)。其中 0002 的“娃娃与玩家身体分开为两个 agent”实现建议已被 [决策 0006](decisions/0006-python-world-kernel.md) 和 004 规格覆盖；0003 的 ENV 只反馈、现代角色素材甄别仍然有效，角色槽位和运行时边界以 004 为准。

本原型仍是验证形态：001 T00 的 Git 基线已于 2026-09-20 建立，初始提交为 `418c79b`；战报截图分享和真机测试仍未完成。**当前已有 BFS 绕开实心家具**，不再沿用早期“无寻路”结论。`package.json` 的 `hex:*` 脚本与 `.gitignore` 的 `dist-hex/` 已纳入基线。

2026-09-18 运行时核查补充：默认并发分支中 A/B/C 通过受控邮箱接收本轮公开台词，顺序模式才把公开 transcript 直接传给下一位；服务端保存已确认事实、角色记忆与版本，浏览器只保留本机头像和离线分支。初始故事显式确认后进入 facts，HF-20 已由已确认事实/记忆重建覆盖。当前本地模板也在浏览器，**无模型可回退与已载页面断网均可演出**。真实模型耗时只作为一次自测记录，不是性能承诺。

规格关系：001 是旧单娃娃底座，002 是保留回滚的 Node/Pi 多角色夜场 `legacy-v2`，003 是依赖关系注册表和策略边界的产品扩展，004 是当前 TypeScript/Python 单人预发布和后续世界内核主线。004 的本机单人预发布基础链路已接通，`MW-27` 仍为部分完成；后续再按依赖迁移 003。不要把 004 或 003 的待实现需求写回 002 的历史验收表。

各 spec 的 R 与 A 编号独立，不跨 spec 引用。

### 规格 003（用户追加方向）

用户要求游戏允许更开放的关系玩法，并支持在合适时使用 R18 元素。已新增 [003 · 开放关系世界与成人表现层](specs/003-open-world-adult/spec.md)、[技术方案](specs/003-open-world-adult/plan.md)、[任务清单](specs/003-open-world-adult/tasks.md)、[验收清单](specs/003-open-world-adult/acceptance.md) 和 [决策 0005](decisions/0005-adult-content-boundary.md)。

003 当前**legacy-v2 部分实现，Python 迁移与完整验收未完成**。`shared/world-registry.js`、`shared/relationship.js`、`shared/target-set.js`、`server/policy/` 与 Node 测试是已有证据；完整组合关系后果、原子结算、可追溯撤回和分享降级仍未验收。规格明确一次仪式支持 1–4 个成年虚构目标的 `targetSetId`，默认 `sfw`，`mature` 需要服务端年龄与渠道策略，成人表现只做非露骨暧昧、亲密和成人幽默。不要把这部分原型证据写成 Python 已接管或 003 全部完成。

## 3. 原始单娃娃版本（根目录）的能力

下表仅对应 `index.html/app.js`。002 夜场的 `hex/server/shared` 已有多角色与模型服务，见上节；不能把本表的“缺少”泛化到整个仓库。

| 范围 | 当前情况 |
| --- | --- |
| 技术栈 | 原生 HTML/CSS/JS；Vite 7.3.6 为构建工具，无运行时框架 |
| 手机界面 | 暗色祭坛、娃娃/施法/摆件底部导航；有响应式样式、安全区和减少动画规则 |
| 娃娃 | 仅 **一只**；头像居中裁切压缩、名字、5 种布料、红线/铃铛/无饰品 |
| 互动 | 拖动、额头/心口/手腕插拔针、悄悄话、按钮摇动；设备摇动取决于权限 |
| 单人法术 | 好运签、打个喷嚏、甜梦、社恐护盾、脚底发痒、鞋带打结 |
| 仪式 | 长按累计 3 秒或点击 5 次；完成扣 12 法力；中途关闭不扣费 |
| 法力 | 初始 72，上限 100；新一天 +25，部分互动恢复；目前没有每日施法硬上限 |
| 摆件 | 页面内全屏场景、尝试原生全屏、实时时钟、烛光/月夜、呼吸、可选 Web Audio 音调、尝试 wake lock |
| 存储 | 当前浏览器 localStorage；key 为 `voodoo-cabinet-v1`，头像为 data URL，最近 30 条记录 |
| 缺少 | 多娃娃、关系、组合仪式、剧情编排接口、大模型后端、正式静态服务、Docker 配置、自动化测试 |

代码地图：

- `index.html`：静态页面和单只娃娃结构；结尾为 `type="module"` 脚本。
- `styles.css`：现有视觉/响应式/摆件样式，存在多层覆盖，拆分前先做回归。
- `app.js`：一个 IIFE 内的状态、持久化、衣橱、单人互动、仪式与摆件生命周期。
- `package.json`：`prerelease` 会先构建 Hex 前端，再启动 Python World Kernel；`start` 与 `hex:serve` 仍指向 Node/Pi `legacy-v2` 回滚路径。已有 `test`、`typecheck` 和两套前端构建脚本，实际以 `package.json` 为准。
- `vite.config.js`：`base: './'`，支持静态子路径。
- `README.md`：当前单人版本的使用说明。

## 4. 验证证据与未验证项

### 004 单人预发布当前证据（更新至 2026-09-20）

- Git 根基线已建立，并以本地标签 `prerelease-local-2026-09-20` 标识本机单人预发布候选；没有推送或部署到外部环境。
- `PYTHONPATH=. python3 -m unittest discover -s backend/tests -v`：当前 138/138 通过。除 Kernel、生命周期、ToolCompiler、草稿事务和回放外，还覆盖 cookie 会话隔离、故事/行动预览与确认/取消、跨会话草稿拒绝、SQLite 重启恢复、current/v5/v1 导入、非法导入原子性、Origin、1 MiB 默认请求体上限、管理令牌，以及静态服务对敏感文件、父目录穿越和目录列表的拒绝。
- `python3 -m compileall -q backend`：通过。
- `PYTHONPATH=. python3 backend/run.py` 后，`curl http://127.0.0.1:8000/healthz` 返回 200；`POST /api/v4/turns` 的 A/B 多目标请求返回一个 worldVersion=1 的原子回合，A 与 B 各自产生回应。该证据仅证明本机 HTTP，不代表公网部署。
- `npm run typecheck`、`npm run build`、`npm run hex:build`：通过。`hex/play-api.ts`、`hex/play-state.ts` 与 `hex/play.ts` 已接入 Python 单人产品接口；Python FastAPI 是新的单人预发布入口，Node/Pi `legacy-v2` 保留回滚。
- 本地启动：先安装 `backend[api]`，再执行 `WORLD_STATIC_DIR=./dist-hex npm run prerelease`。该命令构建 Hex 前端并由 FastAPI 同源提供静态资源和产品 API；默认监听 `0.0.0.0:8000`，可用 `WORLD_HOST`、`WORLD_PORT` 和 `WORLD_DB_PATH` 调整。
- 本轮已验证的临时预发布实例为 `http://127.0.0.1:18768/`，使用独立临时 SQLite；`8000` 仍只是默认端口，不代表当前运行实例。
- 产品公开面仅为 `/api/v4/session` 与 `/api/v4/play/*`。其余 `/api/v4/*` Kernel 调试接口和 `/internal/*` 需要 `WORLD_ADMIN_TOKEN`；未配置令牌时返回 404，错误令牌返回 403。写请求校验 `Origin`，请求体默认限制为 1 MiB，可分别用 `WORLD_ALLOWED_ORIGINS` 和 `WORLD_MAX_BODY_BYTES` 配置。正式 HTTPS 环境需设置 `WORLD_COOKIE_SECURE=1`。

2026-09-17 初版交接时执行并通过（历史记录，非本轮重测）：

- `node --check app.js`。
- `npm run build`，Vite 输出约 9.03 kB HTML / 27.35 kB CSS / 22.18 kB JS（压缩后约 2.98 / 7.11 / 9.10 kB）。
- 本机版本：Node v22.23.1、npm 10.9.8。

2026-09-18 框架选型只做资料/源码核查及无模型 Team core 实验，见[研究记录](research/2026-09-18-agent-framework-evidence.md)。没有变更业务代码，不以历史构建结果代替 AR 验收。

2026-09-19 使用真实 Chrome 153 的 320×568、390×844、430×932 三档移动视口仿真完成单人闭环：故事预览/确认、移动到办公室、激活并询问 A、刷新恢复、双浏览器上下文隔离、422 保持在线均通过；Canvas 非空，无横向溢出、控件重叠、文字裁切或未预期运行时错误。该结果仅是桌面 Chrome 移动视口仿真证据，**不等于微信 iOS/Android 真机或公网/HTTPS 验证通过。**

2026-09-20 在 Chrome 153 的 390×844 视口补测 SP-07–10：旧格式和损坏缓存均能恢复或回到可重试入口；当前地点、在场角色、观察/等待和全部 11 个地点均可直接触控，逐个地点的精确移动通过；即时行动会换行显示，角色交谈按钮不会藏在横向滚动区；快速重复触发只产生一个预览/确认链；服务端错误显示为中文产品文案；取消行动不推进 `worldVersion`、不移动且不留下 pending；本机离线导出再在线导入完成往返。离线保存现带明确 `sourceKey=voodoo-single-v1` 和 `schemaVersion=1`，旧的裸 `LocalState` 文件仍会推断为单人存档。进一步模拟坏 JSON 导入、故事确认已在服务端成功但浏览器丢失响应，以及导出请求挂起后失败回退：首次进入表单恢复可用，刷新后清理过期 story pending 并恢复导入/导出，导出期间输入被锁定且原文不丢失。截图为 `/tmp/voodoo-prerelease-actions.png`、`/tmp/voodoo-prerelease-all-locations.png`、`/tmp/voodoo-prerelease-offline-imported.png` 和 `/tmp/voodoo-prerelease-recovery.png`。这些仍是桌面 Chrome 移动视口证据。

2026-09-20 本轮 Python 103/103、Node 79/79、`compileall`、类型检查、两个前端构建及 `node --check app.js` 均在当前代码上通过。`tool-compiler-3` 除实体类型/动作/路线、公开日程和遭遇候选外，已支持自行车单步与地铁 `board -> travel -> alight` 组合动作预演，并拒绝未上车、未下车、范围外实体、未知实体/工具和错误 affordance。确认事务一次提交定义、事件、回执并删除草稿；取消与确认竞态不会复活草稿，重复确认在重启和跨连接下返回首次结果。观察者以数据库唯一约束按 worldId+reportHash 去重，升级旧库保留历史。OperationQueue 已接入同步角色提案路径，world/activation 变化后的拒绝写入审计；队列本身与 worker 尚未持久化。SSE 支持 `afterEventId` 补拉。[验证记录](evidence/2026-09-19-world-builder-verification.md) 保存世界搭建任务的测试与源码校验值。

历史真实网关自测为 3 幕、19 次请求，重启后夜数恢复且一名角色使用 fallback；本轮未重测真实模型，不能把该记录写成全角色成功或性能承诺。

2026-09-19 架构复核补充：对比 AI Town、Colyseus、boardgame.io、LangGraph、Bevy、Nakama 和 MCP 后，当前模块化单体方向保持不变；新增研究记录 [开源项目架构对比](research/2026-09-19-open-source-architecture-comparison.md)。输入队列/generation fence、JSON Schema 工具目录、工具拒绝审计和 SSE cursor 已补入最小实现；Registry 与 Runtime State 分离、领域事件与展示事件分离、持久 Agent 工作流、分层记忆和预算记录仍需补强。没有将第三方框架直接加入依赖，也没有把第三方 README 当作本项目验收证据。

尚未完成：`rainy-office-v2` 的三日完整故事仍缺独立浏览器通关、微信 iOS/Android 真机、公网 HTTPS 和断网/丢响应/存储失败故障矩阵证据；`rainy-office-v1` 的后端回归和历史浏览器证据只证明旧档兼容，不能把 v2 标为完成。MW-28/29 的长篇内容、多日生活、多人物路线、真实试玩时长和丰富演出仍待补齐。MW-31/32 的浏览器与真机证据、MW-27 的完整 viewer/session/private 越权矩阵和生产配置也未完成。WorldObserver 完整不变量、低频模型与受限修复、持久异步 worker/完整 provider 超时矩阵、多 worker 下的 Kernel/会话一致性协调、003 多目标结算/撤回/成人 gate 与 Python 接管、Python 真实 provider transport、由高能力模型动态生成完整世界和分享仍待完成。当前预发布建议单 worker。ToolCompiler 的基础组合动作预演已有证据；例外日期、非零日程容差、私密日程、图可达性和更复杂分支组合仍未实现，不支持的声明会明确拒绝。交通仍缺完整班次、后台到达、坐标范围和从领域事件独立重建；随机遭遇仍需关系条件和跨进程重连矩阵；日程冲突审计与后台节拍待补。原始 001 全屏/音频/传感器仍未做系统回归。

界面中的试玩状态可能仍保留在开发浏览器。不要为了测试直接清除用户已有站点数据，使用独立测试环境/上下文。

## 5. Git 与工作区

- 工作区：`/Users/liminghan/Documents/voodoo-doll`。
- 分支：`main`；单人预发布基线为 `418c79b`，当前证据提交为 `57b5fdd`，本地标签 `prerelease-local-2026-09-20` 指向该提交。
- 远端：`git@github.com:vchive/voodoo-doll.git`。当前文档只证明本地 Git 基线和标签，不证明这些提交已经 push 或部署。
- `node_modules/`、`dist/` 被忽略，均已在本地生成。
- 其他 agent 应从当前工作区或已确认包含 `57b5fdd` 的远端分支工作；在没有核对远端提交前，不要把 GitHub 仓库误当成已同步。
- 后续可以从本地基线创建独立工作树并行派工；合并前仍需核对 SDD 状态、测试证据和未提交用户改动。

## 6. 服务器交接（已停止部署）

2026-09-17 部署暂停时的历史事实（本轮未重新 SSH，不代表其他 agent/主机自动有权限）：

- `ssh -o BatchMode=yes root@115.190.174.39` 在当前本机成功，无需粘贴密码或私钥。
- 服务器为 Linux / Ubuntu 内核环境；有 Docker 和 Docker Compose v5.1.0；检查时没有可见的 node/nginx 命令。
- 检查时 22、8888 等端口在监听，8080 未监听；**8080 是建议默认值，不是已上线端口**。
- `/opt/voodoo-doll` 不存在；没有创建本项目容器、服务、反向代理、计划任务或防火墙规则。
- 在用户要求暂停前，曾执行 `docker pull node:22-alpine`；随后已对该特定拉取进程发送 TERM，SSH 命令以 143 退出。部分镜像层可能已缓存，但 `docker image inspect node:22-alpine` 未返回完整镜像。不要为了“清理”运行 Docker prune，服务器有其他项目镜像。
- 未上传代码，未部署网站，未验证 `http://115.190.174.39:8080/` 可达。不要把它作为可用成品链接。
- 初次 SSH 使用 accept-new，可能已在本机 known_hosts 写入该主机公钥记录；没有更改服务器认证配置。

后续发布前重新检查端口和现有服务；不得覆盖 8888 或其他项目目录。公网端口访问还受云安全组/防火墙影响。没有证据表明当前 8080 已被公网放通。

## 7. 接手时优先关注

1. 教程标杆当前以 `rainy-office-v2` 三日主线为默认：第一日通行证/便笺、地铁告示、档案馆校对和林川限时谈话；第二日周野地铁站或沈青厨房录音双入口；第三日未来回执、听证和 `trust/audit/protect/missed` 结果。Python 138/138、Node 93/93、类型检查和 Hex 构建通过，但这些自动化结果和 v1 历史证据不能代替 v2 的独立浏览器、真机、公网和故障矩阵验收。`rainy-office-v1` 五章与旧伞支线仅用于旧存档兼容。`npm run prerelease` 的 Python 启动器已修复，并完成本机 HTTP 入口验证，详见[预发布启动记录](evidence/2026-09-20-prerelease-startup.md)。后续内容扩写按 `docs/specs/004-multi-agent-world/plan.md` 的 Phase 2/3 推进，增加多轮对话、可收集线索、多日生活和人物路线。运行入口为 `WORLD_STATIC_DIR=./dist-hex npm run prerelease`。保留 Node/Pi `legacy-v2` 回滚，不再把它写成默认产品入口。
2. `PLAYER_DOLL` 与 `YOU` 必须共用一个执行 Agent；玩家只能推动 `YOU` 的行动，不能出现直接控制 A–Y/Z 的客户端按钮或服务端命令。
3. `file:///.../index.html` 不适合作为运行或分享入口；模块脚本与浏览器策略可能使交互失效，使用 HTTP 开发服务/正式静态服务。
4. 现有全局单娃娃字段需要迁移为带稳定 ID 的实体和事件；不能通过直接复制 DOM 就宣称支持多目标或多 Agent。
5. 现有字体依赖 Google Fonts；手机首屏不应等待外部字体网络，正式版移除依赖或改为同源资源。
6. `localStorage` 属于 origin；IP/端口改为域名/HTTPS 后，旧存档不会自动跨来源迁移。004 的迁移必须保留头像、已确认事实和旧 key 回滚。
7. 普通 HTTP 与微信 WebView 对传感器、音频、全屏、常亮支持不一致；核心操作必须有触控和页面内替代。
8. 现有 Pi/Node 模型网关不能替代 Kernel；工具调用、流式、取消与真实预算仍需通过 004 Adapter 合同测试，密钥只在服务端，本地回退与模型结果分别记录。
9. 003 的 `MT-*`、`AW-*`、`AD-*` 任务必须在 004 事件、可见性和策略边界之上实现，不能只改提示词或客户端开关。R18 相关内容必须默认可回退 SFW，不能把“用户想要开放”解释为取消权限和内容边界。

## 8. 可直接复制给下一位 agent 的任务

> 请在 `/Users/liminghan/Documents/voodoo-doll` 接手巫柜项目。先读 `AGENTS.md`、`docs/HANDOFF.md`、004 四份文档、[决策 0006](decisions/0006-python-world-kernel.md)，再读 001/002/003 的相关规格和 `docs/decisions/0004-agent-runtime-selection.md`、`0005-adult-content-boundary.md`。当前单人预发布入口是 TypeScript/PixiJS 前端配 Python FastAPI World Kernel，使用 `WORLD_STATIC_DIR=./dist-hex npm run prerelease` 启动；`hex/server/shared` Node/Pi `legacy-v2` 保留回滚。SP-01–10 的基础单人流程已有本地证据；MW-27 仍缺完整越权矩阵、生产配置、微信真机和公网 HTTPS。Phase 1 的默认教程是原创《雨停以前》`rainy-office-v2`：三日主线、第一日通勤/工作/限时谈话、第二日地铁站/厨房双入口、第三日回执/听证/最终决定，路线为 `trust/audit/protect` 并含迟到 `missed`；当前 Python 138/138、Node 93/93 通过，v2 后端与无模型代码证据已具备，独立浏览器/真机、公网和完整故障矩阵仍待验收。`rainy-office-v1` 五章和旧伞支线只作旧档兼容回归，不能用 v1 证据替代 v2。先读 `docs/specs/004-multi-agent-world/plan.md` 的阶段目标和 `docs/specs/004-multi-agent-world/tutorial-story.md`，后续按 Phase 2 扩写长篇内容、多日生活与人物路线。完整动态世界搭建、WorldObserver 修复、多 worker 和 003 Python 策略也未完成。按 `004/tasks.md` 和 `004/acceptance.md` 推进，保留私密性、版本 CAS、旧档迁移、无模型可玩性和 `legacy-v2` 回滚；成人向内容按 003 的服务端策略、注册表和非露骨默认边界实现，不给模型文件/Shell 权限。本次具体执行范围以我另外分配的任务为准。
