# 0006 · Python World Kernel 与 Agent Adapter 架构

日期：2026-09-18（Asia/Shanghai）
状态：**用户已确认方向；M1 领域层与本机 HTTP 已实现，后续迁移进行中**

## 背景

当前仓库同时存在根目录单娃娃原型和 `hex/server/shared` 的 Node 夜场原型。Node/Pi 运行时已经证明了角色分别调用、模型失败回退和部分事件编排可以工作，但它不是长期世界状态的稳定边界：角色可见性、事件重放、事务结算、跨语言契约和旧档迁移还没有统一内核。

用户确认将整个项目按 SDD 方式推进，采用 TypeScript 前端、Python 后端，并先构建一个可模拟真实关系的多 Agent 世界，再叠加诅咒、施法、摆件和成人表现层。

## 决定

1. **Python FastAPI World Kernel 是世界状态唯一权威。** 它负责角色/实体注册、能力和可见性校验、微回合调度、关系与记忆事务、CAS、幂等、事件日志、快照和重放。前端、模型和 Agent 框架不能直接写世界状态。
2. **前端迁移到 TypeScript。** 继续以手机/微信 H5 为第一目标，当前 PixiJS 像素舞台可以保留；前端只发送意图、展示服务端可见事件并维护短期渲染缓存。
3. **Agent 框架通过 Adapter 接入。** local fallback、Pi、DeepSeek、Claude 等都实现同一结构化提案接口。它们可以生成意图解释、台词和回应提案，但没有文件、Shell、网络或任意数据库工具权限，也不是世界状态所有者。
4. **`PLAYER_DOLL` 与 `YOU` 共用一个执行 Agent。** `DOLL` 是巫毒媒介和玩家输入的解释者，`YOU` 是它控制的世界实体；`YOU` 不再有独立模型会话。玩家可以让 `YOU` 观察、移动、说话、邀请、询问、施压和使用注册物件，但不能直接命令 A–Y 或 Z。
5. **A–Y 是独立长期人物槽位。** 每名已注册人物拥有自己的目标、立场、记忆、发起/接受能力和可见性；A/B/C 是当前主要人物。Z 是可复用的临时人物 Agent 槽位，默认只有短期记忆，不自动进入长期目标集合。
6. **ENV 是规则反馈 Agent/Resolver，不是有个人意志的人物。** 它校验物件动作并反馈天气、灯光、声音、门和其他可观察现象；不得代替 A–Y/Z 说话、决定立场或创造未确认事实。

## YOU/DOLL 表述变更

本决策**覆盖 [0002 · 玩家、娃娃与角色的 agent 划分](0002-agent-split.md) 中“娃娃与玩家身体分开为两个 agent”的实现建议**。0002 对“玩家角色不是独立 Agent”和“娃娃拥有执行边界”的判断继续有效；变更仅是将 `DOLL` 的建议/解释与 `YOU` 的行动执行收束为一个逻辑 Agent ID `PLAYER_DOLL`，不再为娃娃和 YOU 建立两个模型会话。

因此，以下旧描述只作为历史记录，不作为 004 的实现要求：

> 娃娃是独立 agent，玩家角色身体由另一个执行通道承载，玩家可在建议后单独采纳。

004 的当前行为是：玩家输入先交给 `PLAYER_DOLL`，它可以在同一回合给出解释、建议和 `YOU` 行动提案；Kernel 只批准合法的 `YOU` 行动。玩家仍然拥有发起权，A–Y/Z 仍拥有自主回应权。

## 对质语义

玩家说“让 A 和 B 当面对质”不代表玩家获得 A 或 B 的控制权。Kernel 将其解析为 `YOU` 在同一房间内邀请、询问或施压 A/B 的公开行动；A/B 各自读取可见上下文并决定 `answer`、`deny`、`lie`、`counter`、`silence`、`leave` 或 `refuse`。系统禁止产生由玩家直接提交的 `actor=A, action=confront, target=B` 权威事件。

## 迁移顺序

- M0：冻结 OpenAPI、JSON Schema、能力、可见性和事件回放格式，保留 Node legacy-v2。
- M1：并行启动 FastAPI Kernel、SQLite event store、确定性 ENV 和 local Agent Adapter。已完成领域层、HTTP 路由、能力校验和 `hex/world-api.ts` opt-in 边界；完整迁移仍未完成。
- M2：将 v5/003/单娃娃存档迁移为 `PLAYER_DOLL`、`YOU`、稳定角色槽位和可重放事件；失败可切回旧 key。
- M3：接入 A/B/C/Z 的独立上下文、记忆和微回合，验证公开/私密隔离和原子结算。
- M4：TypeScript 前端切换到命令 + SSE 事件 reducer；无模型和断网路径继续可玩。
- M5：按 Adapter 接入 Pi/DeepSeek/Claude 及 003 的关系、多目标、策略 gate 和 SFW fallback。
- M6：完成桌面、微信真机、公网、断网、回滚的独立验收后，才考虑移除 legacy-v2。

## 相关文档

- [004 多 Agent 世界规格](../specs/004-multi-agent-world/spec.md)
- [004 技术方案](../specs/004-multi-agent-world/plan.md)
- [004 任务清单](../specs/004-multi-agent-world/tasks.md)
- [004 验收清单](../specs/004-multi-agent-world/acceptance.md)
- [0002 旧划分记录](0002-agent-split.md)
- [0003 环境边界](0003-environment-agent.md)
- [0004 运行时选型](0004-agent-runtime-selection.md)
