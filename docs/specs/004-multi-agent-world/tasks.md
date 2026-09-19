# 004 任务清单 · 多 Agent 世界内核迁移

状态：M0/M1 进行中，Python 103/103、Node 79/79，TypeScript 类型检查及 Hex 构建通过。本机单人预发布候选已收口；世界草稿的实体/公开日程/遭遇同批确认和并发/取消/重启已有验收；匿名单人闭环、HTTP 写入保护、管理接口令牌与同源静态入口已有自动化，MW-22/23/25/26/27 仍为部分完成。MW-27 的 SP-07–10 已完成代码与 Chrome 390×844 增量验收，包括损坏缓存恢复、快捷行动、11 地点精确移动、防重复、中文错误、离线存档往返、本机进度保护、故事预览恢复、坏导入恢复、确认响应丢失恢复和操作锁。观察者报告已持久化去重，完整不变量/修复仍待完成。每项任务须同时有代码、测试和验收证据，见[世界搭建记录](../../evidence/2026-09-19-world-builder-verification.md)和[单人预发布记录](../../evidence/2026-09-19-single-player-prerelease.md)；不能以迁移表述覆盖 002/003 的未完成项。

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
| MW-23 | 实现 primitive tool registry 与实体 affordance | WL-09 | MW-AC-23 | MW-05, MW-07, MW-22 | 部分完成：固定 primitive、JSON Schema、room/zone、类型/动作/路线校验已有；定义与可变状态分离、完整运行时契约待补 |
| MW-24 | 实现车辆、地铁、自行车 mobility resolver 与无人观察时的 TravelProjection | WL-03, WL-09 | MW-AC-24 | MW-18, MW-19, MW-23 | 部分完成：车辆/自行车和地铁状态机、路线/站点校验、ENV feedback 已回归；班次、跨重启回放、途中物化、坐标和后台到达投影待补 |
| MW-25 | 实现世界搭建 ToolCompiler | WL-08, WL-09 | MW-AC-25 | MW-20, MW-22, MW-23 | 部分完成：compiler-2 对实体/日程/遭遇逐层校验，预览、哈希复核、引用与类型检查已有；新房间/角色、例外日程、可达性与组合动作预演待补 |
| MW-26 | 完成工具提案、失败原子性、重放和 ENV fallback 验收 | WL-09 | MW-AC-26 | MW-23, MW-24, MW-25 | 部分完成：声明非法、CAS、存储失败、跨连接取消/确认、重启幂等、拒绝审计已有；mobility 跨重启回放、完整工具失败矩阵、持久 worker 待补 |
| MW-27 | 打通匿名单人预发布闭环、启动恢复与行动可发现性 | SP-01–10 | MW-AC-27 | MW-03, MW-04, MW-12, MW-13, MW-19, MW-22 | 部分完成（本机单人预发布候选已收口，证据更新至 2026-09-20）：cookie 到独立 world 的 SQLite 映射、跨会话草稿隔离、故事/行动 preview-confirm-cancel、持久幂等回执、移动后兴趣范围、重启恢复、当前/旧格式导入导出、Origin/请求体限制、管理接口令牌、静态敏感路径拒绝、TS 单人界面及同源构建入口已有自动化；320×568、390×844、430×932 基础闭环通过。SP-07–10 已在 Chrome 390×844 验证旧/损坏缓存不白屏、当前/可达地点与在场角色快捷行动、11 地点精确移动、取消无副作用、请求状态与防重复、中文错误、离线导出到在线导入、坏导入恢复、确认响应丢失恢复和导出输入保护。完整会话越权矩阵、生产配置、微信 iOS/Android 真机、公网/HTTPS 和内容丰富度仍待最终验收。证据见 `docs/evidence/2026-09-19-single-player-prerelease.md` |

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

## 依赖阶段

`MW-01 -> MW-02/MW-03 -> MW-04 -> MW-05/MW-06 -> MW-07 -> MW-08 -> MW-09 -> MW-10/MW-11 -> MW-12/MW-13 -> MW-14/MW-15 -> MW-17 -> MW-18 -> MW-19 -> MW-20/MW-21 -> MW-22 -> MW-23 -> MW-24/MW-25 -> MW-26 -> MW-27 -> MW-16`。

Node legacy-v2 在 MW-12 之前必须可启动；MW-16 之前不得删除。任何阶段失败都应能恢复旧存档并回滚到上一个事件 schema。
