# 2026-09-21 · 多 Agent 世界实际接入状态

用户追问整体架构是否完成、每个角色是否已有独立生命。本轮对默认 Python 单人入口做调用链核查，校正 MW-10/14/19/21/22 的接入描述；不新增产品行为、不读取模型凭证、不操作玩家存档。基线提交为 `d33e2a7`。

结论：TypeScript 前端、Python 权威世界内核与 SQLite 的主要分层已经落地，可以承载当前单人教程。独立角色数据、日程、感知范围和可见事件记忆已有；自主目标、角色之间的持续互动、职责模型路由与观察者纠偏尚未形成完整产品闭环。当前教程主要是预写剧情与规则驱动，不能称为多个模型共同创作的自主世界。

## 代码事实

| 能力 | 实际状态 | 依据 |
| --- | --- | --- |
| 单人入口与世界提交 | API → 会话世界 → 行动预览/确认 → Kernel 校验 → 事件/快照/记忆原子写入。模型只能提案，不直接改世界 | `backend/app/api/app.py`、`sessions.py`、`gameplay.py`、`domain/world.py` |
| 统一时间与工作表 | 默认逻辑时间每真实分钟推进一游戏分钟，确认行动还会增加耗时；在会话、兴趣更新和行动处理时惰性结算。教程有真实日程窗口和错过分支；当前前端不持续轮询，也没有常驻生产后台节拍 | `world/clock.py`、`world/schedule.py`、`domain/world.py:499`、`signal_story.py:60` |
| 待机与唤醒 | 房间/区域兴趣租约控制 active/dormant，离开或到期保留生命周期 checkpoint。唤醒只产生状态/遭遇记录，不会自动调用模型；未接触角色没有模型空转 | `world/activation.py:44`、`domain/world.py:553` |
| 角色记忆 | 事件按当时 audience 分别写入各角色记忆；最多保留 100 条、短记忆 20 条。后续非预写回复的上下文使用本人的可见事件和记忆。没有长期语义归纳、反思和目标规划 | `domain/memory.py:9`、`domain/perception.py:9`、`domain/world.py:723` |
| 人格与目标 | profile 已有 traits/goals；traits 影响本地固定话术选择，goals 仍是数据。当前模型上下文未含人物名字、小传、traits/goals 或完整世界故事，不算人格/目标模型链完成 | `domain/models.py:267`、`domain/resolver.py:28`、`domain/perception.py:19`、`agents/gateway.py` 的上下文白名单 |
| 当前教程对白 | `_resolve_agent_operation` 优先返回 `story_response`。`signal-rain-v1` 对同场 A/B/C 总能返回预写回应，包括结局后闲聊，因此这些问答不进入模型。换个问题仍可能收到同一章节文字 | `domain/world.py:122`、`signal_story.py:310` |
| 非预写模型回应 | 无 authored 回复才经过队列/代际检查调用 GatewayAgent；配置缺失、网络失败或输出不合法有规则回退。一个 Kernel 共用一个网关配置，每次按目标提供独立上下文。共用模型本身不妨碍角色隔离，但尚无职责路由 | `domain/world.py:33`、`domain/world.py:126`、`agents/gateway.py:283` |
| 模型搭建世界 | `draft_world_from_story` 有函数和测试，默认单人 `story_draft` 没调用它，只发布预设或固定默认日程。不能将辅助函数存在视为产品接通高能力建世界模型 | `agents/gateway.py:288`、`gameplay.py:154`；全仓引用检查 |
| 普通 NPC 与角色 Agent 分层 | 有 person/extra 类型和 Z 临时槽位，但 Z 默认 inactive，D–Y 是预留槽位；临时角色生命周期与强制“路人不调用模型”的独立分流未完成 | `domain/models.py:260`、MW-11 |
| 观察者 | 管理入口可执行确定性位置/日程检查并持久化脱敏报告；没有后台低频模型审查、修正提案及受限执行。审计入口先调用正常时间结算，不能把整个入口说成绝无世界状态变化 | `domain/world.py:620`、`world/observer.py:8` |
| 工具编译 | 已有声明校验、实体/日程/遭遇编译及基础交通组合预演；不是任意生成可执行工具。新房间/角色、复杂分支、后台交通投影与完整回放仍未完成 | `tools/compiler.py`、`tools/registry.py`、MW-23–26 |

`modelEnabled` 当前仅检查 `MODEL_PROVIDER`，网关实际检查 `MODEL_BASE_URL`、`MODEL_API_KEY`、`MODEL_NAME`。这个布尔值不能证明角色模型已调用或可用。本轮没有查看环境值，不能据源码判断玩家当前服务是否配置了网关。

## 验证范围

本轮运行以下现有测试，**54/54 通过**：

```bash
env -u MODEL_BASE_URL -u MODEL_API_KEY -u MODEL_NAME -u MODEL_PROVIDER PYTHONPATH=. python3 -m unittest backend.tests.test_kernel backend.tests.test_lifecycle backend.tests.test_gateway backend.tests.test_tools backend.tests.test_world_builder -q
```

验证使用独立内存/临时数据库。网关测试使用受控 transport，不是真实供应商请求；通过说明已有内核、生命周期、结构化网关和编译契约保持可用，不证明自主生活已实现。本轮未重跑浏览器、构建、全部后端测试或真实模型多轮评测；上一轮 MW-42 的 UI 结果保留为历史。

另以 `SinglePlayerGame` 公开方法执行故事预览/确认、移动到办公室、提问/确认，[隔离实验 2/2](2026-09-21-agent-world-probe.json)实际记录：signal 教程确认问 A 的适配器调用增量为 0，自定义故事增量为 1；预览均不调用。自定义故事 A 能看到自己的测试记忆，看不到异房 B 的私密测试记忆；回应实际写入保存的 A 记忆，B 没收到该回应。实验注入计数替身并禁止网络，不代表真实模型生成质量。报告含产品源码 SHA256；[实验脚本](2026-09-21-agent-world-probe.py)可独立运行重现。

## 后续建议与可观察验收

以下是继续实现的建议顺序，尚未逐项实现或由用户确认具体行为：

1. **先接通一个角色的完整生活与对话链（MW-10/14/28–31）**：人物设定、近期经历、当前工作和个人目标实际进入上下文；教程关键事实继续受规则保护，普通聊天不再被整段固定稿覆盖。验收：同一角色记得玩家上次的承诺，换话题能正确回应；不在场角色不知道私下对话；无模型仍能通关。
2. **再做三个角色的低频生活推进（MW-17–20）**：日程负责位置，目标与重要事件决定是否调整计划；未被观察时只结算关键结果。验收：玩家缺席一场约定，角色留下记录并调整后续行为；返回场景能看到因果一致的后果；待机不持续消耗模型。
3. **补观察者、模型职责及长时间回归（MW-09/14/21/22/26）**：世界搭建、娃娃、主要角色、观察者的职责分别配置；观察者提出有范围限制且可审计的修正。验收：拒绝不可能的地点/时间/知识冲突，故障及重启不丢目标/记忆，不重复执行行动；真实模型效果与规则回退分别记录。

在第 1、2 步的真实多轮与时间窗口验收之前，项目应继续标为“有角色生活基础的开放世界 Galgame 原型”，不标整体多 Agent 世界完成。近期 UI 完成项不能替代这些核心验收。
