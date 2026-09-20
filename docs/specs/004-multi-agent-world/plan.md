# 004 技术方案 · TypeScript 前端与 Python 多 Agent 世界内核

本轮（2026-09-21，MW-36 / SP-21 / MW-AC-36）：本机桌面范围完成。已把独立浏览器试玩纳入仓库，完整 25 项通过；最后的导入位置修复又完成三项相关存档复测。修复离线重连覆盖、确认/取消误判、旧回执倒退、损坏 pending 锁死及导入位置分裂。前端 112/112、后端 166/166、类型和双构建通过，见[本轮证据](../../evidence/2026-09-21-playthrough-recovery.md)。用户 18766 原库保留；微信真机、公网、长篇与时长仍未验。

上一轮阅读衔接（2026-09-20，MW-35 / SP-20 / MW-AC-35）：依赖 MW-34，已归档桌面测试范围通过：三档长句分页、滚轮/合成拖动、方向变化、多选翻动、三路线共 455 次阅读、四档面板/pending 及导入/故事库生命周期补测；11 项合成输入/焦点复测和前端 104/104 通过。补测与生命周期报告对应基线 `94aec65` 源码，11 项 IME 报告为清理补丁前的阶段证据；未单列组合及真机边界见[阅读衔接证据](../../evidence/2026-09-20-reading-flow.md)。不以既往布局结果替代本轮行为验证。

上一轮横屏（2026-09-20，MW-34 / SP-19 / MW-AC-34）：用户明确要求手机游玩以横屏为主。横屏优先使用可用宽度组织舞台、对话和行动；短屏滚动、次级面板、竖屏提示、方向切换状态保留、安全区与软键盘处理均为实现默认。依赖 MW-33，本轮三档横屏通关、12项方向/面板专项及390×844竖屏/长句/安全区模拟通过，99项前端测试与构建通过，微信真机另验，见[横屏证据](../../evidence/2026-09-20-landscape-play.md)。前轮阅读交互通过记录不代替本轮布局证据。

上一轮交互（2026-09-20，MW-33 / SP-18 / MW-AC-33）：用户反馈“文字太多，不知道看哪里、交互不方便”，并明确要求旁白由巫毒娃娃承担。该轮收敛为单一对话阅读焦点、娃娃叙述、读完接行动和次级信息折叠；推荐动作一次点击由客户端串联既有服务端预览与确认，自由输入保留可见预览。当前本机范围通过99项前端、159项后端测试与三路线/窄屏/键盘/恢复浏览器验证，见[上一轮交互证据](../../evidence/2026-09-20-dialogue-focus.md)。下方159/159、96/96及三条浏览器路线为更早的故事基线，均不代替 MW-34 专项证据。

前一轮故事验证（2026-09-20）：Python 159/159、Node 96/96、类型检查与双构建通过；独立HTTP 220请求覆盖四结局与读档，桌面Chrome完成390×844署名、320×844保护、320×568审计路线。新故事本机闭环通过，整项仍部分完成：长篇内容/时长、微信、公网和完整故障矩阵未完成。见[本轮证据](../../evidence/2026-09-20-signal-story.md)。
更新日期：2026-09-20（Asia/Shanghai）。当前新建世界默认 `templateId=signal-rain-v1`、`version=1`，标题《红灯下的第三次回声》。本轮按用户“去网上找短篇小说融进来”的要求，实际阅读狄更斯《The Signal-Man》英文原文，以其警报、值班和重访结构创作三日教程。正文约 135 句、4,372 个汉字、20 个服务端步骤；这是内容规模记录，不能推导真实游玩时长或宣称已完成长篇。当前实现与验证范围见[本轮证据](../../evidence/2026-09-20-signal-story.md)，来源和改编边界见[研究记录](../../research/2026-09-20-signal-man-adaptation.md)。

`rainy-office-v1` 与 `rainy-office-v2` 原有内容、状态和存档路径保留，不自动升级为新故事。v2 已知的最终决定误触、`missed` 可覆盖、离场人物对白、时间/线索文案不一致四类缺陷仍待修；**兼容保留不等于通过验收**。以前的 Python 145/145、Node 95/95、v1 桌面浏览器/对话窗证据均为历史基线，不代替新模板的专项自动化和实际试玩。微信真机、公网 HTTPS、完整故障矩阵和真实游玩时长未验证。

## 目标架构

```text
微信 H5 / Mobile Browser
  TypeScript + PixiJS 8
  API client + SSE event reducer + local render cache
             |
             | HTTPS: commands / SSE: public events
             v
Python FastAPI
  Command API / Session & policy gate
  World Kernel (authority)
  Operation Queue + generation fence
  Turn Orchestrator + Context Builder
  WorldClock + Schedule Projection + Activation Manager
  Role Model Router + Agent Adapter (local / Pi / DeepSeek / Claude)
  World Builder (draft only) + ToolCompiler
  ENV Resolver + Relationship Resolver + World Observer
  Event Store (SQLite -> PostgreSQL)
             |
             v
        append-only events + snapshots
```

## 部署形态边界

语言选择和是否运行服务端分开管理。正式世界采用上图的 Python FastAPI World Kernel；它负责共享时钟、事件权威、模型密钥、策略 gate、审计和跨设备存档。纯 TypeScript 本地模式只作为离线试玩和无模型回退：把确定性 Kernel 子集、时间表和 ToolCompiler 放进 Web Worker，使用 IndexedDB 保存本地世界，并给事件加上 `executionMode=local`。浏览器被挂起或关闭期间不承诺后台推进，也不把本地事件直接当成正式世界事件。

如果将来希望整个正式系统使用 TypeScript，优先评估 Node/Deno/Bun 单进程 Kernel，而不是先拆成多个服务。替换前必须让它通过与 Python 相同的事件 schema、能力/可见性校验、CAS、幂等、回放和迁移合同；在 MW-AC-16 通过前继续保留 Python 和 Node `legacy-v2` 回退。使用 Edge Function、BaaS、数据库或远程模型仍属于服务化部署，只是减少自维护基础设施，不能写成“无服务化完成”。

前端继续是手机优先的像素舞台；它不执行关系结算，不把玩家选择直接转换成 A/B/C 的动作。Python 服务端可以先作为独立 `/api/v4` 服务运行，Node/002 作为并行回退，便于逐接口切换。

## 模块边界与文件责任

| 模块 | 责任 | 迁移后建议路径 |
| --- | --- | --- |
| Contract | OpenAPI、JSON Schema、事件/能力/可见性枚举 | `contracts/openapi.yaml`、`contracts/*.schema.json` |
| FastAPI API | 会话、命令、SSE、健康检查、错误映射 | `backend/app/api/` |
| World Kernel | 权威状态、能力校验、CAS、事务、幂等 | `backend/app/world/` |
| Operation Queue | FIFO 输入序号、异步结果、world/activation generation fence | `backend/app/world/operation_queue.py` |
| Clock | 服务端统一时钟、节拍、时区和受保护的管理调整 | `backend/app/world/clock.py` |
| Schedule | 时间表注册、重复/例外解析、驻留投影 | `backend/app/world/schedule.py` |
| Activation | 兴趣范围、激活租约、checkpoint 和生命周期迁移 | `backend/app/world/activation.py` |
| Turn Orchestrator | 微回合顺序、局部失败、取消和预算 | `backend/app/turns/` |
| Context Builder | 按角色过滤事实、事件、记忆和能力 | `backend/app/agents/context.py` |
| Role Model Router | 按 world-builder、player-doll、character、observer 职责选择模型、预算、超时与 fallback | `backend/app/agents/router.py`、`backend/app/config.py` |
| Agent Adapters | 本地模板、Pi、DeepSeek、Claude 统一接口 | `backend/app/agents/adapters/` |
| Registry | A–Y、Z、房间、物件、动作和关系白名单 | `backend/app/registry/` |
| Memory | 角色记忆、摘要、可见性和事件来源 | `backend/app/memory/` |
| Policy | 默认 SFW、成人 gate、输入/草稿/最终 beat 检查 | `backend/app/policy/` |
| Event Store | append-only 事件、快照、重放、cursor 和审计 | `backend/app/store/` |
| World Observer | 确定性不变量审计、低频只读模型审计和修复提案 | `backend/app/world/observer.py`、`backend/app/audit/` |
| Tool Registry / Compiler | 原子能力、实体 affordance、组合动作模板和世界搭建草稿编译 | `backend/app/tools/`、`backend/app/world_builder/` |
| Mobility Resolver | 车辆、地铁、自行车的路线、班次、到达投影和可重放事件 | `backend/app/tools/mobility.py` |
| Single-player facade | 匿名 cookie 会话、故事/行动预览确认、回执、导入导出 | `backend/app/{sessions,gameplay}.py`、`backend/app/api/` |
| TypeScript client | 命令、SSE、事件 reducer、本地缓存恢复、请求状态、中文错误映射与重连 | `hex/src/api/`、`hex/src/world/` |
| Scene UI | 像素房间、角色、对话、当前/可到达地点、在场角色快捷行动、反馈与回放控制 | `hex/src/scene/` |
| Migration | v5/003/Node 状态导入、校验和回滚 | `backend/app/migrations/` |

表内路径是目标布局。当前 Kernel 位于 `backend/app/domain/world.py`，上下文/记忆/ENV 位于 `backend/app/domain/{perception,memory,resolver}.py`，Adapter 位于 `backend/app/agents/`，ToolCompiler 位于 `backend/app/tools/`，世界搭建器是 `backend/app/world_builder.py`，客户端为 `hex/world-api.ts`。已有代码并未迁至所有建议目录；后续移动文件时同步任务责任，不为目录整齐单独重写。

## 事件驱动状态机

```text
idle
  -> intent_received
  -> proposal_created
  -> targets_notified
  -> responses_collected
  -> env_resolved
  -> commit_pending
  -> committed
  -> streamed
```

取消、超时、策略拒绝、版本冲突和非法提案都进入终止状态，不得写入部分关系或记忆。`responses_collected` 对每个目标设置独立超时；局部失败进入 `fallback_response`，整幕只在 Kernel 或存储失败时回滚。模型/异步适配器调用必须先进入 `OperationQueue`，绑定 `worldGeneration` 和可选 `activationGeneration`；队列完成时任一代数变化即返回 `generation_fence_reject` 审计，迟到结果不能进入提交事务。

## 世界时钟与生命周期状态机

### 时钟推进

`WorldClock` 由服务端单调时间锚定到世界时区，返回 `day`、`minute`、`timezone`、`speed`、`clockVersion` 和上次投影时间。普通客户端只能读取时钟和发送兴趣范围，不能提交 `day/minute`。首版 `speed=1`，服务端每次命令、兴趣心跳和 SSE 补拉前做一次惰性投影；部署规模增大后再由后台 worker 定时投影，事件契约不变。

时钟推进不调用 Agent。`ScheduleProjector` 根据注册表算出每个 A–Y/Z 的 `PresenceProjection`，只写入来源时间表、房间/区域、活动标签和有效时间窗。没有玩家观察时，不生成吃饭、工作或如厕等逐分钟事件；这些都是角色在时间表中的驻留标签。`clock_advanced` 和 `presence_projected` 必须带固定 resolver 版本，回放只重算投影或读取事件，不依赖当前系统时间。

### 时间表解析

时间表块使用半开区间 `[startMinute, endMinute)`，跨午夜拆成两个块。按 `priority desc, scheduleId asc` 选择重叠块；同优先级冲突进入审计事件，不由模型随机决定。例外日期、请假或临时离开必须成为新的版本化注册表事件。角色的 `defaultLocation` 只在没有命中块时使用。

### 按需激活

玩家会话维护 `InterestLease(sessionId, roomId, zoneId, expiresAt)`。进入新兴趣范围时，Kernel 比较当前 `PresenceProjection` 与上一次兴趣范围，对命中的角色执行 `dormant -> staged -> active`；同一租约内重复心跳不重演遭遇。`active` 角色收到从 `lastCheckpointClock` 到当前时钟的摘要，而不是逐分钟模拟。玩家离开、心跳过期或回合结束时进入 `quiescing`，只写入已校验的公开事件和短期摘要，然后释放租约。

```text
dormant -> staged -> active -> quiescing -> dormant
                         \-> fallback (本回合局部回退后回到 active)
```

首版按 `roomId + zoneId` 计算范围；未来接入坐标时只替换 `InterestResolver`，保留相同的租约、事件和权限。激活上下文仍由 Context Builder 过滤，不能携带其他角色 private 记忆或未确认草稿。

未被玩家观察的移动只创建 `TravelProjection`，包含起点、终点、方式、计划出发/到达时间和来源日程。玩家在途中进入相同路线节点时，Kernel 才把剩余步骤物化为可交互的组合动作；无人观察时直接在到达时间生成新的 `PresenceProjection`。物化前后必须共享同一行程 ID、时间和目的地，避免玩家靠近后看到角色瞬移或重复出发。

生命周期当前边界：时钟、投影、严格 room/zone 租约、heartbeat、过期拒绝、checkpoint/summary、日程切换、generation/token、遭遇选择已有回归；世界草稿 API 已能确认公开日程。坐标半径、非零容差/例外日期、完整冲突审计、生产后台节拍与 provider 超时矩阵待补，不能描述为完整生命周期验收。

### 随机遭遇与观察者

`EncounterResolver` 只从房间、角色、关系注册表中选择候选，种子为 `(worldId, clockDay, clockMinuteBucket, sceneId, encounterVersion)`；选中的 encounterId 写入 `activation_started`，因此重连不会重新抽签。模型只润色台词或提交合法回应。

`WorldObserver` 分为两层：Kernel 在时钟投影、激活提交、世界保存前运行确定性不变量检查；可选模型观察者只处理带 dirty 标记的活跃世界，首版至少间隔 15 个游戏分钟，并把激活后或异常事件后的请求合并为一次脱敏公开摘要审计。没有新事件的无人世界不入队。模型只返回 `audit`/`correction_proposal`，必须再次通过 Kernel；可自动修复的内容仅限位置投影、未知事件丢弃和过期租约清理，关系、事实和角色意志只能记录问题并等待正常交互。观察者不可用时不阻塞时钟或角色回退。

当前 `observer.py` 仍以确定性检查为主，覆盖部分房间和同优先级日程问题；脱敏报告已经持久化到 `audit_events` 并按报告哈希去重，但租约/事件/关系完整不变量、低频模型输入脱敏、受限 correction proposal 和修复事件仍是后续任务。

### 本轮 SDD 切片：世界草稿发布的一致性

任务为 MW-22/MW-25/MW-26，关联 WL-08/WL-09、MW-AC-22/25/26，依赖已有 MW-18 时间表投影、MW-20 遭遇选择及 MW-23 实体注册表。负责文件为 `backend/app/tools/{compiler,mobility}.py`、`backend/app/world_builder.py`、`backend/app/store/event_store.py` 和对应 world_builder/tool_declarations/API 测试；同步 MW-21 审计去重。以下实现默认已有本轮证据，不代表整个世界搭建完成：

- 编译器逐层验证实体、重复日程和遭遇的类型、范围、重复 ID、已注册角色/房间/交通站点引用；不支持的声明明确拒绝。当前非空 `rooms`、例外日期、非零日程容差和私密日程暂不支持。
- 日程只接受已有 A–Y 人物，使用现有 daily/星期列表与半开时间段；遭遇只描述公开候选、地点、参与人物、正整数权重与摘要，不允许声明关系变更或角色意志。各列表按稳定 ID 合并，暂不提供删除语义。
- 预览记录编译器版本、基础世界/注册表版本、声明哈希和三类内容的数量；未确认的数据仅存于独立草稿表。读取草稿返回副本，调用者不能修改待确认内容。
- 确认前重新校验草稿和哈希，并检查 CAS 与注册表基础版本；SQLite 写事务再次核对草稿存在、内容和版本，一次写入实体、日程、遭遇、发布事件及回执并删除草稿。删除或存储失败则整体回滚。省略 `expectedVersion` 使用创建时版本；跨连接/重启重复确认返回首次结果，取消先完成则确认拒绝。
- 发布只更新定义；已有时钟/激活路径按下一次服务端投影读取新日程，不在确认时调用角色模型。重启恢复、取消、非法声明、冲突和存储失败需要独立证据；基于事件从零重建整个世界仍单独验收。

下一实现切片先只收紧 MW-23/MW-AC-23 的 `PublishedRegistry`/`Runtime State` 边界：发布定义保存类型、默认位置、affordance、动作与路线；实体运行投影只保存当前位置、区域和 `lastAction` 等明确可变值。resolver 的类型、动作与路线只能读取已发布定义；旧快照中的重复静态字段在读取或使用时忽略，地点与仍合法的 `lastAction` 继续保留。该切片不同时实现事件从零回放、新房间或新角色，也不引入第三方状态框架。

完成上述边界后，再以 MW-04/MW-26 独立切片实现领域事件 reducer：从空白世界依次应用 `world_registry_published` 与工具/mobility 事件，得到与事务快照一致的注册表版本、实体运行态、玩家位置和 mobility 状态。两步分开验收，避免以快照重启测试替代真正的事件重建证据。

世界搭建流程以玩家叙述为输入，高能力 `WORLD_BUILDER` 产出世界圣经、地点图、角色公开设定与私密目标、初始关系、日程、实体和遭遇候选。服务端先进行引用、冲突、可达性、隐私和能力校验，再返回可读预览；只有玩家确认的版本进入 PublishedRegistry。运行时扩建复用同一流程，不能由人物 Agent 或观察者自行创造已生效的地点、人物或机制。

### 按职责选择模型

`RoleModelRouter` 根据 `world-builder`、`player-doll`、`character`、`observer` 四类 profile 选择 provider/model、上下文预算、响应预算、超时和 fallback。目标默认是：世界搭建使用高能力低频模型，娃娃使用较强低延迟模型，激活人物使用快速低成本模型，观察者使用低频只读模型；ENV 和 Kernel 不依赖模型完成结算。profile 只由服务端配置并记录在审计元数据中，不能改变 Agent 的工具集、可见事件或写权限。

`WORLD_BUILDER` 可以在草稿阶段向玩家返回结构化澄清问题；`WORLD_OBSERVER` 不进入角色对话，也不向玩家发布剧情事实。需要玩家决定的审计问题进入管理/修订草稿，正常游玩仍只通过 `PLAYER_DOLL`、在场人物和场景反馈进行。

## Agent Adapter 契约

适配器只接受不可变的角色上下文和能力清单，返回结构化提案，不得直接访问 FastAPI request、数据库、文件系统、网络工具或其他角色私密上下文：

```python
class AgentAdapter(Protocol):
    async def propose(self, request: AgentRequest) -> AgentProposal: ...
```

`AgentProposal` 必须包含 `actor_id`、`action`、`target_id`、`channel`、`payload`、`source`、`trace_id`，并通过 Pydantic 和注册表二次校验。`source` 只能是 `local`、`pi`、`deepseek`、`claude` 等已注册值。模型提供的关系数值、世界版本、权限和策略等级全部丢弃，由 Kernel 重算。

## 微回合调度

1. `PLAYER_DOLL` 只解析玩家意图并生成 `YOU` 可执行的公开动作；不能把 A/B 指令写入动作列表。
2. Kernel 计算在场目标和可见性，按稳定排序向每个目标创建隔离 `AgentRequest`。
3. 每个目标最多提交一项回应；无模型、超时或非法结构时使用该角色的本地 fallback。
4. Kernel 合并合法回应和关系候选，原子写入公开事件、个人后果、共同关系后果和物件状态。
5. ENV resolver 根据已提交事件产生灯光、声音、天气、门和物件反馈；ENV 不创造人物私密事实。
6. Memory writer 为每个角色写入各自可见的事件摘要；未提交提案、私信和策略拒绝不写入。
7. SSE 只向当前 session 推送玩家可见事件，客户端按 `eventId` 去重并重建舞台。

## 数据存储与回放

- SQLite 表：`world_snapshots`、`events`、`agent_memories`、`idempotency_keys`、`migrations`、`audit_events`。
- `events` 使用 `event_id` 主键、`world_version`、`turn_id`、`schema_version`、`visibility`、`payload_json`、`resolver_version`、`source` 和创建时间；SSE 可用 `afterEventId` cursor 补拉同一 world version 内的多个事件。
- `audit_events` 保存工具拒绝、观察者报告和同步角色提案路径中的 generation fence 拒绝。观察者报告以 worldId+reportHash 唯一键去重；旧库升级保留所有历史。队列/worker 本身尚未持久化。仅记录 reason、版本、角色和 hash 等脱敏字段，不保存原始模型输入/输出。
- 写事务锁定当前世界版本；`expectedVersion` 不匹配时不执行任何副作用。
- 快照定期保存可重建的房间、实体、物件、关系索引和记忆索引；完整事件仍保留用于审计和回放。
- 回放器只消费事件和固定 resolver 版本，输出与原舞台一致的渲染事件；禁止重新调用模型。

## API 草案

### 单人预发布入口

`SessionManager` 只从 `voodoo_session` cookie 解析匿名会话，并通过 SQLite 的 `sessions` 表取得 world；客户端永远不提交权威 `worldId`。`SinglePlayerGame` 是 World Kernel 之上的产品翻译层：它把首次故事和少量自然语言行动翻译成已有世界草稿、回合草稿和兴趣范围调用，不直接改状态。进程内 kernel cache 只优化延迟，SQLite 仍是重启和多连接恢复的事实源。

故事和行动分别复用 `world_build_drafts`、`draft_turns` 与持久 gameplay receipt。预览只读；确认在 per-world 临界区中提交并保存回执；取消删除未确认草稿。移动确认完成后，以服务端快照中的 `YOU.roomId` 调用 `update_interest`，再返回合并后的事件和快照，避免前端伪造地点或时钟。

### 本轮 SDD 切片：完整教程、推荐动作与主人公生活

任务分为 MW-28（SP-11/SP-14 → MW-AC-28）和 MW-29（SP-12/SP-13 → MW-AC-29）。二者依赖 MW-27 的匿名会话与预览/确认、MW-17/18/19 的世界时钟与角色驻留、MW-23 的物件能力。章节与生活结果必须进入现有世界事务；没有第二套由浏览器决定的剧情权威。

教程延伸 MW-32（SP-17 → MW-AC-32）仅针对 `rainy-office-v1` 兼容存档：在旧主线结局后加入第二天旧伞支线，验证 NPC 离场后的公开线索、替代路径、旧档兼容和多日存档。它不改写主线结局，也不引入运行时动态工具；后端/无模型回归通过后，仍需浏览器、真机和故障矩阵证据。signal 默认第二日的地铁站/厨房双入口属于 MW-28 主线，不是该 `postscript` 支线。

用户确认的行为是：教程本身可从开场游玩到结局；根据当前目标给出推荐动作，同时保留自由表达；主人公有工作/上学等日常主线；NPC 按自己的生活表活动，错过场景和时间会改变机会；新手与自定义世界双入口、故事预览/确认、刷新恢复继续保留。以下题材、章节、时间与字段是实现默认，行为变更时同步规格及证据。

1. **首篇内容**：默认《红灯下的第三次回声》，`templateId=signal-rain-v1`、`version=1`。根据已实际阅读的狄更斯《The Signal-Man》改写铁路警报、固定值班和重访结构；本项目新写人物、事故与中文台词。三日共 20 个状态，第二日车站/厨房为替代证据路线；具体事实表和窗口见 [tutorial-story.md](tutorial-story.md)。文本量不构成真实时长或长篇完成证据。
2. **模块分离**：`signal_story.py` 管理状态、公开日程、道具、动作门槛和结果；`signal_content.py` 只渲染对白；`narrative.py` 按 templateId 派发，原 v1/v2 代码和存档不自动升级。`gameplay.py` 翻译受限意图并使用 signal 专用耗时，仍经过 Kernel 草稿/确认事务。已知 v2 四类缺陷未因新模板发布而修复。
3. **权威事实**：narrative 保存 `facts`、`clues`、`missedWindows`、`choice/finalChoice/ending`。只有已确认物件动作或在场交谈写事实，阅读、普通等待/开门不补第二日证据。最终选择须为办公室向 A 的明确 ask/tell；audit 需 auditSaved，trust 需 manualRed+dossierRead。回执原件事实 receiptSeen 只在第三日核对后成立。
4. **时间与失败**：第一日从 09:00 开始，arrival 至 day1-choice 任一未完成阶段在 10:00 到期即 complete+missed；第三日 day3-archive/hearing/decision 在 12:00 到期同样结束。当前按动作结算后的时钟判定；预览不能锁住窗口。第二日周野到 11:00 离开后仍需实际读公开交班簿；沈青到 12:00 离开则转档案，不得补录音。completed 后不改结局。
5. **跨日与恢复**：回家不是跳日。只在 home 的 sleep1/sleep2 明确睡觉，分别开启第 2 日 10:00、第 3 日 09:00；Kernel 使用重锚定后的时钟重投影人物。导入 signal 档案安装 canonical 道具但不初始化进度，导入/发布旧模板或 custom 清理 signal 专属事实载体。其他保存、取消、重试和 CAS 规则不变。
6. **公开展示**：guidance 提供 title/chapter/objective/passage/completed/ending/playerRoutine/scheduleHint/actions/journal/dialogueId/dialogue。对白仅来自当前公开信息，离场人物不继续说话；结尾列出真实证据与缺口。主线推荐、自由行动和自由输入共用确认入口，未知动作保留输入并解释。

验证在独立数据库、会话和浏览器上下文进行，不清用户存档。专项矩阵覆盖三种正常结果、第一日早期/选择阶段迟到、第三日迟到、第二日两个入口和缺证据路线、普通动作不误选、取消幂等、重启导入、旧模板兼容与 320/390 可用性。新结果写入 [signal-story 证据](../../evidence/2026-09-20-signal-story.md)；历史 145/95 不作为本轮通过数量。微信真机、公网和完整故障矩阵分别记录。

### 本轮 SDD 切片：Galgame 对话窗

MW-30（SP-15 → MW-AC-30）负责教程的演出层与其公开数据投影，最初在 v1 五章短篇验收，signal 新默认复用该契约并另行验证内容。用户参考图确认“人物名牌 + 对话文字窗”的方向；当前默认以文字演出补足角色表达，不新增立绘、配音或世界规则。

1. **服务端公开剧本**：`backend/app/narrative.py` 从已确认 narrative 阶段返回稳定的 `guidance.dialogueId` 和 `guidance.dialogue` 数组。每句为 `{speakerId, kind: speech|thought|narration, text}`；对白按公开角色名显示，`thought` 仅允许 `speakerId=YOU`，环境叙述不伪装为 NPC 心声。`speech` 只包含人物实际说出的台词，第三人称动作单列为叙述，避免显示成角色把自己的动作念出来。保持原 `passage` 的兼容回退，不把 NPC private memory、未揭示秘密或其他世界内容放进投影。
2. **前端阅读状态**：`hex/play-api.ts` 增加类型，`hex/play.ts` 与 `hex/play-dialogue.ts` 管理当前句、本段记录和行动区展开；`hex/play.css` 提供名牌、正文窗与移动端排列。阅读位置按 worldId/dialogueId 隔离，内容变化进入相应段落，刷新恢复当前段落的游标。缓存损坏或存储不可用时可从本段开头继续，不阻断行动或改写世界进度。
3. **输入与行动分开**：文字窗支持明确按钮及键盘逐句阅读，输入框内按键不能误触下一句或确认动作；读完再展示当前推荐选项，并始终提供提前展开行动的入口。MW-31 补充错误恢复例外：解析失败时立即展开推荐及具体交谈对象，无需先读完本段。展开、下一句和查看记录不调用行动确认接口，不替玩家选择分支。行动预览期间锁定阅读操作，取消后保留原阅读位置；未知输入被拒绝后不替换当前对白。选项仍通过原有服务端预览/确认，由 Kernel 校验在场、版本、能力和机会；MW-33 将推荐按钮串联为一次点击，自由输入保留可见预览。
4. **时间与恢复**：阅读不结算行动耗时，也不冻结 WorldClock；自然时间关闭机会时，旧文字可以作为已读记录保留，但旧选项不能复活角色。切换 world、故事确认或导入后不得套用另一世界阅读位置。离线移动后按新场景生成本地反馈，不能继续播放之前场景的 NPC 对白。对话记录只是玩家可见文本的展示历史，不是事件存储或隐藏剧情解锁依据。
5. **验收范围**：服务端验证各阶段文本、对白类型边界和无私密投影；前端验证游标恢复与世界隔离。浏览器实际阅读多句、提前展开、完成后选项、记录回看、刷新恢复、输入区键盘隔离和 320×568 / 390×844 布局；记录行动前后时钟/章节，证明阅读没有额外结算。原三结局与迟到判定继续回归，微信真机另记。

### 本轮 SDD 切片：阅读焦点、娃娃叙述与便捷行动

MW-33（SP-18 → MW-AC-33）依赖 MW-27–31。用户要求减少文字焦点竞争、简化操作，旁白由巫毒娃娃承担。实现默认如下；不改变当前故事、事实、角色日程与服务端协议。

1. **单一阅读焦点**：`hex/play.ts` 与 `hex/play.css` 以当前对话窗为主要阅读内容，压缩地点/时间等状态提示；不在同屏再铺开同一段 passage、完整目标说明、调查笔记和行动日志。保留简短行动指引，日程、笔记、记录默认折叠，展开是只读展示行为。
2. **说话者职责**：`narration` 使用 `profile.dollName`（缺省为巫毒娃娃）作为叙述者呈现；NPC speech 显示原人物名，YOU thought 保留“你/心声”。本段回看使用同一身份规则；不把第三人称叙述加引号伪装成 NPC 台词，不将后端 ENV actor 或历史事件重写为角色行动，不读取私密状态。
3. **读完接行动**：最后一句之后显露与当前 guidance 对应的推荐动作；最后一句/展开本身不执行其中任何一个动作。提前行动入口和错误后的直接恢复保留，避免世界时钟运行时玩家被阅读进度困住。日程和笔记折叠不隐去必要的当前地点/时间。
4. **推荐动作一次点击**：推荐按钮已经明确表达玩家选择，客户端串联 `intent → confirm_intent`，继续使用服务器返回的 turnId/version，不写本机权威状态。按钮显示动作、耗时和进行中反馈；整条操作复用 in-flight 锁和幂等标识。预览失败不发确认，确认失败不改选另一动作，不在重连后自动重放未知结果；过期 guidance 仍由 Kernel 校验。正常路径不另要求玩家点击一张相同意图的确认卡。
5. **自由输入保留预览**：用户输入仍先解析并展示动作/对象/耗时，明确确认后执行，取消不推进。故事搭建/导入等流程不因推荐快捷执行而失去原确认边界。快捷按钮与自由文本提交使用不同的 UI 意图标记，不能把后一条自由输入继承为自动确认。
6. **回归范围**：专项覆盖单焦点、娃娃自定义名/回看、NPC本人、YOU心声、读完/提前行动、三类信息折叠、推荐只点击一次且仅产生一个回合、快速双击、预览失败/过期确认、自由文本取消和刷新恢复；390×844/320×568实际操作并记录截图/请求。历史故事159/96与通关证据不覆盖本轮变更。

MW-33 本机桌面浏览器范围已通过，见 [dialogue-focus](../../evidence/2026-09-20-dialogue-focus.md)；微信真机/公网及完整故障矩阵仍待测。其结果不代替 MW-34 横屏布局验证。

### 本轮 SDD 切片：横屏优先与短屏交互

MW-34（SP-19 → MW-AC-34 A–F）依赖 MW-33 的单一阅读焦点与行动流程。用户确认手机游戏以横屏为主；以下布局与兼容策略为实现默认。负责文件为 `hex/play.ts`、`hex/play.css` 及必要交互验证；SDD owner 维护本目录四件套与 [landscape-play](../../evidence/2026-09-20-landscape-play.md)，集成负责人维护 HANDOFF。

1. **游戏视口**：横屏利用可用宽度安排舞台与当前对话/选择，不沿用狭窄竖屏卡片宽度；顶部只保留简短地点/时间与菜单。优先在一个可视视口完成正常阅读和点选，避免靠外层页面长滚动寻找继续按钮。具体分栏、比例和断点由短屏实际结果确定。
2. **内容与控件分区**：长段落、选择列表和次级面板可内部滚动；继续/返回/关闭等关键控件保持可达和至少 44 CSS px 触控高度。不得通过截断剧情、缩小到难读字号或裁掉按钮来达成“适配”；568×320 单独验证。
3. **次级面板**：自由行动、手记/日程、回看沿用已有状态，打开时有明确关闭/返回入口；关闭后仍是原对白位置或当前选项。页面层级和滚动区域不能挡住输入预览、取消或错误恢复。
4. **方向与视口变化**：竖屏保留核心玩法并给轻量横屏提示，不调用强制方向锁定、不通过 CSS 旋转整个 DOM。方向切换优先仅重排现有节点，不重新初始化故事或触发意图请求；保留 world/dialogue 游标、未发送草稿、pending turnId 和已确认结果。自然时钟按服务端继续推进。
5. **安全区与软键盘**：布局考虑四边 `safe-area-inset` 和可用高度变化；输入聚焦、键盘开合后仍能看到输入内容及预览/确认/取消出口。横屏矮视口不能把键盘弹起误判为需要清空状态或重建游戏。实现可选动态视口单位/VisualViewport，但 API 可用性不能成为玩法前置条件。
6. **验证先后**：先测 844×390、667×375、568×320 的阅读/选择/次级面板与长内容，再测 390×844 及横竖反复切换；覆盖自由输入、pending 旋转后取消/确认与重复按键。记录控件边界、滚动范围、请求/快照及截图，至少完成一段完整剧情交互。桌面缩放可视区域只作为软键盘布局代理，微信 iOS/Android 真实旋转、刘海安全区与输入法另记待测。

MW-34 本机桌面范围已通过，实际横屏/方向/面板/安全区代理证据见本轮记录；微信真机仍待测。没有世界协议、故事规则或存档迁移变更。

### 本轮 SDD 切片：长句、多选项与输入焦点衔接

MW-35（SP-20 → MW-AC-35 A–E）依赖 MW-34。用户要求继续完善横屏，本轮针对实际阅读/输入衔接问题修复，以下均为实现默认；不扩写剧情、不改后端。实现负责人维护 `hex/play.ts`、`hex/play.css`、`hex/play-reading.ts` 与必要前端交互验证；SDD owner 只维护 004 四件套与 [reading-flow](../../evidence/2026-09-20-reading-flow.md)，HANDOFF 由集成负责人维护。

1. **先看完当前句**：继续阅读入口共用当前文字区剩余内容判断。仍有下方内容时，只滚动一个可见阅读屏并保留句索引；滚到底后下一次明确操作才调用现有下一句。短句不多加一步。滚动中连点不得因动画或旧尺寸误判跳过未显示内容；窗口/方向变化后根据当前实际可见高度判断。明确“提前行动”保持独立可达。
2. **区分滑动与点击**：跟踪文字区指针/触摸位移或实际滚动，超过点击容差的滑动结束不触发下一句；原生滚轮/滚动也只移动内容。滑动后下一次独立点击仍可继续，不能永久锁住文字框。具体阈值按真实复现调整并记入验证，不作为用户指定参数。
3. **选择列表可发现**：短屏下方仍有未显示选项时显示明确提示，提供一个可点击的翻动列表入口；滚动到底或内容/方向变化后更新提示，不保留过期“还有选项”。该入口只滚动，不转交推荐动作处理函数、不聚焦执行按钮、不改变当前选中意图。完整选项继续保留，玩家可自行滚动或点击具体动作。
4. **输入法与长按 Enter**：自由输入以组合状态和按键重复标记阻止误发送；中文候选字确认按键不作为预览提交。组合结束后玩家的新按键/预览按钮可正常提交，并继续遵守 in-flight/pending 锁，长按不连发。同一 Enter 不能从输入跨到预览继续确认。
5. **明确焦点交接**：打开自由行动/手记/回看时焦点进入当前可见面板，关闭归还原入口；原入口失效时回到可达的阅读/选择容器。预览显示时将焦点落在非执行容器，取消后回到对应阅读或选择容器，保留原文和阅读游标；不自动焦点到确认或推荐按钮。焦点转移只管理展示和键盘，不调用行动接口。
6. **验证矩阵**：在 568×320 和 667×375 复现长句、多选列表、滑动和焦点；844×390 与 390×844 检查无回归。记录 scrollTop/clientHeight/scrollHeight、句索引、焦点目标、组合/重复按键以及 intent/confirm 请求数量；覆盖 pending 取消、读完、提前行动和方向切换。真实手机触摸与中文输入法另列，不能用合成事件声称真机通过。

已归档桌面范围通过：568×320、667×375、844×390 长句分页、滚轮/合成拖动、方向变化与选项翻动；上述三档及 390×844 的三类面板焦点、pending 旋转/取消；导入 5 次、故事库往返 5 次与 pending 刷新恢复均已有补测。11 项合成组合输入/焦点测试为清理补丁前的阶段证据，补测与生命周期报告对应当前源码；前端 104/104。长句未到底时提前行动的独立组合未单列，真实触摸/输入法/软键盘仍待测；逐项以 [reading-flow](../../evidence/2026-09-20-reading-flow.md) 为准。

### 本轮 SDD 切片：可重复游玩与恢复核对

MW-36（SP-21 → MW-AC-36 A–F）依赖 MW-27–35，本机桌面范围完成，证据见本页顶部。实现负责人维护 `scripts/playtest-single-player.mjs`、`hex/play*.ts`、`tests/play-*.test.js`、`backend/app/gameplay.py`、`backend/tests/{test_single_player_cancellation,test_signal_story}.py`、`package.json` 和 `README.md`；SDD owner 维护本目录四件套，HANDOFF 与本轮新证据由集成负责人更新。以下是实现默认，按实测细化，未运行的用例不记通过。

1. **隔离并可重复执行**：脚本启动独立服务，使用临时 SQLite、随机可用本机端口和隔离浏览器会话，显式采用无模型配置。等待健康就绪再游玩，成功或失败都关闭自己创建的进程/浏览器；不复用用户 18766 服务、会话或原库。入口和必要依赖写入运行说明，报告保留环境、断言与错误。
2. **从入口读到结束**：使用当前“开始新手故事”及显式确认流程，通过真实页面推荐动作完成 trust/audit/protect，覆盖第二日车站与厨房调查，并另测第一日/第三日错过时间窗。读完最后一句后核对界面完成态、服务端 completed/ending 和自由行动入口，避免只看到结尾文字就停止。按实际组合记录，不能把三条路线推成全部组合通过。
3. **存档恢复**：导出途中及完成结果，在隔离会话导入并核对章节、分支、地点和结局；刷新或继续游玩不重结算。坏档或失败导入保持原进度且允许继续操作。用户真实存档不进入测试清理范围。离线移动同步缓存 YOU/DOLL 位置；导入时顶层 roomId 是玩家位置来源，人物缓存不得覆盖它，兼容既有错位离线档。
4. **离线与重连**：已加载页面断网后，区分本机试玩记录与服务端确认状态；不可把本机投影记成在线确认。重连维持本地试玩，菜单“回到在线故事”成功写入 `voodoo-single-player-v1-offline-backup` 后才切回在线；备份保存完整本机状态，并可从“离线备份”导出。备份失败不切换；不自动提交离线行动。旧故事备份 key 保持独立。
5. **丢响应与取消**：分别覆盖请求未提交与服务端已提交但响应丢失。对不确定结果保留可核对的上下文，后续恢复或取消必须以服务端事实为准；已提交的结果不被取消提示掩盖，也不通过重发造成第二次行动。公开取消入口在同世界锁内查询产品和内核持久回执，已提交分别返回 `turn_already_committed` / `story_already_committed`（409），未知行动返回 404；前端用幂等确认取原回执。每次在线确认后刷新会话，`latestConfirmedView` 在同 world 的已知状态、回执和刷新结果中取最高版本；刷新失败也不覆盖已知较新进度。高于回执时显示当前段落，历史反馈以原地点、时刻、人物名记入去重日志。取消断网保留预览；确认已过期则读当前会话后解除。缓存标准化只保留可恢复的 pending。
6. **验收范围**：正常路线覆盖三档横屏，竖屏验证核心输入/恢复入口；补充阅读/输入专项时记录真实覆盖范围。报告关联源码和执行环境，截图用于视觉检查，状态/请求断言用于行为结论；微信真机、完整故障矩阵、长篇质量和时长继续独立记录。

### 历史底座与新模板待验：事实驱动教程与上下文接话

MW-31（SP-16 → MW-AC-31）依赖 MW-28 的已确认章节、MW-29 的行动/错误恢复与 MW-30 的对话展示。诊断已观察到“先开门三次 → 看便笺 → 去地铁站 → 重复问周野今天怎么样”，当前地点为 station 而教程仍要求 open；“说什么”失败时推荐又被阅读门槛隐藏。该记录确认问题存在，不作为直接改写存档的事实源。以下为修复默认，不扩展任意自然语言工具能力。

1. **从事实判定目标**：`backend/app/narrative.py` 区分已确认便笺、门/离开、抵达、告示、工作与分支事实。阶段投影承认玩家先做后置行动，再完成前置线索；合法离开已满足出发，不能要求重演开门。仅合并已经成立的条件，不能因到过站点就补上阅读告示，也不能把普通聊天当作完成关键剧情选择。
2. **旧档纠偏**：服务端在现有 world 事务边界内检测教程位置与已确认事实不符，保存修正结果及可审计依据，保持幂等；投影函数本身不暗写数据库。修正不是补发一次玩家行动，不扣行动时间、不改地点、不重演对白、不擦除事件与用户记录。自然时间照常推进；错过的窗口、已做出的选择及结局不能被纠偏重置。并发/重试应只留下同一修正结果，存储失败不半写章节。
3. **明确日常对话**：首篇周野的本地模板分别处理日常、告示、三分钟与追问，回应给出可继续的问题或物件线索；没有模型也能理解“下一步可问什么”。文本仍遵守公开可见信息和纯台词契约，不读取 NPC 秘密，不替玩家执行站门/告示动作，也不凭对白跳过尚未确认的线索。
4. **有限上下文解析**：`backend/app/gameplay.py` 对“说什么 / 什么意思 / 然后呢 / 继续说”等受支持接话句式，先找最近仍同场的已确认交谈对象，再尝试唯一在场可交谈人物；多对象且无有效上下文返回中文澄清与候选对象。跨场景或已经离场的对象无效。明确动作仍优先走既有动作解析，未知物件、越权动作和任意不明文本不降格成成功聊天；接话继续走预览/确认及服务端在场校验。
5. **前端直接恢复**：解析错误后保留输入、日志及当前对白，打开行动区并显示推荐动作、可点的具体交谈对象和中文恢复提示；这个展开只改变表现状态，不自动重试或确认动作。用户无需重开世界、清档或先点完一段文字即可继续游玩。

验证需重走用户的非标准操作顺序，以及既有错位存档恢复；对照修正前后的事件、时钟、未读线索和迟到状态。接话分别验证最近同场对象、唯一对象、多对象澄清、离场失效及未知动作拒绝。浏览器从错误状态直接选推荐或交谈对象继续，确认原日志和输入保留；手机模拟与真机仍分别记录。

前端 `hex/play.ts` 通过同源 `PlayApiClient` 使用 cookie，会在网络不可用时保留本地规则试玩。生产入口由 FastAPI 明确挂载 `dist-hex/index.html` 和构建资产；源目录、任意文件路径和目录列表不可访问。写接口由统一 middleware 限制请求体并检查 `Origin`，内部接口通过 `WORLD_ADMIN_TOKEN` 隔离。该生产边界必须经 HTTP 测试后才能从“待验证”改为“通过”。

启动恢复采用“先渲染壳层，再读取非权威缓存，最后拉取服务端会话”的顺序。本地状态读取放在异常边界内，按 schema/version 校验；受支持旧 key 只生成迁移预览，不自动覆盖当前 world，损坏记录按 key 隔离并保留诊断摘要。任何解析或迁移失败都必须收敛到服务端快照或首次进入状态，不能阻止页面挂载、导航和重试。

## 阶段目标：教程标杆范围与长篇边界

本项目先用完整、可反复试玩的三日教程建立开放世界 Galgame 的标杆，再扩充角色数量、路线和世界规模。用户已明确指出旧短篇的内容量与交互不足；signal 新稿必须以实际游玩验证完整故事和可用性，不能只增加阶段名称。教程不是帮助页，也不是临时演示；它是第一条可验收的产品纵切片。每个后续章节都应复用“生活职责 → 场景物件 → NPC 时间窗 → 对话选择 → 结果/继续”闭环。

### Phase 1：单人教程标杆（当前预发布门槛）

Phase 1 的目标是在无模型配置下，新玩家依靠推荐动作和普通对话入口完成《红灯下的第三次回声》，理解证据、日程和选择。当前默认 `signal-rain-v1`，不是已达成的长篇标杆。v1/v2 仅保留旧档，v2 四类已知问题维持未修状态。

退出条件：

1. 新手与自定义双入口清楚，故事先预览确认；每一步显示当前目标、地点、时间和可行动入口。
2. 三日正常路线、第二日站台/厨房、第一/三日 missed 均能收尾；只有已取得材料进入后记，不把未知输入、等待或普通聊天当作最终选择。
3. 主角档案工作与 NPC 日程共用时钟；回家和睡觉是不同动作，跨日后人物位置、时间与描述一致。
4. 对话阅读/行动/错误恢复方便；取消不提交，刷新/重启/导入不重复世界事件、不串用游标。
5. 在 390×844 实际完成正常与迟到路线，在 320×568 检查长段对白、选项和确认；记录实测阅读时长及不便之处。自动化、HTTP 和浏览器不能互相替代，微信真机、公网 HTTPS 和完整故障矩阵另列。

约 135 句/4,372 汉字/20 步骤是当前工作量，不是质量或时长结论。完整城市模拟、长期生活、多人物个人路线、无限自然语言工具、运行时代码、完整立绘/配音不在当前完成声明中。

### Phase 2：可扩展的生活与路线

Phase 2 在 Phase 1 的验收证据稳定后进行：增加主人公第二类日常职责（例如课程或兼职）、更多可重入的个人路线、例外日程/节假日、可观察的交通投影和更多已注册环境实体。每个新增职责或路线必须有自己的时间表、进入条件、错过后的可继续结果、推荐动作和自动化回放测试；不得先堆文本再补状态模型。NPC 未被玩家激活时仍只更新 `PresenceProjection`/`TravelProjection`，进入兴趣范围才调用角色 Agent。

### Phase 3：长篇世界与模型分层

Phase 3 才扩展到多章节长篇、更多区域和可选高能力世界搭建模型。世界搭建模型只产出可审查的世界圣经、角色目标、公开日程、遭遇和工具声明草稿；人物 Agent 使用快速模型或本地回退，WorldObserver 只做脱敏审计与受限修复提案。长篇内容量、章节数量、真实游玩时长和模型预算在 Phase 2 的试玩数据后另行立项，不能由 Phase 1 的短篇直接推断。

### SDD 追踪与退出规则

Phase 1 默认教程由 MW-28/MW-29（SP-11–14、MW-AC-28/29）、MW-30/MW-31（SP-15/16、MW-AC-30/31）、MW-33（SP-18、MW-AC-33 的阅读与行动收敛）、MW-34（SP-19、MW-AC-34 的横屏优先手机交互）、MW-35（SP-20、MW-AC-35 的阅读/列表/输入衔接）和 MW-36（SP-21、MW-AC-36 的完整游玩/恢复回归）共同验收；MW-32（SP-17、MW-AC-32）单列 v1 旧档支线兼容。signal 代码、自动化和独立浏览器证据齐全后，才能把单人教程标杆的本机范围标为完成，微信真机、公网和完整故障矩阵继续分别验收。Phase 2/3 的需求不得回写成 Phase 1 已完成能力。每次扩写先更新对应 spec/plan/tasks/acceptance，再实现最小纵切片；任何“已完成”状态必须附真实测试命令、事件或快照样例及设备范围。

单人快照增加只读 `interactionHints` 投影：包含 `currentLocation`、由已发布地点图与能力校验得出的 `reachableLocations`，以及当前兴趣范围内的 `presentCharacters`，并关联 `worldVersion`。前端只把这些提示渲染为地点和角色按钮；点击后组装现有移动或询问意图，继续走 `/api/v4/play/intent` 的预览/确认流程。服务端在确认时重新校验版本、在场与可达性，旧提示不能成为越权入口。

前端为故事、行动、确认、取消、恢复和导入维护显式请求状态，例如 `idle/loading/previewing/confirming/cancelling/recovering`。同一操作进行时复用 in-flight Promise 和稳定幂等标识，禁用冲突按钮并保留当前布局；成功或失败后统一释放状态。API 客户端保留稳定错误码，展示层通过穷举映射输出中文消息和恢复动作，未知错误使用中文兜底并记录脱敏诊断，不将后端英文 detail 或堆栈直接插入页面。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET/POST` | `/api/v4/session` | 取得或创建 cookie 所属匿名 world；返回玩家可见快照、资料和模型可用状态，不返回可用于选择其他 world 的权限字段 |
| `POST` | `/api/v4/play/story` | 根据玩家叙述生成只读世界预览；不推进 `worldVersion` |
| `POST` | `/api/v4/play/story/{draftId}/confirm` | 幂等确认故事草稿并初始化玩家资料与初始兴趣范围 |
| `POST` | `/api/v4/play/story/{draftId}/cancel` | 取消未确认故事草稿，不改变正式世界 |
| `POST` | `/api/v4/play/intent` | 将受支持的自然语言转成行动草稿并返回预演 |
| `POST` | `/api/v4/play/intent/{turnId}/confirm` | 幂等提交行动；移动后按新房间刷新兴趣范围 |
| `POST` | `/api/v4/play/intent/{turnId}/cancel` | 取消未确认行动 |
| `GET` | `/api/v4/play/save` | 导出当前 cookie 所属 world 的版本化单人存档 |
| `POST` | `/api/v4/play/save/import` | 校验并导入当前/旧格式到当前 cookie 所属 world；不接受目标 world 参数 |
| `GET` | `/api/v4/world` | 返回玩家可见的当前快照和 `worldVersion` |
| `GET` | `/api/v4/world/clock` | 返回服务端 `WorldClock`、`clockVersion` 和最近投影版本；不接受客户端时间参数 |
| `POST` | `/api/v4/sessions/{sessionId}/interest` | 上报当前 `roomId/zoneId` 和兴趣租约；返回激活/休眠角色、驻留投影和新事件。请求不能修改时钟或角色状态，只能触发 Kernel 计算 |
| `POST` | `/api/v4/sessions/{sessionId}/heartbeat` | 延长兴趣/激活租约；重复请求幂等，不重复触发 encounter |
| `POST` | `/api/v4/turns` | 提交玩家意图，返回 `turnId` 和提案状态 |
| `POST` | `/api/v4/turns/{turnId}/confirm` | 幂等确认草稿并触发原子结算 |
| `POST` | `/api/v4/turns/{turnId}/cancel` | 取消未提交回合 |
| `GET` | `/api/v4/events?after=` | 补拉可见事件，支持断线重连和重放 |
| `GET` | `/api/v4/events/stream` | SSE 实时推送可见事件 |
| `POST` | `/internal/v4/world/tick` | 受保护的后台节拍；推进时钟和驻留投影，不接受玩家或模型身份 |
| `GET` | `/internal/v4/audits?after=` | 受保护的观察者审计流；不向普通客户端暴露角色私密上下文 |
| `GET` | `/healthz` | 返回服务和 schema 版本，不泄露密钥/策略原文 |

所有命令带 session、幂等键和期望版本；异常返回可分类的 `409`、`422`、`429` 或 `503`，前端按类型提示或本地回退。

## 迁移与兼容

### 兼容层

当前 `hex/server/shared` Node 运行时暂时保留为 `legacy-v2` provider。Python Kernel 提供事件转换器，把现有夜场剧本映射成标准 `turn/proposal/event`，允许在不改变前端玩法的情况下逐幕切换。每次切换记录 schema、resolver 和 provider 版本。

### 存档迁移

1. 读取旧 `voodoo-hex-v5` 或单娃娃存档，先做只读校验和备份。
2. 创建 `PLAYER_DOLL` Agent 和 `YOU` 实体，迁移房间、头像、已确认事实和可见关系；旧单目标转换为一个稳定 `targetSetId`。
3. A/B/C 映射为长期槽位；旧临时人物映射 Z，并不自动成为长期角色。
4. `worldVersion=0` 写入迁移事件；失败时保留旧档并继续 legacy-v2。
5. 新世界确认一次可重放后，再标记 migration complete；迁移过程不删除旧 key。

## 测试策略

- 契约测试：OpenAPI、JSON Schema、事件枚举、未知 id/越权 actor 全部拒绝。
- Kernel 单元测试：能力、可见性、CAS、幂等、事务回滚、关系范围和回放。
- Adapter 合同测试：local/Pi/DeepSeek/Claude 返回同一结构；超时、429、非法 JSON 一律 fallback。
- FastAPI 集成测试：命令、SSE 重连、私密事件隔离、健康检查和旧存档迁移。
- 单人预发布集成测试：双 cookie 隔离、伪造 world 无效、故事/行动预览确认取消、回执幂等、移动后兴趣范围、SQLite 重启、导入导出、同源静态白名单、Origin/体积限制和内部令牌；快照中的当前地点、可达地点和在场角色提示必须来自服务端权威状态。
- 生命周期测试：伪造客户端时钟被拒绝；重叠时间表按固定优先级解析；未激活角色不调用模型；进入/离开兴趣范围只产生一次激活和可释放租约；迟到心跳、重连和重复 interest 不重复 encounter。
- 观察者测试：位置越界、时间表冲突、未知关系和过期租约触发可重放 audit；模型修复提案不能绕过 Kernel，观察者不可用不阻塞正常回合。
- 前端测试：事件 reducer、断线补拉、移动尺寸、重复事件不重演；分别注入旧版、截断和字段损坏的本地缓存，页面仍可挂载并恢复；验证地点/角色按钮进入预览流程、请求中状态与防重复提交，以及代表性 409/422/429/503/网络错误的中文提示。不清理真实玩家存档。
- 阅读衔接专项：MW-35 记录长句先滚动后换句、滑动不误跳、多选提示/翻动不提交、中文组合/Enter repeat 防误发送与面板/预览/取消焦点；以句索引、滚动尺寸和请求计数验证，不仅比较截图。真实触摸和输入法另列待测。
- 手工矩阵：横屏 844×390、667×375、568×320 与竖屏 390×844 为 MW-34 专项；此前桌面 320/390/430px 为历史范围。横竖切换、面板内滚动、输入/pending 保留和软键盘代理分别记录；iOS/Android 微信真实方向/安全区/输入法、普通浏览器、断网/重连和服务器外访问另记，不互相替代。

## 发布顺序与回滚

先部署 Python Kernel 的只读 `/world` 和本地 fallback，再启用单回合命令，最后打开模型 Adapter。每一步保留 legacy-v2 开关；检测到 schema 不兼容、事件无法回放、SSE 重连丢事件或迁移校验失败时，切回 Node 只读/演出路径，旧存档和事件不删除。公网部署只有在外部 HTTP、资源、健康检查和回滚演练都有证据后才可声称完成。

生命周期发布顺序：先只读暴露 `WorldClock` 与驻留投影，再启用 interest/heartbeat 租约，最后打开激活 Agent 和随机遭遇。任一步出现时钟漂移、租约泄漏、重复 encounter 或投影无法回放，关闭激活入口并保留只读时间表；不删除已记录的事件和旧存档。
