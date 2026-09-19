# 004 技术方案 · TypeScript 前端与 Python 多 Agent 世界内核

状态：Python 103/103、Node 79/79，TypeScript 类型检查及 Hex 构建通过；本机单人预发布候选已收口。时钟/日程/激活、固定工具、同步提案 generation fence、遭遇选择、匿名单人闭环、HTTP 写入保护、管理接口令牌与同源静态入口已有路径。ToolCompiler 支持实体/公开日程/遭遇同批校验、原子确认、跨连接取消/重试；MW-22/23/25/26/27 保持部分完成。SP-07–10 的损坏缓存恢复、行动可发现性、请求防重复、中文产品错误、本机进度保护和故事预览恢复已完成代码与 Chrome 390×844 增量验收；离线保存往返、坏导入恢复、确认响应丢失恢复和导出输入保护均已实际走通。新房间/角色、例外日程、职责模型路由、观察者完整不变量/修复、完整发布边界、微信真机和公网发布待补。详见[世界搭建验证](../../evidence/2026-09-19-world-builder-verification.md)和[单人预发布验证](../../evidence/2026-09-19-single-player-prerelease.md)。

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

前端 `hex/play.ts` 通过同源 `PlayApiClient` 使用 cookie，会在网络不可用时保留本地规则试玩。生产入口由 FastAPI 明确挂载 `dist-hex/index.html` 和构建资产；源目录、任意文件路径和目录列表不可访问。写接口由统一 middleware 限制请求体并检查 `Origin`，内部接口通过 `WORLD_ADMIN_TOKEN` 隔离。该生产边界必须经 HTTP 测试后才能从“待验证”改为“通过”。

启动恢复采用“先渲染壳层，再读取非权威缓存，最后拉取服务端会话”的顺序。本地状态读取放在异常边界内，按 schema/version 校验；受支持旧 key 只生成迁移预览，不自动覆盖当前 world，损坏记录按 key 隔离并保留诊断摘要。任何解析或迁移失败都必须收敛到服务端快照或首次进入状态，不能阻止页面挂载、导航和重试。

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
- 手工矩阵：桌面 320/390/430px、iOS/Android 微信、普通浏览器、断网/重连、服务器外访问分别记录。

## 发布顺序与回滚

先部署 Python Kernel 的只读 `/world` 和本地 fallback，再启用单回合命令，最后打开模型 Adapter。每一步保留 legacy-v2 开关；检测到 schema 不兼容、事件无法回放、SSE 重连丢事件或迁移校验失败时，切回 Node 只读/演出路径，旧存档和事件不删除。公网部署只有在外部 HTTP、资源、健康检查和回滚演练都有证据后才可声称完成。

生命周期发布顺序：先只读暴露 `WorldClock` 与驻留投影，再启用 interest/heartbeat 租约，最后打开激活 Agent 和随机遭遇。任一步出现时钟漂移、租约泄漏、重复 encounter 或投影无法回放，关闭激活入口并保留只读时间表；不删除已记录的事件和旧存档。
