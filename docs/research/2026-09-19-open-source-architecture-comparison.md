# 2026-09-19 · 开源项目架构对比

## 目的

核对 004 的 TypeScript 前端、Python World Kernel、按需激活和 ToolCompiler 分层是否符合已有开源项目的成熟做法。重点比较游戏状态权威、时间推进、事件回放、Agent 工作流、记忆和工具契约，不把第三方项目直接当成依赖引入。

## 对比结果

| 项目 | 已验证的设计 | 对本项目的启示 | 是否直接采用 |
| --- | --- | --- | --- |
| [AI Town](https://github.com/a16z-infra/ai-town) | TypeScript + Convex；独立 simulation engine；输入进入队列后按固定 step 批量处理；`generationNumber` 防止并发覆盖；世界可按不活跃状态停止；Agent 的对话、记忆和归档数据分开保存 | 需要明确输入队列、生成号/CAS、世界休眠和记忆归档；不需要照搬 16ms 连续 tick | 借鉴机制，不引入 Convex |
| [Colyseus](https://github.com/colyseus/colyseus) | Node.js 权威多人框架；Room 持有服务端状态；状态增量同步、重连、固定/可变 tick 和补丁频率分离 | SSE/HTTP 足够支撑当前单玩家叙事；将来多人实时场景可替换传输层，不能把客户端状态当权威 | 暂不引入，保留兼容可能 |
| [boardgame.io](https://github.com/boardgameio/boardgame.io) | 用纯函数描述状态变化；自动提供多人同步、存储、日志和 time travel | 微回合应继续是“命令 -> 校验 -> reducer -> 事件”，回放测试可以采用类似 reducer 思路 | 借鉴事件/reducer 语义 |
| [LangGraph](https://github.com/langchain-ai/langgraph) | 面向长流程 Agent 的 durable execution、human-in-the-loop、短期/长期 memory 和恢复 | 世界搭建、观察者修复提案和复杂编剧可以作为持久工作流；不能让 LLM 工作流直接成为世界状态所有者 | 作为可选 Adapter/工作流实现 |
| [Bevy](https://github.com/bevyengine/bevy) | 数据驱动 ECS；实体、组件、系统分离；模块化、可替换 | 需要把实体定义、可变状态和 resolver 输入分开；当前规模不需要引入完整 ECS 引擎 | 采用 ECS 思想，不引入 Rust 引擎 |
| [Nakama](https://github.com/heroiclabs/nakama) | 单一游戏服务提供认证、存储、社交、实时和自定义服务端逻辑，外接 PostgreSQL/CockroachDB | 证明“模块化单体 + 权威服务”适合游戏；但它的社交/多人平台范围超过当前需求 | 作为未来部署平台备选 |
| [MCP](https://github.com/modelcontextprotocol/modelcontextprotocol) | 工具协议和 schema 以 TypeScript 为源，可提供 JSON Schema；工具能力由协议描述 | ToolCompiler 应继续采用 schema-first 的声明式工具；模型只能提交结构化参数，不能生成可执行代码 | 借鉴契约原则，不直接暴露任意 MCP 工具 |

## 对当前分层的判断

当前的“TypeScript/Pixi 前端 -> FastAPI API -> Python World Kernel -> Resolver/Agent Adapter -> Event Store”主链是合理的。它同时符合 Colyseus/Nakama 的权威服务原则、boardgame.io 的 reducer/replay 原则和 AI Town 的持久模拟引擎原则。当前没有证据要求把后端改成纯 TS 或把所有状态移动到浏览器。

需要补强的边界有六项：

1. **输入队列与生成号。** 每个玩家意图先进入有序输入队列，Kernel 按 `generation`/`expectedVersion` 原子消费；模型迟到只能提交过期结果，不能覆盖新状态。AI Town 的 `processedInputNumber` 与 `generationNumber` 是可参考的具体做法。
2. **定义与运行态分离。** `PublishedRegistry` 保存房间、角色、实体、能力和时间表定义；运行态单独保存位置、灯光、车辆状态、关系和租约。快照可以合并读取，但写入边界不能混合。
3. **模拟事件与展示事件分离。** `tool_committed`、`relationship_changed`、`presence_projected` 是权威领域事件；对前端发送的台词、动画、音效是派生的 presentation events。回放先还原领域状态，再按固定 renderer 生成舞台事件。
4. **Agent 工作流持久化。** 世界搭建、复杂遭遇和观察者修复提案需要 `workflow_id`、checkpoint、取消、超时和人工确认；普通角色回合仍走轻量 Adapter，不强制引入 LangGraph。
5. **传输与 Kernel 解耦。** 首版继续 HTTP + SSE；客户端断线依靠 `afterEventId` 补拉。只有确认需要多人同房间低延迟同步时，才评估 Colyseus/WebSocket，不改变命令、事件和回放合同。
6. **记忆分层和预算。** 角色记忆至少分为当前回合 working memory、事件摘要 episodic memory 和稳定角色事实 semantic memory。向量检索只能提供候选，最终可见性和事实仍由 Kernel 过滤；每个 Agent 调用要记录预算、超时、来源和 fallback。

## 推荐运行时结构

```text
Command API / SSE
  -> Input Queue + Idempotency
  -> World Kernel transaction
       -> Published Registry (immutable definitions)
       -> Runtime State (mutable projections)
       -> Deterministic Resolvers
       -> Agent Adapter proposals
       -> Domain Event Store + Snapshot
       -> Presentation Event Reducer
  -> TypeScript/Pixi scene
```

世界时间使用惰性投影和受保护 tick，不按现实每秒调用角色模型。角色保持 `dormant/staged`，进入兴趣范围才取得激活租约；离开后保存摘要并释放租约。需要持续移动的场景可以在单独的 simulation worker 使用固定步长，叙事 Agent 仍只在事件边界唤醒。

## 结论

现有架构方向正确，应该做“边界收紧”和“事件/工作流补齐”，不应该做整体重写。近期优先级是：

1. 拆分不可变 Registry 与可变 Runtime State。
2. 把输入队列、generation、幂等和失败回放做成统一 Kernel 原语。
3. 完成 mobility resolver、观察者审计和世界搭建持久工作流。
4. 让前端只消费 presentation events，并完成断线补拉。
5. 只有在真实多人/低延迟需求出现后，再引入 Colyseus/Nakama 类实时基础设施。

这些项目提供的是可验证的模式，而不是必须照搬的框架；当前 Python 模块化单体仍是实现成本和迁移风险最低的落点。

## 复用与许可证核对

本轮只把源码下载/核对作为架构和许可证审计，不把第三方仓库直接复制进运行时。核对记录如下：

| 仓库 | 核对的远端提交 | 许可证结论 | 本项目处理 |
| --- | --- | --- | --- |
| AI Town | `8e05997f2409275669c8344b84a51692e83f3f33`（`git ls-remote`） | 本轮网络超时，未取得仓库许可证正文 | 只引用 simulation engine 的设计，不复制源码、不新增依赖 |
| Colyseus | `2ee699b70262432a359103ec802f249f134253eb`（`git ls-remote`） | 远端 `LICENSE` 为 MIT | 只参考 Room/tick/reconnect 边界；当前 HTTP + SSE 不引入运行时 |
| boardgame.io | `5e9a2c94bde803fae8b081958c406c4d0a7be8ae`（`git ls-remote`） | 远端 `LICENSE` 为 MIT | 只参考 reducer/time-travel 语义；Kernel 继续使用本项目事件模型 |
| LangGraph JS | `ec67d5d70dc26341e92a0962d9d2f4018c310b39`（`git ls-remote`） | 本轮未取得许可证正文 | 仅作为可选 Agent Adapter/持久工作流候选，不加入依赖 |

后续实际下载已完成 boardgame.io 固定提交源码和 MIT 许可证正文，详见[源码复用审计](2026-09-19-source-reuse-audit.md)。它的 reducer/master 与 TypeScript、Redux、game flow 和存储传输接口耦合，未选为 Python 运行时依赖；以上表格保留首次核对事实，后续证据以新审计为准。本轮没有 vendor 第三方业务代码，OperationQueue、ToolCompiler 和 mobility resolver 仍为自有实现；实际引入代码时保留来源提交、LICENSE/NOTICE 和改动说明。

2026-09-20 又实际下载并核对了 LangGraph Python tag `1.2.11`（提交 `644815f9e5bc52ad8f7a5227a456227e9c3e639b`）。其根许可证为 MIT，checkpoint 以 `thread_id`、`checkpoint_id`、父 checkpoint 和 pending writes 支持恢复；`interrupt` 恢复会从节点起点重新执行，因此外部副作用必须幂等。该版本要求 Python `>=3.10`，而本项目仍兼容 Python `>=3.9`，当前不加入依赖。未来若采用，只放在世界搭建或 WorldObserver 的持久工作流 Adapter，不能进入普通 NPC 热路径或替代权威 World Kernel。完整文件与校验值见[源码复用审计](2026-09-19-source-reuse-audit.md)。

## 参考源码位置

- AI Town simulation engine：[convex/engine/abstractGame.ts](https://github.com/a16z-infra/ai-town/blob/main/convex/engine/abstractGame.ts)
- AI Town 游戏状态与归档表：[convex/aiTown/schema.ts](https://github.com/a16z-infra/ai-town/blob/main/convex/aiTown/schema.ts)
- AI Town 角色工作与记忆：[convex/aiTown/agent.ts](https://github.com/a16z-infra/ai-town/blob/main/convex/aiTown/agent.ts)、[convex/agent/memory.ts](https://github.com/a16z-infra/ai-town/blob/main/convex/agent/memory.ts)
- Colyseus Room 状态、tick、patch 和重连：[packages/core/src/Room.ts](https://github.com/colyseus/colyseus/blob/master/packages/core/src/Room.ts)
- LangGraph 持久执行与 memory 概览：[README](https://github.com/langchain-ai/langgraph#why-use-langgraph)
- Bevy 数据驱动与模块化目标：[README](https://github.com/bevyengine/bevy#design-goals)
- boardgame.io 状态、多人和 time travel：[README](https://github.com/boardgameio/boardgame.io#boardgameio)
- Nakama 服务、存储和实时能力：[README](https://github.com/heroiclabs/nakama#features)
- MCP schema-first 工具协议：[README](https://github.com/modelcontextprotocol/modelcontextprotocol)
