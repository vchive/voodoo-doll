# 004 任务清单 · 多 Agent 世界内核迁移

本轮（2026-09-21，MW-39 / SP-24 / MW-AC-39）：本机桌面范围完成。俯视探索与 Galgame 立绘读取同一公开快照，共用一个对白/选择窗；阅读保留小俯视图，行动展开房间，手动“看场景 / 看人物”不结算。具体构图、切换和点选规则为实现默认，见[决策 0010](../../decisions/0010-hybrid-exploration-presentation.md)。Chrome 153 完整 40/40（311 次动作计数、2,676 次阅读操作，无页面异常）、Node 125/125、类型检查与双构建通过，详见[融合舞台证据](../../evidence/2026-09-21-hybrid-stage.md)。四尺寸 NPC 预览/取消/确认、阅读/草稿/pending 旋转及 A/B/C 两表现日程离场已验证；旧档/结尾/离线和多标签回归保留。本轮未改后端、未重跑 Python；真实微信、软键盘、公网和完整空间模拟另验。

上一轮（2026-09-21，MW-38 / SP-23 / MW-AC-38）：本机桌面范围完成。单人界面采用 DOM 场景背景、在场人物立绘和底部统一对白/选择窗，三人合计 10 张表情立绘、6 张背景，旁白由巫毒娃娃承担。Chrome 153 完整 35/35（287 次动作计数、2,452 次阅读操作）与同构建日程离场补测 4/4 通过；Node 120/120、类型检查及双构建通过。四档舞台专项含 320×568，568 短横屏预览/结尾裁切已修，A/B/C 实际加载、日程离场与截图已核对；31 个本机 JS/CSS/WebP 资产均 200 且匹配构建，见[Galgame 舞台证据](../../evidence/2026-09-21-galgame-stage.md)。本轮未改后端、未重跑 Python；旧档保留，微信真机、公网、完整姿态/Live2D、全场景及原创美术仍待完成。

上一轮（2026-09-21，MW-37 / SP-22 / MW-AC-37）：本机桌面范围完成。完成页提供故事库/地图直达，后续行动展示本次反馈，旧档往返和 v1 续章保留。完整浏览器回归 29/29（265 次行动、1,937 次阅读操作）通过；最后仅调整短横屏双入口并排与说明长度，相关 4 项复测通过，568×320 的说明和两入口无需滚动可见。Node 113/113、Python 168/168（含叙事专项 58/58）、类型检查、双构建、编译及语法检查通过，见[完成态出口证据](../../evidence/2026-09-21-ending-exit.md)。依赖 MW-32–36，用户旧档保留；后端普通动作与浏览器实际点击的覆盖分别记录，微信真机、公网、长篇与真实阅读时长另验。

上一轮（2026-09-21，MW-36 / SP-21 / MW-AC-36）：本机桌面范围完成。已把独立浏览器试玩纳入仓库，完整 25 项通过；最后的导入位置修复又完成三项相关存档复测。修复离线重连覆盖、确认/取消误判、旧回执倒退、损坏 pending 锁死及导入位置分裂。前端 112/112、后端 166/166、类型和双构建通过，见[本轮证据](../../evidence/2026-09-21-playthrough-recovery.md)。用户 18766 原库保留；微信真机、公网、长篇与时长仍未验。

上一轮阅读衔接（2026-09-20，MW-35 / SP-20 / MW-AC-35）：依赖 MW-34，已归档桌面测试范围通过：三档长句分页、滚轮/合成拖动、方向变化、多选翻动、三路线共 455 次阅读、四档面板/pending 及导入/故事库生命周期补测；11 项合成输入/焦点复测和前端 104/104 通过。补测与生命周期报告对应基线 `94aec65` 源码，11 项 IME 报告为清理补丁前的阶段证据；未单列组合及真机边界见[阅读衔接证据](../../evidence/2026-09-20-reading-flow.md)。不以既往布局结果替代本轮行为验证。

上一轮横屏（2026-09-20，MW-34 / SP-19 / MW-AC-34）：用户明确要求手机游玩以横屏为主。横屏优先使用可用宽度组织舞台、对话和行动；短屏滚动、次级面板、竖屏提示、方向切换状态保留、安全区与软键盘处理均为实现默认。依赖 MW-33，本轮三档横屏通关、12项方向/面板专项及390×844竖屏/长句/安全区模拟通过，99项前端测试与构建通过，微信真机另验，见[横屏证据](../../evidence/2026-09-20-landscape-play.md)。前轮阅读交互通过记录不代替本轮布局证据。

上一轮交互（2026-09-20，MW-33 / SP-18 / MW-AC-33）：用户反馈“文字太多，不知道看哪里、交互不方便”，并明确要求旁白由巫毒娃娃承担。该轮收敛为单一对话阅读焦点、娃娃叙述、读完接行动和次级信息折叠；推荐动作一次点击由客户端串联既有服务端预览与确认，自由输入保留可见预览。当前本机范围通过99项前端、159项后端测试与三路线/窄屏/键盘/恢复浏览器验证，见[上一轮交互证据](../../evidence/2026-09-20-dialogue-focus.md)。下方159/159、96/96及三条浏览器路线为更早的故事基线，均不代替 MW-34 专项证据。

前一轮故事验证（2026-09-20）：Python 159/159、Node 96/96、类型检查与双构建通过；独立HTTP 220请求覆盖四结局与读档，桌面Chrome完成390×844署名、320×844保护、320×568审计路线。新故事本机闭环通过，整项仍部分完成：长篇内容/时长、微信、公网和完整故障矩阵未完成。见[本轮证据](../../evidence/2026-09-20-signal-story.md)。
更新日期：2026-09-20（Asia/Shanghai）。当前新建世界默认 `templateId=signal-rain-v1`、`version=1`，标题《红灯下的第三次回声》。本轮按用户“去网上找短篇小说融进来”的要求，实际阅读狄更斯《The Signal-Man》英文原文，以其警报、值班和重访结构创作三日教程。正文约 135 句、4,372 个汉字、20 个服务端步骤；这是内容规模记录，不能推导真实游玩时长或宣称已完成长篇。当前实现与验证范围见[本轮证据](../../evidence/2026-09-20-signal-story.md)，来源和改编边界见[研究记录](../../research/2026-09-20-signal-man-adaptation.md)。

`rainy-office-v1` 与 `rainy-office-v2` 原有内容、状态和存档路径保留，不自动升级为新故事。MW-37 已修复 v2 完成态的缺席人物对白、时段误导及结束后任务提示；v2 正文的其他离场对白、最终决定误触、`missed` 可覆盖和时间/线索文案问题仍待修；**兼容保留不等于通过验收**。以前的 Python 145/145、Node 95/95、v1 桌面浏览器/对话窗证据均为历史基线，不代替新模板的专项自动化和实际试玩。微信真机、公网 HTTPS、完整故障矩阵和真实游玩时长未验证。

| ID | 任务 | 需求 | 验收 | 依赖 | 状态 |
| --- | --- | --- | --- | --- | --- |
| MW-01 | 冻结 OpenAPI、事件、能力、可见性和错误 schema | 目标架构、事件契约 | MW-AC-01 | 无 | 部分完成：`contracts/` 与 `hex/world-api.ts` 已建立，Pydantic/类型生成待做 |
| MW-02 | 建立角色注册表：PLAYER_DOLL、YOU、A–Y、Z、ENV | 控制边界、A-Y/Z | MW-AC-02 | MW-01 | 已完成：A–Y 稳定槽位、A/B/C 当前在场、Z 可复用、ENV 注册；`backend/tests` 有证据 |
| MW-03 | 建立 Python FastAPI 工程、配置和健康检查 | TS/Python 架构 | MW-AC-03 | MW-01 | 已完成：本机 HTTP `/healthz`、world、turns、events/SSE 已启动验证 |
| MW-04 | 实现 SQLite event store、快照、CAS、幂等键和回放器 | 重放、版本、事务 | MW-AC-04 | MW-01, MW-03 | 已完成：`backend/tests` 有证据 |
| MW-05 | 实现 World Kernel 的能力、目标、在场和状态校验 | 角色能力模型 | MW-AC-05 | MW-02, MW-04 | 已完成：控制、目标、在场、同房间、物件与动作白名单均有测试证据 |
| MW-06 | 实现 Context Builder 和 public/private/doll_private/environment/system 过滤 | 可见性与隐私 | MW-AC-06 | MW-02, MW-04 | 已完成：事件、关系快照和上下文私密隔离有测试证据 |
| MW-07 | 实现 local Agent Adapter 和 ENV deterministic resolver | 无模型可玩 | MW-AC-07 | MW-05, MW-06 | 已完成：规则角色与环境反馈有测试证据 |
| MW-08 | 实现 PLAYER_DOLL -> YOU 行动解析，禁止玩家直控 A–Y/Z | 用户控制边界 | MW-AC-08 | MW-05, MW-07 | 已完成：领域错误为 422 语义 |
| MW-09 | 实现多角色微回合、局部 fallback、取消、超时和原子提交 | 事件回合 | MW-AC-09 | MW-06, MW-07, MW-08 | 部分完成：多目标/局部 fallback/原子写入/持久化 draft-confirm-cancel 已通过；`OperationQueue` 已接入同步角色提案路径，迟到结果拒绝写入审计；持久队列、异步 worker 与完整 provider 超时矩阵待补 |
| MW-10 | 接入 A/B/C 独立记忆、目标、立场和回应能力 | 每人一个 Agent | MW-AC-10 | MW-06, MW-09 | 部分完成：每个角色使用隔离 Context Builder、独立 memory/traits/goal；真实多轮目标行为仍待扩展 |
| MW-11 | 接入 Z 临时角色生命周期和长期角色注册确认 | Z 复用规则 | MW-AC-11 | MW-02, MW-10 | 待开始 |
| MW-12 | 迁移 v5/003/单娃娃存档并保留 legacy-v2 回滚 | 分阶段迁移 | MW-AC-12 | MW-04, MW-10 | 部分完成：Python 只读 v5/v1 importer 已有 hash、头像/事实/房间/记忆保留和回滚元数据测试；v5/v1 HTTP 会话导入与坏档原子失败已有测试，targetSet、浏览器旧 key 保留和回滚验收待补 |
| MW-13 | 将 hex 前端迁移为 TypeScript API client、SSE reducer 和事件舞台 | 前端迁移 | MW-AC-13 | MW-01, MW-09 | 部分完成：默认 `play.ts` 已接入 Python 单人产品 API；typed Kernel client、去重 reducer 和 SSE 断线补拉已有合同测试，完整 SSE 事件舞台待补。320×568、390×844、430×932 三档桌面 Chrome 移动视口仿真已通过，微信 iOS/Android 真机仍待验收；`?legacy=1` 保留 Node/Pi 回滚界面 |
| MW-14 | 接入 Pi/DeepSeek/Claude Provider Adapter 与 RoleModelRouter，按世界搭建/娃娃/人物/观察者配置模型、预算、超时、取消和非法输出 fallback | 模型可替换、WL-11 | MW-AC-14 | MW-07, MW-09 | 部分完成：三 provider 共用结构化 adapter、预算限制和本地 fallback；职责 profile 路由、真实网关 transport/取消矩阵待测 |
| MW-15 | 迁移 003 关系、多目标、policy gate、SFW 分享降级和审计 | 003 兼容 | MW-AC-15 | MW-04, MW-06, MW-09 | 待开始 |
| MW-16 | 完成桌面/微信/断网/公网/回滚验证并更新 HANDOFF | 发布证据 | MW-AC-16 | MW-12, MW-13, MW-14, MW-15 | 部分完成：320×568、390×844、430×932 三档桌面 Chrome 移动视口仿真已通过；微信 iOS/Android 真机、公网/HTTPS、完整断网与回滚验证仍待完成 |
| MW-17 | 实现服务端 WorldClock 与惰性/后台节拍 | WL-01 | MW-AC-17 | MW-04, MW-05 | 部分完成：WorldClock、HTTP clock、内部 tick、客户端时间拒绝及管理令牌关闭/授权已有；后台 worker、生产配置和跨进程重启实测待补 |
| MW-18 | 实现时间表注册表与 PresenceProjection | WL-02, WL-03 | MW-AC-18 | MW-02, MW-04, MW-17 | 部分完成：重复日程、半开区间、跨午夜、投影和归位已回归；世界草稿 API 已可校验确认日程；例外日期、完整冲突审计待补 |
| MW-19 | 实现 InterestResolver、ActivationLease 与角色生命周期 | WL-03, WL-04, WL-05 | MW-AC-19 | MW-06, MW-09, MW-18 | 部分完成：严格 room/zone、TTL、heartbeat、过期拒绝、checkpoint/summary、日程切换和 generation/token 已回归；坐标半径、完整异步 provider 矩阵、生产后台节拍待补 |
| MW-20 | 实现可重放随机遭遇解析 | WL-06 | MW-AC-20 | MW-18, MW-19 | 部分完成：注册表加权候选、稳定种子与选择落入 activation 事件，重复 heartbeat 不重抽；关系条件、离开后重入/跨进程重连不重复演出的完整矩阵待补 |
| MW-21 | 实现 WorldObserver 审计与受限修复提案，只合并审计有新事件的活跃世界，保持只读且不进入玩家角色对话 | WL-07, WL-10 | MW-AC-21 | MW-04, MW-18, MW-19 | 部分完成：确定性报告已脱敏持久化；数据库按 worldId+reportHash 去重，跨连接/重启/旧库升级有回归；active/dirty 批次、完整不变量、低频模型、correction proposal 和受限修复待补 |
| MW-22 | 实现世界搭建草稿编译与确认，包括世界圣经、地点图、角色目标/秘密、关系、日程和遭遇 | WL-08, WL-10 | MW-AC-22 | MW-01, MW-02, MW-18, MW-20 | 部分完成：实体、日程、遭遇同批预览、确认发布、取消、CAS 与重启幂等已验收；世界圣经、新房间/角色/关系注册、澄清问题和高能力模型工作流待补 |
| MW-23 | 实现 primitive tool registry 与实体 affordance | WL-09 | MW-AC-23 | MW-05, MW-07, MW-22 | 部分完成：固定 primitive、JSON Schema、room/zone、类型/动作/路线校验已有；下一切片只收紧不可变 Published Registry 与可变 Runtime State 的读写边界，定义只能决定能力，运行态只保存位置/区域/合法动作结果。事件从零回放随后作为 MW-04/MW-26 独立切片 |
| MW-24 | 实现车辆、地铁、自行车 mobility resolver 与无人观察时的 TravelProjection | WL-03, WL-09 | MW-AC-24 | MW-18, MW-19, MW-23 | 部分完成：车辆/自行车和地铁状态机、路线/站点校验、ENV feedback 已回归；自行车单步及地铁 board/travel/alight 已通过组合动作预演。班次、领域事件重建、途中物化、坐标和后台到达投影待补 |
| MW-25 | 实现世界搭建 ToolCompiler | WL-08, WL-09 | MW-AC-25 | MW-20, MW-22, MW-23 | 部分完成：`tool-compiler-3` 对实体/日程/遭遇逐层校验，预览、哈希复核、引用与类型检查已有；基础自行车/地铁组合动作可预演并拒绝非法顺序、范围、实体、工具和 affordance。新房间/角色、例外日程、图可达性及分支组合待补 |
| MW-26 | 完成工具提案、失败原子性、重放和 ENV fallback 验收 | WL-09 | MW-AC-26 | MW-23, MW-24, MW-25 | 部分完成：声明非法、CAS、存储失败、跨连接取消/确认、重启幂等、拒绝审计已有；MW-23 状态边界收紧后，以独立切片补发布事件 reducer 和从零回放，再覆盖 mobility 跨重启回放、完整工具失败矩阵和持久 worker |
| MW-27 | 打通匿名单人预发布闭环、启动恢复与行动可发现性 | SP-01–10 | MW-AC-27 | MW-03, MW-04, MW-12, MW-13, MW-19, MW-22 | 部分完成（历史基础流程证据截至 2026-09-20，不代表新故事预发布通过）：cookie 到独立 world 的 SQLite 映射、跨会话草稿隔离、故事/行动 preview-confirm-cancel、持久幂等回执、移动后兴趣范围、重启恢复、当前/旧格式导入导出、Origin/请求体限制、管理接口令牌、静态敏感路径拒绝、TS 单人界面及同源构建入口已有自动化；320×568、390×844、430×932 基础闭环通过。SP-07–10 已在 Chrome 390×844 验证旧/损坏缓存不白屏、当前/可达地点与在场角色快捷行动、11 地点精确移动、取消无副作用、请求状态与防重复、中文错误、离线导出到在线导入、坏导入恢复、确认响应丢失恢复和导出输入保护。完整会话越权矩阵、生产配置、微信 iOS/Android 真机、公网/HTTPS 和内容丰富度仍待最终验收。证据见 `docs/evidence/2026-09-19-single-player-prerelease.md` |
| MW-28 | 实现小说结构改编的可通关 Galgame 教程与自定义模板 | SP-11, SP-14 | MW-AC-28 | MW-13, MW-17, MW-18, MW-19, MW-27 | 部分完成：默认 signal-rain-v1《红灯下的第三次回声》已有独立状态机与内容模块，三日 20 步骤、第二日站台/厨房二选一、三种明确立场和 missed 结果。原文资料已阅读并记录。新故事14项专项、159项后端、96项前端测试及三路线桌面Chrome通过，见本轮证据；不标长篇完成。v1/v2 保留兼容；MW-37 已修 v2 完成态缺席对白/时段误导，正文其余离场对白、最终决定误触、missed 覆盖与时间/线索问题仍待修 |
| MW-29 | 场景推荐、已确认物件证据与主人公生活职责 | SP-12, SP-13 | MW-AC-29 | MW-17, MW-18, MW-19, MW-23, MW-27 | 部分完成：signal 默认以推荐动作、自由输入、档案校对和显式归家睡眠组织行动；道具是固定注册实体，普通等待/开门不收集第二日证据。移动 5 分钟、对话 3 分钟、档案夹/录音 use 8 分钟；睡眠明确开启翌日并重投影角色。导入恢复专属道具，切换旧故事清理。已通过推荐行动通关、睡眠时钟与导入续玩专项验证；微信及完整故障矩阵待测 |
| MW-30 | Galgame 对话窗、多句演出与阅读恢复 | SP-15 | MW-AC-30 | MW-28, MW-29 | 展示底座在 v1 的本机历史范围通过；signal新稿已通过独立自动化及三路线桌面浏览器验收。signal_content.py 提供约 135 句/4,372 汉字；thought 仅 YOU，NPC 台词按当前地点和在场过滤，结尾只引用获得的材料。阅读游标按 worldId/dialogueId 隔离；不以旧浏览器结果覆盖新剧本 |
| MW-31 | 事实推进、明确选择、上下文接话与错误恢复 | SP-16 | MW-AC-31 | MW-28, MW-29, MW-30 | 部分完成：v1 非线性纠偏和接话保留历史回归；signal 的最终选择要求办公室内向 A 明确 ask/tell，审计需 auditSaved，共同署名需 manualRed+dossierRead；第一日/第三日超时 complete+missed 后不可改写。未知输入保留记录并给恢复入口。新故事绕路、证据、迟到、离场及读档专项通过；完整自由顺序和故障矩阵仍待扩展 |
| MW-32 | 保留 v1 第二天旧伞支线与旧档恢复 | SP-17 | MW-AC-32 | MW-28, MW-29, MW-30, MW-31 | 仅 v1 兼容范围：代码与后端回归通过；MW-37 新增 568×320 trust 结局后 6 步后记浏览器专项通过，其他支线组合仍待验。旧主线三种结局后可从推荐动作进入 `postscript`；回地铁站询问周野写入 `station-pass`，周野离场后观察登记写入 `station-pass-late`，办公室检查写入 `archive-card`，回家开门完成支线。支线保持原 `ending`，预览/取消无副作用，导出/导入保留步骤；缺少 `postscript` 的 v1 旧档仍可导入并继续。无模型路径由固定规则完成；320/390 桌面、微信真机、公网和故障矩阵待验。v2 第二日主线另属 MW-28。 |
| MW-33 | 收敛单一阅读焦点、娃娃叙述与推荐快捷行动 | SP-18 | MW-AC-33 A–E | MW-27, MW-28, MW-29, MW-30, MW-31 | 本机范围完成：单一对话窗、娃娃叙述、推荐一次执行、次级信息收起；99/159、三路线及恢复实测通过，见交互证据页。真机/公网和完整故障矩阵待测 |
| MW-34 | 横屏优先的手机游戏视口、短屏面板与方向状态保留 | SP-19 | MW-AC-34 A–F | MW-33 | 本机范围完成：三档横屏三路线、12项方向/面板专项、竖屏及长句/安全区模拟通过；99项前端测试、类型和双构建通过，见横屏证据。微信真机待测 |
| MW-35 | 长句阅读、多选翻动、输入法与焦点交接修复 | SP-20 | MW-AC-35 A–E | MW-34 | 已归档桌面范围通过：三档长句/滚轮/合成拖动/方向/多选翻动，四档面板/pending，三路线 455 次阅读，导入与故事库生命周期补测；11 项输入/焦点阶段复测、前端 104/104。源码阶段、未单列组合与真机边界见 reading-flow |
| MW-36 | 可复用独立浏览器回归与单人进度恢复核对 | SP-21 | MW-AC-36 A–F | MW-27–35 | 本机桌面范围完成：25 项完整回归及最后三项导入复测通过；112/166、类型和双构建通过。离线保全、持久取消/多标签回执、坏 pending 与导入位置已修复，见本轮证据；真机/公网/长篇另验 |
| MW-37 | 修复旧故事完成态去向与后续行动反馈 | SP-22 | MW-AC-37 A–F | MW-32–36 | 本机桌面范围完成：全量 29/29、末轮布局相关 4/4、Node 113/Python 168（叙事 58）通过。v2 三视口地图/库往返/取消/备份导回、568 短横屏双入口初始可见及 v1 六步后记已实测，见完成态出口证据；不自动迁移旧档，真机/公网/长篇另验 |
| MW-38 | Galgame 场景背景、在场人物立绘与动作演出 | SP-23 | MW-AC-38 A–F | MW-33–37 | 本机桌面范围完成：DOM 舞台/底部窗口、10 张表情与 6 背景、轻量演出和短屏预览修复；本轮完整 35/35、同构建日程补测 4/4、Node 120/120、类型/双构建通过，见 Galgame 舞台证据。A/B/C 加载与退场、旧档/结束出口、减少动态/图片失败可玩已验证；未知角色独立浏览器、真机、公网与完整美术另验，离线没有同款确认动作提示 |
| MW-39 | 俯视探索与 Galgame 人物聚焦融合 | SP-24 | MW-AC-39 A–F | MW-33–38 | 本机桌面范围完成 / 集成 Codex + 俯视与 SDD 协作：融合画面、只读切换、NPC 点选预览/确认与故障回退；最终 40/40、Node 125/125、类型/双构建通过。四尺寸及旋转、日程双表现退场、旧档/结尾/恢复已验证，见融合舞台证据；真机、软键盘、公网和完整空间模拟另验 |

## 文件责任

- `MW-01` 只维护 `contracts/`、生成类型和 schema 测试。
- `MW-02`、`MW-05`、`MW-06`、`MW-07`、`MW-09`、`MW-10`、`MW-11` 属于 `backend/app/` 与后端测试。
- `MW-03`、`MW-04`、`MW-12` 属于 FastAPI 工程、store 和 migrations。
- `MW-13` 只改 `hex/` 下的 TypeScript 前端与必要构建配置，不得将权威状态放回浏览器。
- `MW-14` 只改 adapters/config/tests；模型密钥只能由服务端读取。
- `MW-14` 的职责 profile 只选择模型、预算、超时和 fallback，不能改变任一 Agent 的工具、可见性或世界写权限。
- `MW-15` 与 `docs/specs/003-open-world-adult/` 对齐，若行为变化必须同步 003 文档和决策记录。
- `MW-16` 维护 `docs/HANDOFF.md`、验收证据和部署记录，不得把模拟测试写成微信真机或公网通过。
- `MW-17`、`MW-18`、`MW-19`、`MW-20`、`MW-21` 属于 `backend/app/world/`、事件存储与后端测试；统一时钟、时间表、租约和观察者不得由前端自行推断。
- `MW-22`、`MW-25` 属于世界搭建 API、注册表校验与确认事件；高能力模型只能通过 Adapter 提交草稿，不能直接调用运行时工具或写数据库。
- `MW-23`、`MW-24`、`MW-26` 属于 `backend/app/tools/`、resolver、事件存储与后端测试；运行时不接受模型生成的可执行代码。
- `MW-27` 属于 `backend/app/{sessions,gameplay}.py`、`backend/app/api/`、`hex/{play,play-api}.ts` 和对应集成测试；它复用 Kernel 和世界草稿，不建立第二套权威状态。
- `MW-28` 属于 `backend/app/{gameplay,narrative,signal_story,signal_content}.py`、Kernel 的动作事务、`hex/{play,play-state,play-api}.ts`、`hex/play.css` 及对应测试；章节与分支在现有世界 metadata/存档中持久化，不能由本机步骤代替服务端结果。故事内容见 `tutorial-story.md`。
- `MW-29` 属于 `backend/app/gameplay.py`、`backend/app/domain/{models,resolver,world}.py`、叙事/时钟投影、`hex/{play,play-api}.ts` 与对应测试；固定 primitive 和已发布实体负责执行，推荐动作只是只读提示。主角生活职责与 NPC 时间窗共用权威 WorldClock。
- `MW-30` 属于 `backend/app/narrative.py`、`backend/tests/test_narrative.py`、`hex/{play,play-api}.ts`、`hex/play.css`、`hex/play-dialogue.ts` 与 `tests/play-dialogue.test.js`；后端拥有公开剧本投影，前端仅拥有非权威阅读游标和可见记录。SDD owner 只改本目录五份规格/故事文档，集成负责人维护 HANDOFF 与验证证据，避免共享文件覆盖。
- `MW-31` 属于 `backend/app/{gameplay,narrative,signal_story,signal_content}.py`、教程/对话上下文解析与事务测试、`hex/{play,play-api}.ts` 及错误恢复展示；服务端以已确认事件、WorldClock、PresenceProjection 和当前公开对话建立进度与接话目标，前端只展示 guidance、保留输入和恢复展开状态。纠偏事件必须可审计、幂等且不改变既有时间窗/结局；SDD owner 只改本目录五份规格/故事文档，集成负责人维护 HANDOFF 与证据。
- `MW-32` 属于 `backend/app/{gameplay,narrative,signal_story,signal_content}.py`、`backend/tests/test_narrative.py`、`hex/{play,play-api}.ts` 及教程支线证据；它只维护 v1 兼容存档，复用 MW-28–31 的章节、行动、对话和错误恢复边界，不改变旧主线 `ending`，不新增运行时动态工具。新默认 signal 第二日主线由 MW-28 维护；v2 内容只作兼容。SDD owner 只改本目录五份规格/故事文档，集成负责人维护 HANDOFF 与证据。

- `MW-33` 实现负责人只改 `hex/play.ts` / `hex/play.css` 及必要交互测试；SDD owner 只改 004 的 spec/plan/tasks/acceptance 和 `docs/evidence/2026-09-20-dialogue-focus.md`，HANDOFF 由集成负责人更新。服务端预览/确认协议、状态机与历史数据不因此改写；叙述身份为展示投影。完成定义逐项对应 MW-AC-33 A–E。

- `MW-34` 实现负责人维护 `hex/play.ts` / `hex/play.css` 及必要交互验证；SDD owner 仅改 004 的 spec/plan/tasks/acceptance 和 `docs/evidence/2026-09-20-landscape-play.md`，HANDOFF 由集成负责人更新。依赖 MW-33，不更改 Kernel、模板/剧情或存档协议；状态切换按 MW-AC-34 A–F 的新证据验收。

- `MW-35` 实现负责人维护 `hex/play.ts` / `hex/play.css` / `hex/play-reading.ts` 及 `tests/play-reading.test.js` 等必要前端验证；SDD owner 只改 004 的 spec/plan/tasks/acceptance 和 `docs/evidence/2026-09-20-reading-flow.md`。依赖 MW-34，不扩剧情/后端、不改存档协议；HANDOFF 与最终证据由集成负责人更新，MW-AC-35 A–E 未测不标完成。

- `MW-36` 依赖 MW-27–35，实现负责人维护 `scripts/playtest-single-player.mjs`、`hex/play*.ts`、`tests/play-*.test.js`、`backend/app/gameplay.py`、`backend/tests/{test_single_player_cancellation,test_signal_story}.py`、`package.json`、`README.md`；SDD owner 维护 004 四件套，集成负责人维护 HANDOFF 和本轮新证据。测试仅使用自行创建的服务、临时数据库与隔离浏览器会话，不改用户存档；结局、恢复和请求断言须按 MW-AC-36 A–F 记录。离线本机记录不冒充服务端确认，重连和取消不静默丢失已发生结果。

- `MW-37` 依赖 MW-32–36。前端负责人维护 `hex/play.ts` / `hex/play-guidance.ts` 及必要样式、前端测试；后端负责人维护 `backend/app/{narrative,signal_story,signal_content}.py` 相关完成态逻辑及后端测试；浏览器负责人维护 `scripts/playtest-single-player.mjs`。SDD owner 仅维护本目录四件套，HANDOFF 与新证据由集成负责人维护。旧 v2 完成复现、普通行动/地图、故事库返回取消/新故事备份、刷新短屏与 v1 续章分别对应 MW-AC-37 A–F；测试用隔离数据，不改用户存档。

- `MW-38` 依赖 MW-33–37。前端负责人维护 `hex/play.ts` / `hex/play.css`、`hex/play-stage.ts` / `hex/play-stage.css`、`hex/play-performance.ts` 与对应测试，素材负责人维护 `hex/play-art.ts`、`hex/assets/vn/`、`hex/assets/vn-scenes/` 与 `CREDITS.md`，浏览器负责人维护 `scripts/playtest-single-player.mjs`；SDD owner 仅维护本目录四件套，HANDOFF 和最终证据由集成负责人维护。只读演出不修改权威世界/存档协议，不泄露私密 thought；素材覆盖、横屏/窄竖屏、在线动作零额外结算、离线范围、减少动态与失败回退逐项按 MW-AC-38 A–F 取证。

- `MW-39` 依赖 MW-33–38。集成负责人维护 `hex/play.ts`、`hex/play-stage.ts`、`hex/play-stage.css`；俯视负责人维护 `hex/play-overview.ts`、`hex/play-overview-model.ts` 与 `tests/play-overview.test.js`；浏览器负责人维护 `scripts/playtest-single-player.mjs` 与相关测试；SDD owner 维护本目录四件套和 `docs/decisions/0010-hybrid-exploration-presentation.md`，HANDOFF 与证据由集成负责人维护。只读镜头切换、统一在场、NPC 预览/确认、横竖短屏、失败回退及原档兼容分别按 MW-AC-39 A–F 取证；不新增物理移动或 NPC 控制协议。

## 依赖阶段

`MW-01 -> MW-02/MW-03 -> MW-04 -> MW-05/MW-06 -> MW-07 -> MW-08 -> MW-09 -> MW-10/MW-11 -> MW-12/MW-13 -> MW-14/MW-15 -> MW-17 -> MW-18 -> MW-19 -> MW-20/MW-21 -> MW-22 -> MW-23 -> MW-24/MW-25 -> MW-26 -> MW-27 -> MW-28/MW-29 -> MW-30 -> MW-31；MW-32（v1 旧档兼容，依赖 MW-28–31）；MW-33（阅读与交互，依赖 MW-27–31） -> MW-34（横屏优先，依赖 MW-33） -> MW-35（阅读与输入衔接，依赖 MW-34） -> MW-36（完整游玩与恢复，依赖 MW-27–35） -> MW-37（完成态出口与反馈，依赖 MW-32–36） -> MW-38（人物与动作演出，依赖 MW-33–37） -> MW-39（俯视与立绘融合，依赖 MW-33–38） -> MW-16`。

Node legacy-v2 在 MW-12 之前必须可启动；MW-16 之前不得删除。任何阶段失败都应能恢复旧存档并回滚到上一个事件 schema。
