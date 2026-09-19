# Agent 框架选型 · 研究证据

日期：2026-09-18。关联 [决策 0004](../decisions/0004-agent-runtime-selection.md)、任务 SEL-01、验收 SEL-AC-01。

## 证据分层

| 范围 | 方法 | 可支持的结论 | 不支持的结论 |
| --- | --- | --- | --- |
| 项目现状 | 读取 package、server 编排/model、hex 状态、共享契约 | Node ESM/PixiJS；当前并发/顺序和存档边界 | 已有持久 Agent Team、已上线、微信已通过 |
| Pi | npm 固定发布包和源码；三个假适配器运行 Team core | 核心可脱离 TUI/coding session；底层私邮和续轮行为 | 最新 Pi 与 Team 默认适配器原样兼容；模型表现、重启恢复 |
| DeepSeek Harness | 官方源码归档、README、Team/SDK/provider 文档、npm tags | 官方实验 Team 与公开 SDK 限制存在 | 主分支等于所有 latest 包；本项目已运行通过 |
| Claude | 官方 Team Markdown、SDK 官方发布包类型声明 | 交互式 Team 与 SDK subagents 边界；SDK 提供取消/工具/预算 | headless 自动获得 Code Team；现有网关完整兼容 |
| OpenAI、LangGraph、Mastra、Deep Agents、Microsoft、CrewAI | 实际获取官方文档 | 文档列出的框架能力、适用取舍 | 项目接入成功、供应商可达、真实性能排序 |

本轮没有读取 `.env`、发起真实模型请求、在项目安装框架或修改服务器。比较的是工程适配度，没有模型质量或单幕价格排名。

## Pi Team core 无模型实验

来源：npm `@geminixiang/pi-agent-team@0.3.0` 的 `src/runtime.ts`、`src/domain.ts`、`src/run-manager.ts`。在临时目录以 Node `stripTypeScriptTypes` 的 transform 模式生成 `.mjs`，调整这几个文件内部相对导入，再执行 Node assert 测试。未通过 npm 根入口加载 coding/TUI，也未导入 Pi Core；它是**Team 核心通用适配接口的实验**。

测试构造三个对象式 `TeamAgent`：A/B/C 各有独立 `sessionId`，`act(turn, signal)` 记录其收到的 observations。A 发一个私密 canary 给 B，另发普通唤醒给 C，之后结束；B/C 发公开回应并结束。使用 `maxTurns: 10`、`actionTimeoutMs: 500`。

断言和实测结果：

- `run()` 正常完成。
- B 收到 canary；C 没收到。
- 完整 `result`（含审计）中没有 canary 原文。
- `onActivity` **包含** canary 原文，并标记 `visibility: restricted`，因此应用仍须过滤。
- `next()` 再跑一轮后，各成员 `sessionId` 不变，假适配器自己保存的观察历史仍在。
- `close()` 调用全部三个成员的资源释放接口。

2026-09-18 在本机复跑，退出码 0：

```json
{
  "completed": "completed",
  "nonCodingAdapters": true,
  "tuiLoaded": false,
  "privateMailboxIsolation": true,
  "resultRedaction": true,
  "activityCallbackContainsPrivateBodies": true,
  "continuationKeepsAdapters": true,
  "sessionIds": ["game-A", "game-B", "game-C"],
  "closeCount": 3
}
```

临时复核入口：`/tmp/voodoo-selection-20260918/pi-core-smoke/test.mjs`。该目录不是交付依赖，可能被清理；长期复核以固定发布包、以上步骤/断言为依据，正式接入须在仓库建立 adapter 测试。

局限：`next()` 后历史保留由假适配器自身提供，不能证明 Pi 会话持久化，更不是进程重启实验。没有测试真实工具循环、完整游戏知识隔离、取消竞态、吞吐或费用。

## 固定版本与容易误读的地方

- Pi Core/coding-agent 当前 `0.85.1`；旧 `@mariozechner/pi-coding-agent@0.73.1` 的 npm deprecated 指向 `@earendil-works`。
- Team `0.3.0` peer 仅覆盖 Pi coding-agent/tui `>=0.82.1 <0.83.0`。独立 core 实验绕过了该适配器，因此**不能**当作版本整合通过。
- Team 默认 `maxTurns = options.maxTurns ?? Math.max(256, agents.size * 32)`，可以显式调低；并非硬性最小 256。默认行动超时 300000ms，可配。二者不等于供应商 token/费用预算。
- DeepSeek 官方归档 PAX comment：`ddefc45fbc7f8e46dd73185e68295696d1297887`，源码根版 `0.1.6-alpha.2`。npm latest：dsh `0.1.5-rc.2`、sdk-client `0.0.1-rc.1`、Team `0.1.5-alpha.2`；统一 next 为 `0.1.5-rc.2`、alpha 为 `0.1.6-alpha.2`。未安装运行。
- DeepSeek SDK 缺少中途取消的 wire 方法；core 和 Team Lead 有取消能力。默认 `sdk-minimal` 仍有 Shell，不能把名称 minimal 理解成游戏工具已裁剪。
- Claude SDK 发布包 `@anthropic-ai/claude-agent-sdk@0.3.276` 的声明含取消、工具、预算和会话接口。官方 Team 文档原文：`Spawning teammates also requires an interactive session. In non-interactive mode with the -p flag, including Agent SDK sessions, Claude doesn't spawn teammates...`
- Mastra 默认子代理继承父完整对话，fresh thread 不代表输入私密；LangGraph 默认 per-invocation 子图不代表跨轮记忆；CrewAI 有 checkpoint/Flow 持久化，不能说没有恢复能力。

官方来源与后续验收见 [决策 0004](../decisions/0004-agent-runtime-selection.md)。本次只完成选型研究，不将任何 AR-AC 标为完整通过。
