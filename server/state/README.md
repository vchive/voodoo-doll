# AR-03 · 单机世界与确认结算

范围：HF-06/10/16/20/21，AR-AC-03/04/05/07；只负责 `server/state/**` 和 `tests/state*.test.js`。HTTP token 传递、模型输入分发、浏览器迁移由集成方负责。本目录不发起模型调用。

使用 Node 22.19+ 的 `node:sqlite`（当前 Node 22 会提示实验性 API）。`GameStore` 是同步 SQLite 存储，生产必须传入静态服务根目录之外的 `filename`，建议单独受限数据目录、单应用进程；不把数据库/WAL/SHM 放进源码分发目录。默认 `:memory:` 仅供测试，不能据此宣称服务器重启保存。数据库使用 WAL、FULL synchronous、事务与唯一 requestId。

```js
import { GameStore } from './state/game-store.js';
const store = new GameStore({ filename: '/var/lib/voodoo-doll/world.sqlite' });
const { token, snapshot } = store.openSession();
// HTTP 层将 token 当 bearer secret；不要放 URL、日志、公开世界 ID 中。
const configured = store.configure(token, {
  dollName: '小夜', names: { A: '那个人' }, confirmedFacts: ['玩家明确确认的故事。'],
}, snapshot.version);
const turn = store.begin(token, { requestId: crypto.randomUUID(), input: { text: '让他解释。', version: configured.version } });
// const script = await composeScene(turn.input, { signal });
// store.propose(token, turn.turnId, script);
// 玩家实际确认后：store.confirm(token, turn.turnId);
```

所有方法返回独立副本。`StoreError` 含 `code`、`status` 和 `statusCode`，HTTP 层应返回这些可理解的业务错误，不返回数据库异常或堆栈。

| 方法 | 约定 |
| --- | --- |
| `openSession(token?, {legacy?}?)` | 无 token 才新建；未知非空 token 返回 401，不静默替换档案。返回 `{token,snapshot}`。提供 legacy 时仅新建世界导入 |
| `get(token)` | 返回本人 `snapshot`；世界 ID/回合 ID 不是授权凭证 |
| `configure(token, patch, expectedVersion?)` | 玩家明确确认的资料修改；字段 dollName/names/stage/confirmedFacts（或 story）；第三参数或 patch.version 做 CAS；成功作废生成中的旧草稿 |
| `importLegacy(token, v5State, expectedVersion?)` | 只在尚未导入、配置、生成或确认的新世界执行一次。只接受 schemaVersion 5；不修改传入对象或浏览器 key，不传头像 |
| `begin(token,{requestId?,input})` | input.text/playerText ≤200；可含 stage 或 roomId/present/ambient、names、version/stateVersion。新回合作废旧回合，返回 `{turnId,version,input,expiresAt}`。浏览器传入记忆、事实、夜数和历史不受信任 |
| `propose(token,turnId,rawScript)` | 共享契约+在场+本房间动作校验；返回 `{turnId,version,script,expiresAt}`。同一回合不允许悄悄换剧本；反问可暂存但不能确认 |
| `confirm(token,turnId)` | 原子提交舞台、名字、夜数、可见事件与角色记忆；同回合重复请求只返回当前 snapshot，不重复结算 |
| `cancel(token,turnId)` | 作废本人活动回合。旧回合取消不影响新的回合；已确认回合不可撤销，幂等返回当前 snapshot |
| `close()` | 释放资源；重开 DB 恢复确认内容，生成/预演草稿均失效 |

`snapshot` 形状：`{worldId,version,state:{stage,names,nights,doubt,dollName,lastNight,onboardingPhase},confirmedFacts,memories,log,environmentEvents}`。`confirmedFacts` 是最多 24 条的字符串数组（每条 ≤600 字）。版本在 begin/configure/confirm/cancel 等状态改变后递增；前端以响应版本更新，不能把旧回合返回覆盖新状态。生产 HTTP 写接口应要求调用方携带最新版本；服务内方法省略版本只用于受控初始化流程。

私密性边界：

- 只给娃娃 `input.text`、`input.dollMemory`、`input.confirmedFacts` 和 `input.history`；这些字段不能普发 NPC。`memories[id]` 只给该角色。`environmentEvents` 仅已确认的 use/ambient，按当前房间过滤。
- 玩家每幕输入只在演出确认后进入娃娃私密记忆；单纯生成不落盘。明确开场故事确认用 `configure` 独立保存。
- 已确认公开台词和动作仅记给当时在场角色与娃娃；娃娃 speak 默认视为对玩家私语；ENV 不拿任何玩家文本或人物台词，只记物件/环境事件。
- 完整 snapshot 只发给持有本人 token 的玩家，不能当整队 prompt。UI log 保留历史，但不重新作为模型输入。
- 明确替换 confirmedFacts 时清空旧模型摘要与上一夜摘要，避免旧错误事实从转述回流；已确认夜数与 UI 历史不删除。此为当前可执行纠正策略，后续细粒度依赖追踪另行实现。
- 草稿正文及输入只驻内存；DB 仅记录回合标识/状态用于幂等和拒绝迟到。重启不恢复中途模型循环，不重放已结算动作。
- UUID 只作资源标识，token 为 256-bit 随机凭证且 DB 只存其 SHA-256。持有 token 即拥有该匿名档案，HTTP 层需避免 URL 泄漏并在 HTTPS 可用时启用安全 cookie。

验证：`node --test tests/state-store.test.js`。覆盖双玩家隔离、重启、迟到/取消/过期、版本冲突、确认幂等、输入污染、故事纠正、v5 显式迁移与可见性；这不代表微信真机、HTTP 端到端或真实模型通过。
