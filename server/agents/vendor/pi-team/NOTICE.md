# 上游记录

- 项目：`@geminixiang/pi-agent-team`，作者 geminixiang。
- 固定版本：0.3.0；提交 `1d0342afc21a21d6a111b56a97df81e34ca8d60c`。
- 发布包：https://registry.npmjs.org/@geminixiang/pi-agent-team/-/pi-agent-team-0.3.0.tgz
- npm SHA-1：`36c26f46291b8768f1a9e4cda77b163a3822a0fc`。
- 上游声明许可证：MIT。保留于 `LICENSE`。
- 只复制 `domain.ts` 与 `runtime.ts`；没有复制 PiTeamAgent、扩展入口、TUI、RunManager 或技能。
- `source/` 与发布包文件一致；生成的 JS 仅做 Node 22 `stripTypeScriptTypes({mode:'transform'})` 类型转换。
- 重建：`node server/agents/vendor/pi-team/build.mjs`。无需网络。
- 此副本由本项目固定维护，不宣称默认插件与 Pi 0.85.1 的 peer 兼容。

核心活动回调可含私信正文，游戏不向前端暴露该回调。权威存储、预算与模型权限都在本项目适配层实现。
