# 003 技术方案 · 注册世界与成人策略

状态：部分实现。003 的关系、多目标与 policy 能力仍只在 `legacy-v2` Node/JavaScript 路径有原型；004 的 Python World Kernel 基础能力和 TypeScript 单人入口已落地，并提供草稿确认/CAS、旧档导入强制 SFW 和房间移动作为迁移底座，桌面 Chrome 移动视口的本机基础闭环已通过。004 `MW-15` 仍待开始，`MW-27` 仍为部分完成，因此这些底座不能视为 003 已由 Python 接管或移动端正式验收完成。已存在的 legacy 证据包括 `shared/world-registry.js`、`shared/relationship.js`、`shared/target-set.js`、`server/policy/` 和 `server/state/game-store.js` 及其 Node 测试。

## 模块边界

| 模块 | 责任 | 主要文件 |
| --- | --- | --- |
| World Registry | 房间图、站位、物件和动作白名单；纯数据、可版本化 | `shared/world-registry.js` |
| Relationship Store | 关系边、来源事件、范围校验、纠正和迁移 | `server/state/game-store.js`、`shared/relationship.js` |
| Target Sets | 多目标集合、成员可见性、组合后果和原子结算 | `shared/target-set.js`、`server/orchestrator.js`、`server/state/game-store.js` |
| Policy Gate | 输入/草稿/beat 三次检测，内容级别、渠道与年龄策略 | `server/policy/`、`server/index.js` |
| Script Contract | 将模型输出限制在注册表和策略允许的枚举内 | `shared/script-contract.js` |
| Local Fallback | 同构房间/关系模板；不依赖模型或网络 | `shared/local-station.js`、`hex/` |
| Client Settings | 展示等级、年龄确认、SFW 降级说明；不持有权威策略 | `hex/app.js`、`hex/storage.js` |
| Audit | 只保存 hash、policyVersion、reason code、时间和会话版本 | `server/state/` |

## 状态与安全

服务端 session 保存 `contentLevel`、`policyVersion`、`ageConfirmed`、`channel`、`regionPolicy` 和 `worldVersion`。年龄确认不是身份证明，也不替代上线前合规审核；它只是一道产品门槛，渠道策略可强制 SFW。

多目标仪式以 `targetSetId` 为结算单位。编排器先为每个目标建立隔离上下文，再合并通过契约校验的公共 beats 和关系变化。GameStore 用一个事务写入目标成员事件、关系边和夜数；任一校验失败则整组回滚。撤回只新增一个反向关系事件，历史记录保持不可变。

模型上下文只包含该角色可见的已确认事实、关系边和公开事件。策略 gate 在 provider 返回后再次运行，任何未通过的结果变成可玩的本地 SFW 草稿。拒绝事件不进入角色记忆，避免敏感输入反复回流。

## 迁移

旧 `voodoo-hex-v5` 默认迁移为 `contentLevel=sfw`、空关系图、当前 `worldVersion`；不覆盖用户头像和已确认事实。旧单娃娃存档继续按 001 规则迁移。

当前迁移边界：003 的上述 Node 模块仍是 `legacy-v2` 能力。004 已将 Python FastAPI World Kernel + TypeScript/PixiJS 单人入口设为本地预发布主路径，Node 入口保留为回退；current/v5/v1 导入、坏档原子失败和导入强制 SFW 已有证据。关系结算、成人策略、target-set 写入、分享降级和完整回滚仍未由 Python 接管。

## 发布顺序

1. 建立 003 的注册表、target set 和关系状态契约，补单元测试。
2. 把单目标存档迁移为单成员 target set，并完成多目标原子结算。
3. 增加服务端 policy gate 和 SFW fallback，先不开放 mature UI。
4. 接入 mature 的年龄/渠道策略和审计，再做代表性越界测试。
5. 打通客户端开关、回退、分享降级和离线同构模板。
6. 完成 320/390/430、微信真机、公网 HTTPS 与压力验证后，才讨论正式上线。

## 失败策略

任何策略服务、模型、数据库或注册表版本异常都回退到当前 002 的 SFW 本地站。拒绝成人内容不能让输入框白屏、卡住确认或推进夜数。策略 gate 失败与模型失败分开计数，便于交接时识别原因。
