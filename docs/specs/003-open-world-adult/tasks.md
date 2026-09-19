# 003 任务清单 · 开放关系世界与成人表现层

状态：部分实现。003 专属能力仍主要位于 `legacy-v2` Node/JavaScript；004 已完成 Python/TypeScript 单人预发布底座，但 004 `MW-15`（关系、多目标、policy、分享降级和审计迁移）仍待开始。每项完成必须有代码、测试和验收证据；“写了提示词”不算完成。

| ID | 任务 | 需求 | 验收 | 状态 |
| --- | --- | --- | --- | --- |
| OW-01 | 建立 room/edge/object/affordance 注册表与 schema 校验 | AW-01/04 | OW-AC-01 | legacy 部分完成：`shared/world-registry.js` 与 Node 测试；Python 迁移待完成 |
| OW-02 | 增加关系边存储、范围、来源、可见性和纠正迁移 | AW-02/03/08 | OW-AC-02 | legacy 部分完成：`shared/relationship.js`、`game-store.js` 与测试；Python 结算待完成 |
| OW-03 | 接入跨房间造景、角色在场与离线同构模板 | AW-01/02/06 | OW-AC-01/03 | 部分完成：legacy Node orchestrator/local fallback；Python 单人入口已完成 11 地点精确移动和 320/390/430 桌面移动视口闭环，003 造景/关系同构尚未迁移 |
| OW-04 | 动态人物/地点显式确认、版本号和 CAS | AW-05/07 | OW-AC-03 | 部分：004 世界草稿已有确认、取消、版本和 CAS 基础；新人物/地点编译与 003 动态扩展尚未完成 |
| MT-01 | 定义 target set、单目标迁移和组合关系契约 | MT-01/02/04 | MT-AC-01 | legacy 部分完成：`shared/target-set.js` 与测试；存档迁移待完成 |
| MT-02 | 编排多目标隔离上下文、公共 beats 和局部 fallback | MT-02/03/04 | MT-AC-02 | 部分：Node 编排/隐私路径已有；完整多目标演出待完成 |
| MT-03 | 为多目标确认实现事务结算、撤回事件和 CAS | MT-05/06 | MT-AC-03 | 部分：Node 草稿/CAS 基础已有；原子关系结算与 Python 迁移待完成 |
| AD-01 | 实现服务端 content policy/session 状态，默认 SFW | AD-01/06/09 | AD-AC-01 | 部分：legacy Node policy/session 默认 SFW 与测试；Python current/v5/v1 导入会强制 SFW，但成人 gate、年龄/渠道策略和切换流程尚未迁移 |
| AD-02 | 实现输入、草稿、最终 beat 三次 policy gate 与 SFW fallback | AD-02/03/04 | AD-AC-02 | legacy 部分完成：Node gate/fallback 与测试；跨语言接管待完成 |
| AD-03 | 确认成人层不增加工具权限，屏蔽 URL/HTML/脚本/外部动作 | AD-05 | AD-AC-03 | 部分：Node 契约过滤已有；完整端到端验收待完成 |
| AD-04 | 审计 policyVersion/hash/reason code，过滤普通日志 | AD-06/08 | AD-AC-04 | 部分：Node audit 字段和测试已有；Python 审计迁移待完成 |
| AD-05 | 客户端年龄门槛、mature 开关、降级提示和刷新恢复 | AD-01/06 | AD-AC-01/03 | 待开始 |
| AD-06 | 战报/分享卡片强制 SFW 摘要 | AD-07 | AD-AC-03 | 待开始 |
| INT-01 | 更新 002 交接、迁移和测试矩阵，记录真实微信/公网单列 | 全部 | INT-AC-01 | 部分：文档已同步；Python 103/103、Node 79/79、TypeScript 检查/构建和桌面移动视口证据已有，003 专属迁移、微信真机与公网仍待完成 |

## 文件责任

- `shared/` 与 `server/` 只作为 `legacy-v2` 已有证据和回滚维护路径；不得为正式迁移继续扩充旧 Node 权威状态。
- Python 迁移：004 `MW-15` 在 `backend/` 的事件、策略和存储边界实现 OW-01/02/04、MT-01/02/03、AD-01 至 AD-04，并补对应 Python 测试。
- 前端：OW-03、AD-05/06 的正式入口改 `hex/` 与 TypeScript 测试；兼容回滚的旧界面改动须单独标明。
- 集成 agent：INT-01 维护 SDD 文档、交接和验收证据。

依赖顺序：OW-01 → OW-02/03；MT-01 → MT-02 → MT-03；AD-01 → AD-02/03/04 → AD-05/06；所有任务完成后才做公网与微信验证。
