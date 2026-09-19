# 游戏角色运行时

任务：AR-01/02/04。需求：HF-17d/g/h、HF-19、HF-21–24。验证入口：`node --test tests/agents.test.js`。

`Pi Agent Core / Pi AI 0.85.1` 是实际执行路径。Node 要求 ≥22.19.0。只导入通用 Agent 与 OpenAI/Anthropic 协议；没有安装 coding-agent 或 TUI。社区 Team core 的固定来源、MIT 声明与离线构建见 `vendor/pi-team/NOTICE.md`。

## 接入契约

```js
const script = await composeScene(input, {
  signal,
  budget: {
    maxRequests: 8,
    maxInputTokens: 48000,
    maxOutputTokens: 6144,
    perRequestOutputTokens: 768,
    maxConcurrent: 3,
    deadlineMs: 12000,
    requestTimeoutMs: 8000,
    reserveRequest: () => dailyLimiter.consumeModelRequest(),
  },
  onMetrics: (numericSummary) => {},
});
```

保持现有 v3 剧本返回。`source` 区分 `model/mixed/local`，包括环境使用本地反馈的混合情况；固定路人 Z 不计为模型降级。用户取消抛 `AbortError`；超时与单角色失败只补本地表演。`reserveRequest` 是同步门禁，返回 `false` 或 `{allowed:false}` 时不会发供应商请求。配置限额只允许在默认值内调低。`onMetrics` 无文本，含 `requests/inputTokens/outputTokens/reservedInput/reservedOutput/inFlight/peakConcurrent/failures`、限额及 `modelRoles/localRoles/failedRoles/allRolesModel`。`source:model` 只说明最终采用的内容来自模型；某角色第二次回应失败但保留第一次成功内容时，`allRolesModel` 仍为 false。

只有 `doll` 收到 `text/confirmedFacts/dollMemory/recentNight`。NPC 只收到各自 `memories[id]`，以及娃娃通过 Team 定向投递的 YOU 公开动作和本场台词；不传原始玩家意图或通用 history。ENV 只得到物件/环境状态与 `environmentEvents`，不读取人物私下对话。游戏不公开 Team 原始事件或私有邮箱。

所有角色工具只生成提案：`perform`、`inspect_object`，NPC 可额外 `send_message`。服务端工具逐项校验站位、物件、身份动作与文本，最终还经过共享 v3 契约。娃娃的 `nudge` 已写入实际演出时间线。模型没有 Shell、文件、任意网络或写世界状态工具。权威状态与事实只能由 API 的玩家确认事务保存。

每角色独立 Pi 会话，本幕 NPC 至多两次回应，单次行动至多两次模型请求；每幕硬上限另在 provider 请求边界检查。`perform` 成功后立即结束工具循环，同一批其后的工具不再产生提案或私话。Team 的广播同源串行机制未用于普通反应：娃娃向每个人投递不同 envelope，允许并行；角色公开 `to` 和私话会定向唤醒成员。`AGENT_MODE=sequential` 将人物 wave 并发改为 1，后者能读到前者已经公开的本轮台词；默认并行。

## 预算与取消

- 每个 Pi provider 请求先占用单幕/进程连接槽，再预留输入字节保守估计和输出 `max_tokens`；所有自动 HTTP 重试关闭。
- 输入字节估计与供应商实际 `usage` 分开计数。失败/断流仍保留预留，不假定免费。没有返回 usage 不代表零成本。若供应商报告超预留，关闭后续请求。
- 单幕并发最多 3，所有玩家进程合计最多 8。队列、请求和工具均响应取消。调用完成前不修改已确认记忆。
- `inputTokens/outputTokens` 是供应商可取得的 usage，`reservedInput/reservedOutput` 是成本上界预留，不把两者混报。
- 每幕结束关闭全部临时 Agent；下一幕由服务器已确认事实和每角色可见记忆重建，不保存未确认的模型推理/私话。恢复、去重、玩家隔离由 `GameStore`/API 实现，不宣称 Team 自带重启恢复。

## 验证边界

假 provider 与本地 HTTP SSE 检查实际 Pi 工具调用→工具结果→下一请求，以及 Team定向接话、私人输入隔离、预算、取消、局部失败和环境反馈。它们不是生产模型质量证明。真实网关测试由集成任务统一执行，避免并行产生重复费用；真实证据登记在 SDD 验收中。

`server/model.js` 的旧人名提取接口不属于本运行时；保留兼容，不冒充它已迁入 Pi。场景视觉、部署和微信真机不由本目录测试覆盖。
