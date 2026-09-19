# 2026-09-19 · 开源源码下载与复用审计

## 范围与方法

本审计服务于 004 的 World Kernel、事件回放、前端传输和声明式工具边界。审计要求是**实际下载并阅读源码**，不是根据 README、博客或包介绍做结论。下载副本仅放在 `/tmp`，不写入项目运行时、不新增依赖、不复制第三方文件。

下载优先使用 `git clone --depth 1`；网络不稳定时使用 codeload 的固定提交 tarball，或在已有固定 SHA 时拉取指定 raw 源文件。每个条目记录固定提交、适用的产物校验值、仓库内许可证正文和实际查看的源文件。任何将来复制或 vendor 代码的变更，仍须单独保留 LICENSE/NOTICE、版权声明、精确来源提交和本项目改动说明。

## 已下载核对

| 仓库 | 下载产物与固定来源 | 已核对版本 | 仓库许可证 | 实际核对的源代码 | 可以借鉴/复用的边界 |
| --- | --- | --- | --- | --- | --- |
| [boardgame.io](https://github.com/boardgameio/boardgame.io) | `/tmp/voodoo-boardgame-source.tgz`；codeload 固定提交包 | `5e9a2c94bde803fae8b081958c406c4d0a7be8ae`；SHA-256 `1c4a438804253d83fe3ba99da4ef185bb0d0df0cf96c2471ded2e17629ec6416`；包内 `package.json` 为 `0.50.2` | 包内 `LICENSE` 是 MIT，版权为 `Copyright (c) 2017 The boardgame.io Authors.`；若复制实质性源码，必须保留该版权和许可证全文 | `src/core/reducer.ts`、`src/master/master.ts`，以及根目录 `LICENSE`、`package.json` | **借鉴，不 vendor。** 可借鉴：服务端检查动作类型、玩家资格和状态版本；状态提交与 delta log 同步；客户端只消费服务器结果。不能直接复用：该代码是 TypeScript/Redux/游戏回合框架，耦合 game flow、plugins、storage/transport API，与 Python World Kernel 的事件、隐私和多 Agent 生命周期不兼容。 |
| [LangGraph Python](https://github.com/langchain-ai/langgraph) | `/tmp/voodoo-langgraph-audit-20260920`；固定 tag 的 Git 工作树 | tag `1.2.11`，提交 `644815f9e5bc52ad8f7a5227a456227e9c3e639b`；`LICENSE` SHA-256 `d9bb52f2e3540d60ff50d8f0f5b6ba649b7fd346948c4c3d086c8afb120763c7` | 根目录 `LICENSE` 是 MIT，版权为 `Copyright (c) 2024 LangChain, Inc.`；`libs/langgraph/pyproject.toml` 同时声明 `license = "MIT"` | `libs/langgraph/pyproject.toml`、`libs/checkpoint/langgraph/checkpoint/base/__init__.py`、`libs/langgraph/langgraph/types.py`、`libs/langgraph/langgraph/pregel/_loop.py` | **候选 Adapter，暂不加入依赖。** 可借鉴 checkpoint、`thread_id`、父 checkpoint、pending writes、interrupt/resume 和超时边界，用于世界搭建、观察者修复提案等低频持久流程。不能用于普通 NPC 热路径，也不能持有世界权威状态。版本要求 Python `>=3.10`，当前项目声明 Python `>=3.9`。 |
| Colyseus | 已尝试固定 SHA `2ee699b70262432a359103ec802f249f134253eb` 的 raw `LICENSE` 和 `packages/core/src/Room.ts`；请求超时，未留下可读文件 | 固定 SHA 来源已知，但未下载到可读源码；无本地文件校验值 | 未取得仓库 LICENSE 正文 | 无；不能声称已核对 | 不复用代码。此前 Room/tick/reconnect 结论仍需源码和许可证核对。 |
| 待下载完成：MCP TypeScript SDK | 原尝试目录 `/tmp/voodoo-audit-mcp-1510`；未保留完整工作树 | 未取得 HEAD | 未取得仓库 LICENSE 正文 | 无；不能声称已核对 | 不复用代码；schema-first 工具契约仍为本项目设计原则，不把 SDK 直接嵌入 World Kernel。 |

### boardgame.io 实际源码结论

本次只下载和读取源文件，没有安装依赖、执行 `pnpm`、执行上游构建或测试脚本。固定提交压缩包内的 `LICENSE` 明确为 MIT；它允许复制和修改，但要求在软件的副本或实质部分保留版权与许可文本。因此许可证本身不阻止受控复用，但不会解除本项目的架构和安全约束。

`src/core/reducer.ts` 的 `CreateGameReducer` 在服务端处理 `GAME_EVENT` 时拒绝客户端计算的事件；`MAKE_MOVE` 路径先校验动作是否在当前 flow 中可用、游戏是否结束、玩家是否活跃，再运行 move，并在服务端产生 `deltalog`、递增 `_stateID`。这与本项目的“命令 → Kernel 校验 → 原子事件 → cursor 补拉”方向一致。可借鉴的是**先验证再写入、状态版本递增、以日志表达增量**，不应复制 reducer 或把 Redux 状态作为世界权威。

`src/master/master.ts` 的 `onUpdate` 在读取状态后校验公开动作类型、认证凭据、允许的事件、玩家活跃资格、合法 move 和客户端提交的 `stateID`；通过后才 dispatch、广播 patch/update，并把无瞬态的状态和 `deltalog` 写入 storage。这个顺序可作为 FastAPI 边界的审计清单：请求认证/控制权、能力范围、版本/CAS、事务写入和展示事件分离。它不能直接解决本项目的角色 private memory、doll_private、模型迟到结果或 interest lease，因此仍须由 World Kernel 保持权威。

### LangGraph Python 实际源码结论

固定 tag `1.2.11` 与提交 `644815f9e5bc52ad8f7a5227a456227e9c3e639b` 一致。`libs/langgraph/pyproject.toml` 的版本为 `1.2.11`，要求 Python `>=3.10`，而本项目 `backend/pyproject.toml` 仍声明 Python `>=3.9`，README 也以 Python 3.9+ 为基线。因此本轮不增加 LangGraph 依赖，也不为引入框架提前抬高整个 Kernel 的 Python 基线。

`BaseCheckpointSaver` 明确用 `thread_id` 作为保存和恢复 checkpoint 的主键；实现还保存 `checkpoint_id`、父 checkpoint 和 `pending_writes`，适合承载可暂停、可恢复的世界搭建或观察者提案流程。但这些 checkpoint 只能记录工作流进度，最终定义和运行态仍必须通过 World Kernel 的版本、权限、CAS 和事件事务提交。

`interrupt()` 的源码文档明确说明：恢复会从节点起点重新执行该节点的全部逻辑。因此节点内的模型调用、文件/网络操作或 Kernel 写入不能假定只执行一次；任何外部副作用必须通过幂等键、草稿隔离和确认事务保护。这个恢复语义使 LangGraph 适合低频、可审阅的世界搭建与修复工作流，不适合作为每个角色进入兴趣范围后的普通快速回合调度器。

### 下载受阻记录

- 2026-09-19：最初对 Colyseus、boardgame.io 与 MCP TypeScript SDK 执行 `git clone --depth 1`。网络在 Git 对象下载阶段无稳定进展，未得到可读工作树；这些尝试不能作为源码核对证据。
- 发现可用的 codeload 入口后，已成功获取并核对 boardgame.io 的固定提交 tarball。随后以固定 SHA 请求 Colyseus 的 `LICENSE` 和 `Room.ts`，每个请求最多 30 秒，但 raw 入口超时且无文件落盘；Colyseus 与 MCP 仍保持“不可复用”。

## 复用准入规则

外部代码只有同时满足以下条件，才可以提出复用变更：

1. 来源可复现到精确 Git 提交 SHA。Git clone 使用远端与本地 `HEAD` 一致性核验；tarball/raw 下载记录固定 SHA、来源 URL 和本地文件 SHA-256，不能误写为“本地 HEAD 一致”。
2. 已阅读仓库内 LICENSE，确认许可证允许预期的复制、修改和随产品分发方式；需要 NOTICE 或版权保留时一并记录。
3. 具体模块有清晰、窄的适配边界：不持有本项目世界权威状态，不绕开 World Kernel，不读取模型密钥，也不将用户输入作为可执行代码。
4. 复制后的文件放入 `third_party/<来源>/` 或通过受控依赖引入；随文件保留原始版权头、LICENSE/NOTICE、来源 URL、SHA 和本项目补丁说明。
5. 通过本项目事件回放、权限、隐私和失败原子性测试。许可证允许不等于运行时边界安全。

## 与当前实现的关系

当前优先沿用项目自有的 Python `EventStore`、`WorldKernel`、`OperationQueue`、ToolCompiler 与固定 resolver。它们已经围绕本项目的事件版本、可见性和服务端权威边界建立；即使后续确认第三方采用 MIT 等宽松许可证，也不能直接替换或复制其 Room、reducer、网络会话或存储层。

可以从开源项目吸收的应是可验证的结构性做法：有序输入与幂等、服务端权威状态、稳定事件日志、断线 cursor、声明式能力与测试隔离。实际代码复用必须经上述下载与许可证流程另行决定。

## 待补的实际核对表

| 候选仓库 | 预期核对文件 | 需要回答的问题 |
| --- | --- | --- |
| Colyseus | `LICENSE`、`packages/core/src/Room.ts` | 是否为 MIT；Room、tick、patch、重连逻辑是否可只作为传输层参考而不进入 Kernel。 |
| AI Town | `LICENSE`、simulation engine、输入 generation 相关源码 | 是否许可满足；其 Convex 耦合是否排除直接复用，仅保留 generation fence 的设计参考。 |
