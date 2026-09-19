# 004 验收 · 多 Agent 世界内核与分阶段迁移

状态：Python 103/103、Node 79/79，TypeScript 类型检查及 Hex 构建通过。本机单人预发布候选已收口。世界草稿的实体/公开日程/遭遇确认、HTTP 合同、跨连接并发/取消和重启，以及匿名单人闭环、HTTP 写入保护、管理接口令牌与同源静态入口已有证据；320×568、390×844、430×932 三档桌面 Chrome 移动视口基础闭环已通过，MW-22/23/25/26/27 仍部分通过。MW-AC-27 的 SP-07–10 已在 Chrome 390×844 取得损坏缓存恢复、行动可发现性、请求防重复、中文产品错误、11 地点精确移动、离线存档往返、本机进度保护、故事预览恢复、坏导入恢复、确认响应丢失恢复及操作锁证据。观察者完整不变量/修复、交通完整回放、完整发布边界、微信 iOS/Android 真机和公网/HTTPS 待测。环境、源码校验值和命令见[世界搭建验证](../../evidence/2026-09-19-world-builder-verification.md)和[单人预发布验证](../../evidence/2026-09-19-single-player-prerelease.md)，桌面模拟与真机分别记录。

| 编号 | 验收项 | 通过条件 | 状态 |
| --- | --- | --- | --- |
| MW-AC-01 | 跨语言契约 | OpenAPI/JSON Schema 可生成 TS 类型并由 Pydantic 校验；未知 action、actor、target、channel、relation 被拒绝 | 部分：契约文件已纳入 Git 基线，生成/Pydantic 待做 |
| MW-AC-02 | 身份与控制边界 | `PLAYER_DOLL` 可控制 `YOU`；玩家或模型提交 A/B/C/Z 直控命令返回 422；A/B 可自主拒绝、沉默、离开或反问 | 通过（2026-09-18）：`PYTHONPATH=. python3 -m unittest discover -s backend/tests -v`，16/16；`test_kernel.py`、`test_world_kernel.py` |
| MW-AC-03 | Python 服务 | FastAPI `/healthz`、命令和 SSE 在本地启动；缺少模型配置不阻塞核心流程；密钥不出现在响应和前端包 | 本机通过（2026-09-18）：`PYTHONPATH=. python3 backend/run.py`；curl `/healthz`=200，A/B 多目标 POST 返回 200；公网仍待测 |
| MW-AC-04 | 事件存储与回放 | 一幕可写入快照和 append-only 事件；重启后按固定 resolver 重建相同世界/舞台；重放不调用模型 | 通过领域层：SQLite、CAS、回放测试通过 |
| MW-AC-05 | 能力与权限 | 发起能力、被交互能力、在场、距离、前置物件和关系条件均校验；非法状态不能写入数据库 | 通过领域层（2026-09-18）：物件/动作/房间/同房间校验在 `test_world_kernel.py`，非法输入在提交前拒绝 |
| MW-AC-06 | 可见性隔离 | A 的 private 事件不出现在 B/C/无关玩家上下文；`doll_private` 不进入人物 prompt；public 事件只发给在场者 | 通过领域层（2026-09-18）：private 事件、关系快照 viewer 过滤和 `events_for_viewer` 测试通过 |
| MW-AC-07 | 无模型回退 | 断网、超时、429、5xx、非法 JSON、预算耗尽均使用本地模板完成一幕；角色失败只影响自身回应 | 通过本地路径（2026-09-18）：RuleAgent/ENV deterministic resolver、单角色异常 fallback、16 项 Python 测试；真实 provider 故障矩阵待测 |
| MW-AC-08 | 玩家推动对质 | 玩家输入“让 A 和 B 当面对质”被拆成 YOU 的邀请/询问/施压行动；没有 A 直控 B 的事件；A/B 的回应分别由其 Agent/回退产生 | 通过领域层（2026-09-18）：多目标 ask 事件为 YOU→A、A 自主回应、YOU→B、B 自主回应；无 A→B 直控事件 |
| MW-AC-09 | 微回合原子性 | 发起、目标回应、ENV 反馈、关系和记忆按 turn 原子提交；取消、超时、重复确认、CAS 冲突不产生部分结算或重复事件 | 部分通过（2026-09-19）：SQLite 原子提交、幂等、CAS、turnId 重启复用和 draft/confirm/cancel 通过；OperationQueue 已接同步提案路径，`test_world_kernel.py` 验证 world/activation 变化后的迟到结果拒绝和持久审计；持久 worker、异步超时矩阵待测 |
| MW-AC-10 | 独立人物 Agent | A/B/C 各有独立记忆、目标、立场和能力；相同公开事件可产生不同合法回应；一个 Agent 不读取另一个的私密记忆 | 部分通过（2026-09-18）：Context Builder 只向目标 Agent 提供隔离上下文，A/B/C 具有独立 traits/goals/memory；多轮目标行为待测 |
| MW-AC-11 | Z 生命周期 | Z 可在场景中复用并拥有短期记忆；刷新/换场不自动写长期角色槽位；只有玩家确认注册后才可成为 A–Y 长期角色 | 待测 |
| MW-AC-12 | 旧存档迁移与回滚 | `voodoo-hex-v5`、003 和单娃娃档迁移为 `PLAYER_DOLL`/`YOU` 与单目标集合；头像和已确认事实保留；失败可回到旧 key | 部分通过（2026-09-19）：`backend/app/migrations/legacy.py` 覆盖 v5/v1 只读转换、source hash、头像/事实/房间/记忆保留和显式迁移元数据；`test_single_player_api.py` 覆盖 v5/v1 HTTP 导入及坏档不覆盖当前状态，targetSet、浏览器旧 key 保留与回滚验收待补 |
| MW-AC-13 | TypeScript 手机前端 | 320/390/430 CSS px 下角色、对话、输入、SSE 状态不重叠；断线补拉和重复 eventId 不重复演出；核心交互无 hover 依赖 | 部分（2026-09-19）：`npm run typecheck`、`npm run hex:build`、`node --test tests/world-api.test.js` 通过；`WorldEventReducer` 按 `eventId` 去重，SSE 断线先 `/events?after=` 补拉再重连；320×568、390×844、430×932 三档桌面 Chrome 移动视口仿真完成单人闭环且无溢出/重叠、Canvas 非空；微信 iOS/Android 真机和完整 SSE 事件舞台仍待测 |
| MW-AC-14 | Agent Adapter 与职责路由可替换 | world-builder、player-doll、character、observer 可分别选择 local/Pi/DeepSeek/Claude（已配置者）和预算；所有 provider 通过同一结构化契约，工具权限、世界写入和可见性不随 profile/provider 改变 | 部分通过（2026-09-18）：`StructuredProviderAdapter` 统一 Pi/DeepSeek/Claude 输出、预算和 actor 校验，`ResilientAgent` 自动本地 fallback；职责 profile 路由、真实网关 transport、取消和 429/5xx 矩阵待测 |
| MW-AC-15 | 003 兼容策略 | 默认 SFW；成人 gate、关系/多目标原子结算、审计和分享降级由 Python 服务端执行；越界输入不落盘、不推进夜数 | 待测 |
| MW-AC-16 | 分阶段发布证据 | Node legacy-v2 和 Python 版本均可启动；迁移、重启、回滚后事件一致；微信 iOS/Android、服务器外 HTTP、健康检查分别有真实记录 | 部分通过（2026-09-19）：Python 单人入口、本机健康检查，以及 320×568、390×844、430×932 三档桌面 Chrome 移动视口仿真已有记录；完整迁移/回滚一致性、微信 iOS/Android 真机和服务器外公网/HTTPS 待测 |
| MW-AC-17 | 统一世界时钟 | `/world`、事件和 Agent 上下文使用服务端 `WorldClock`；伪造客户端 `day/minute` 不推进时钟；重启后 `clockVersion` 和单调锚点可恢复 | 部分通过（更新至 2026-09-20）：生命周期/遭遇测试及 Python 全量 103/103 通过；`test_lifecycle.py` 覆盖基础投影/clockVersion，API 拒绝客户端时间；管理令牌关闭和授权访问 internal tick 已覆盖，生产节拍配置与跨进程重启实测待补 |
| MW-AC-18 | 时间表与驻留投影 | 每个角色按版本化时间表得到唯一可重放 `PresenceProjection`；重复/例外/重叠按固定规则处理；未激活时不调用模型、不生成逐分钟生活事件 | 部分通过（2026-09-19）：工作/居家投影、半开/跨午夜、重复 tick、默认位置、世界草稿 API 校验和确认日程已有覆盖；非零容差/例外日期明确拒绝，完整冲突审计待补 |
| MW-AC-19 | 兴趣范围与激活租约 | 进入 `roomId/zoneId` 创建有 TTL 的 `ActivationLease`，激活上下文只含时间摘要和可见事件；离开/过期释放租约；重复心跳和重连不重复演出 | 部分通过（2026-09-19）：严格 office/desk 匹配、TTL、重复 heartbeat、过期拒绝、quiescing checkpoint/summary、日程切换、generation/token 和 encounter generation 已覆盖；坐标范围、完整异步迟到结果矩阵和生产后台节拍待补 |
| MW-AC-20 | 可重放随机遭遇 | 激活遭遇来自注册表并记录稳定种子与 encounterId；刷新、补拉、重复 interest 不重抽、不重复写事件 | 部分通过（2026-09-19）：`test_lifecycle.py` 验证稳定选择、activation 事件落盘与 heartbeat 不重抽；`test_world_builder.py` 验证确认候选接入激活；关系条件、离开重入/跨进程重连矩阵待补 |
| MW-AC-21 | 世界观察者边界 | 确定性审计覆盖时钟、时间表、位置、事件和关系不变量；模型观察者只能提交审计/修复提案，不能读取 private、进入角色对话或直接改世界；观察者不可用不阻塞玩法 | 部分通过（2026-09-19）：房间/日程报告脱敏持久化，数据库按 worldId+reportHash 去重；A/B/A、双连接并发、重启、旧库迁移保留历史均有 `test_world_kernel.py` 证据；完整不变量、模型和修复提案待测 |
| MW-AC-22 | 世界搭建确认 | 高能力模型只生成世界圣经、地点/角色/关系/时间表/遭遇注册表草稿，并能对关键缺口返回澄清问题；未确认草稿不进入运行时或人物上下文，确认后有版本化事件且可回放 | 部分通过（2026-09-19）：`test_world_builder.py`、`test_world_builder_api.py` 覆盖实体/日程/遭遇同批发布、预览隔离、取消、CAS、哈希复核、并发确认、SQLite 重启恢复；世界圣经、新房间/角色/关系、澄清问题、高能力模型接入和事件从零重建待测 |
| MW-AC-23 | 原子能力与实体 affordance | 固定 primitive、实体状态和参数 schema 可拒绝未知 tool/entity/action；权限与前置条件可验证，兴趣范围可裁剪 | 部分通过（2026-09-19）：固定 registry、schema、room/zone、类型/动作/路线检查已有；车辆目的地运行时二次校验有 `test_tool_declarations.py` 证据；定义/可变状态分离及完整运行时契约待补 |
| MW-AC-24 | 交通与环境交互 | 车辆、地铁、自行车、灯光等通过固定 primitive 和实体数据结算；无人观察的移动使用 TravelProjection，玩家途中进入范围时可一致地物化为组合动作；组合动作可重放，无模型时使用 ENV fallback | 部分通过（2026-09-19）：`test_tools.py` 验证自行车行驶、地铁 board/travel/alight 顺序、路线/实体类型拒绝、实体位置更新和 ENV mobility feedback；TravelProjection、途中物化、跨重启回放、班次时间和坐标范围待测 |
| MW-AC-25 | 世界搭建 ToolCompiler | 玩家叙述/高能力模型只生成声明式草稿；静态校验和预演通过；任意代码、网络/文件操作和未注册副作用被拒绝 | 部分通过（2026-09-19）：compiler-2 的实体/公开日程/遭遇类型、范围、重复 ID、引用、schema 与预览统计已有证据；新房间/角色、例外日程、图可达性及组合动作预演待测 |
| MW-AC-26 | 工具提案发布与审计 | 仅玩家确认后的版本化注册表进入运行时；拒绝提案、失败原子性、回放和审计均有证据 | 部分通过（2026-09-19）：非法声明、存储失败、删除失败、CAS、跨连接取消/确认和并发重试、重启 receipt 有 `test_world_builder.py` 证据；拒绝审计与 ENV fallback 已有；mobility 完整回放、失败矩阵、持久 worker 待补 |
| MW-AC-27 | 匿名单人预发布闭环、启动恢复与行动可发现性 | 两个 cookie 对应独立 world，伪造 world/viewer/session 无效；故事与行动先预览再确认/取消，重复确认幂等；移动后只激活新兴趣范围；SQLite 重启与导入导出恢复；旧/损坏本地缓存不导致白屏；当前地点、可到达地点和在场角色有直接可点击且仍经预览/确认的行动；请求处理中有明确状态并阻止重复提交；产品错误中文化；同源服务不暴露源码/密钥，写请求和 internal API 受保护；无模型可完成闭环 | 部分通过（本机单人预发布候选已收口，证据更新至 2026-09-20）：`test_single_player_api.py` 7/7 覆盖 cookie world 隔离、草稿隔离、preview-confirm-cancel、幂等、移动后激活、角色自主回应、SQLite 重启、当前/v5/v1 导入导出、坏档原子失败和 HTTP 边界；`test_static_serving.py` 3/3 覆盖静态安全边界。Python 103/103、Node 79/79、类型检查及构建通过。320×568、390×844、430×932 基础闭环已有桌面 Chrome 证据；390×844 增量验收覆盖旧/坏缓存恢复、快捷行动、全部 11 地点精确移动、取消无副作用、防重复、中文错误、离线导出到在线导入、cookie 变化后本机进度不被覆盖、故事预览刷新恢复、坏导入后表单解锁、故事确认响应丢失后刷新恢复，以及导入/导出期间冲突控件锁定与输入保护。完整 viewer/session/private 越权矩阵、生产配置、微信 iOS/Android 真机、公网/HTTPS 和内容丰富度待测 |

## 关键手工用例

### 用例 1：A/B 当面对质

1. 玩家在房间内输入“让 A 和 B 当面对质”。
2. 检查服务端只产生 `YOU` 的公开邀请/询问行动；没有客户端可选的 A/B 控制按钮。
3. A 和 B 各收到自己的可见上下文，分别返回同意、拒绝、撒谎、反问、沉默或离开中的一种合法结果。
4. ENV 只反馈房间可观察变化；关系和记忆在同一 turn 原子提交。
5. 检查回放和刷新后结果一致，重复确认不重复结算。

### 用例 2：私密性

1. A 向 YOU 发送 private 事件，B/C 不在场。
2. 检查 B/C 的 prompt、SSE 和记忆没有该事件；DOLL 可见的玩家私密意图也不出现在 A/B prompt。
3. 断线补拉后只返回当前 session 可见事件。

### 用例 3：无模型与迟到结果

1. 禁用模型或模拟超时，发起多目标微回合。
2. 每个目标都使用本地 fallback，ENV 仍反馈，整幕可完成。
3. 迟到的模型结果被丢弃，不能覆盖已提交 fallback；事件日志记录来源和原因。

### 用例 4：统一时钟与驻留

1. 以固定 `WorldClock` 启动世界，尝试在 `/world`、interest 和 turn 请求中传入伪造 `day/minute`；服务端忽略或拒绝该字段，时钟只按服务端锚点推进。
2. 为 A 配置 09:00–17:00 在 `office/desk` 的时间表，为 B 配置相同时间的 `home/kitchen`；在没有玩家会话进入时，检查只有 `PresenceProjection` 事件，没有 A/B 模型请求或逐分钟生活事件。
3. 玩家从 `hall/lobby` 进入 `office/desk`，检查 A 只激活一次，收到从 checkpoint 到当前时钟的摘要；重复 heartbeat、刷新和 SSE 补拉不重复触发遭遇。
4. 玩家离开 `office/desk` 或让租约过期，检查 A 进入 `quiescing` 后释放；A 的公开摘要可回放，私密记忆不会流入玩家或 B 的上下文。

### 用例 5：观察者与修复

1. 注入未知房间、重叠时间表和过期租约，检查确定性 observer 产生带依据事件和版本的 `audit`。
2. 提交一个模型 `correction_proposal`，尝试直接修改关系、事实或角色意志；Kernel 拒绝越权部分，只允许注册表投影、未知事件丢弃和租约清理等确定性修复。
3. 禁用观察者模型，检查时钟、驻留投影、激活回合和本地 fallback 仍可完成，且未产生隐式后台角色推理。
4. 让世界保持无人且没有新事件，跨过多个观察间隔后检查没有模型审计调用；产生多个密集事件后只形成一次合并审计，且只读取脱敏公开摘要。

### 用例 6：匿名单人预发布

1. 用两个干净浏览器上下文访问同源入口，检查各自收到 `HttpOnly`、`SameSite=Lax` cookie 和不同 world；将 A 的 `worldId`、`viewer` 或会话路径放入 B 的请求，B 仍只能得到自己的状态。
2. 输入娃娃名、角色名和世界叙述；预览阶段刷新并核对世界版本不变。分别测试取消和确认；对同一 `draftId` 重复确认只返回第一次回执。
3. 输入“去办公室”，先检查行动预演，再确认移动；快照进入办公室且兴趣范围出现 A。随后询问 A，回应事件由 A 产生，不出现玩家直控 A。
4. 重启 API 进程并保留 SQLite 与 cookie，检查资料、位置、版本和确认回执恢复。导出后导入当前格式，并分别验证 v5/v1 受支持样例；坏 schema 不覆盖现有状态，旧浏览器 key 不删除。
5. 从同源根路径加载构建页面与资产；请求源码、`.env`、SQLite、目录和路径穿越均返回拒绝。跨站 Origin 写请求、超限 JSON 和无/错管理令牌的 internal 请求均被拒绝。
6. 在没有模型配置下完成首次叙述、移动、询问和刷新；分别记录桌面 320/390/430 CSS px、微信 iOS/Android 和服务器外部 HTTP，未执行的环境保持“待测”。
7. 分别注入可迁移旧缓存、截断 JSON、字段缺失和不兼容值后刷新；页面先显示加载/恢复状态，不出现白屏或未捕获异常。旧缓存进入迁移预览；坏记录隔离后恢复 cookie 所属世界，服务端不可用时显示可重试的首次进入界面。
8. 进入主游戏后核对当前地点、可到达地点和在场角色均直接可见且可点击；点击地点进入移动预览，点击角色进入询问/互动预览，取消无副作用，确认后仍由 Kernel 复核可达性、在场和版本。
9. 对故事生成、行动预览、确认、取消、恢复和导入连续快速点击；每次进行中均有清晰状态，冲突控件禁用，同一操作只发出一次有效请求且只产生一个权威回执。模拟 409、422、429、503、断网和未知错误，界面显示中文说明与可执行恢复动作，不展示英文协议 detail、原始异常或堆栈。

### 用例 7：开放世界搭建、模型分层与环境交互

1. 玩家叙述一组人物、关系、地点和冲突；世界搭建模型返回世界圣经、地点图、角色目标/秘密、日程和遭遇草稿。关键事实缺失时只返回澄清问题，不自行发布事实；预览取消后运行时不可见，确认后产生版本化发布事件。
2. 用不同测试 adapter 配置 world-builder、player-doll、character 和 observer profile；检查调用只发生在对应职责和时机，切换 provider 不改变可见性、工具目录和写权限。禁用所有模型后，受限模板和本地规则仍能完成建世界与一轮移动/交互。
3. 玩家未靠近时，角色按日程从家到公司只生成 PresenceProjection/TravelProjection，不调用人物模型或逐步表演吃饭、如厕、工作。玩家在路途范围进入时，同一行程 ID 被物化为可交互场景；无人观察时到点只更新驻留投影。
4. 让角色开车、乘地铁、骑车和开灯；检查模型只提交固定 primitive 加实体参数，Kernel 结算路线、班次、时间和状态，ENV 返回可观察反馈。提交动态函数名或未发布机制时被拒绝并审计。
5. 运行观察者后，检查其只收到脱敏公开摘要且只产生 audit/correction proposal；普通游玩界面不把观察者伪装成角色与玩家对话，需要玩家决定的问题进入新的世界修订草稿。

## 证据要求

任何“完成”状态必须附：测试命令和输出摘要、事件/快照样例、必要的网络 payload 脱敏记录、桌面尺寸截图或真机记录。未执行项目保持“待测”，不得以模型演示、构建通过或提示词效果代替 Kernel、隐私、事务和回放证据。
