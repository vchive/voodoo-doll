# 2026-09-19 世界草稿原子发布与审计回归

状态：本地验证通过，未部署公网。本轮是 004 的可验证开发切片，不能代替整个架构迁移或世界搭建验收。

## SDD 追踪

| 任务 | 需求 / 验收 | 本轮结果 | 尚未覆盖 |
| --- | --- | --- | --- |
| MW-22/MW-25/MW-26 | WL-08/WL-09；MW-AC-22/25/26 | 实体/公开重复日程/遭遇声明校验与预览，哈希/版本复核、原子发布、取消、重启回执、跨连接并发确认 | 新房间/角色、例外日程、私密日程、非零容差、图可达性、复杂组合动作与高能力模型工作流 |
| MW-23/MW-24 | WL-09；MW-AC-23/24 | 类型/affordance/动作/路线/站点校验，旧车辆定义更新同步运行投影，目的地在 resolver 二次校验 | 定义与可变状态完整拆分、班次、后台到达、坐标兴趣范围、完整交通回放 |
| MW-21 | WL-07；MW-AC-21 | observer 持久报告按 worldId+reportHash 数据库去重，跨连接/重启/旧库升级保留历史 | 完整不变量、低频模型观察、受限 correction proposal 和修复事件 |
| MW-18/MW-20 | WL-02/03/06；MW-AC-18/20 | 已确认日程驱动无模型投影、遭遇候选接入激活事件与稳定选择 | 例外/冲突审计、关系条件、离开重入与跨进程重连矩阵 |

## 环境与代码版本

工作区 `/Users/liminghan/Documents/voodoo-doll`，macOS 26.6.2 arm64；Python 3.9.6、SQLite 3.51.0、FastAPI 0.128.8、httpx 0.28.1。2026-09-20 单人预发布收口时重新计算了以下关键文件 SHA-256；候选版本同时由仓库 Git 提交定界，可用 `git rev-parse HEAD` 读取。HTTP 合同测试使用 FastAPI TestClient，不代表真实公网访问；依赖声明已增加 `backend[test]`。

| 文件 | SHA-256 |
| --- | --- |
| `backend/app/tools/compiler.py` | `fb109bafa62fd180527cd5930e8e5d582c4fc21026a46a401e43df843a65ac38` |
| `backend/app/tools/mobility.py` | `adfc7d4be240ccb7ed4aaa4123e8e737d4d0e14cfad66eda45d691da11a7e419` |
| `backend/app/world_builder.py` | `29cbe1ae82158dad635f9a79f4c7281260ee14339acfdb1d0e63875b66a98675` |
| `backend/app/domain/world.py` | `00519a42331f1ba3bc09e2ace03c7166bf9ebf246a16d44286a5baa1c0c97163` |
| `backend/app/store/event_store.py` | `4c8361e45ecb813e67556effd459ec322bb56d8e916ac94cea5e82ac65bd0ccb` |
| `backend/tests/test_world_builder.py` | `040d956c4e7adbe599fc5f5f2efafcaf5fddf4d64ffd340dd018c69d34e8a315` |
| `backend/tests/test_world_builder_api.py` | `c87e3244ab854d4d44af3c03838720b80d2548e5029c31c2fc369c6f9e8a277a` |
| `backend/tests/test_tool_declarations.py` | `5c3a463a73c5c0b08d114a6652b54b1e467b266ac7a90573896720a3b66cd5ef` |
| `backend/tests/test_world_kernel.py` | `bebac7c5ff118844c3b4c8df74c3c825c130c1cda7d6cfef2c203fbac8fde55d` |
| `backend/pyproject.toml` | `8337c49059c938cc77b995d0cd83a58abf4d72a744f136ce63f5b3441bf2fb2e` |

## 已执行检查

| 命令 | 结果 |
| --- | --- |
| `PYTHONPATH=. python3 -m unittest discover -s backend/tests -v` | 103/103，0 失败、0 跳过；包含世界草稿、实体声明、HTTP、生命周期、遭遇与单人产品闭环 |
| `python3 -m compileall -q backend` | 通过 |
| `npm test` | Node 79/79，0 失败、0 跳过 |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过 |
| `npm run hex:build` | 通过 |

重要行为证据：

- 非法字段/列表/动作/路线、未知角色/地点、非零日程容差全部在持久化草稿前拒绝；返回的预览与读取副本不能反向修改草稿。
- 创建同 ID 不覆盖；取消先提交时另一个 Kernel 不能从旧缓存发布；确认先提交时取消返回已发布冲突。
- SQLite 事务覆盖快照、事件、回执和草稿删除。插入事件失败或删除草稿失败均回滚全部结果，草稿保留供重试。
- 同一实例多线程及独立数据库连接并发确认只生成一个发布事件、返回同一回执；后续回合及重启不改变该回执。
- 已确认日程经时钟投影把 A 放到 office；只有兴趣激活后才记录 coffee-break 遭遇，重复 heartbeat 不重演。发布/投影不调用角色模型。
- 更新 cityBike/cityMetro 会替换旧路线/站点/类型/位置；删除的目的地不再可用。
- 审计真实缺陷为同一版本 A/B/A 报告重复，普通审计夹入本身不会破坏旧逻辑。数据库去重覆盖 A/B/A、跨连接、world 隔离和重启；旧库重复历史不删除，普通审计仍逐条记录。

HTTP 合同样例：`POST /api/v4/world-builder/drafts` 后世界仍为版本 0；错误 expectedVersion 返回 409；首次 confirm 返回 200/版本 1，重复 confirm 返回相同结果；非空 rooms 返回 422；取消后 confirm 返回 404，版本不增加。

## 限制与后续

本轮没有改 UI，没有重新做桌面手机尺寸或微信真机验证；未请求真实模型、未连接部署服务器、未清理已有玩家存档。现有回放主要读取持久快照与事件；从事件独立重建全部状态、mobility 端到端回放仍需单独验收。服务会话/内部接口鉴权、生产配置和公网发布仍未完成。

下一依赖优先收紧发布注册表与运行状态分离、补世界事件回放，再扩展新房间/角色与复杂日程；完整观察者与随机遭遇矩阵继续在 MW-20/21 中跟踪。默认架构仍为 TypeScript 前端 + Python World Kernel，Node/Pi legacy-v2 保留回滚。

开源代码实际下载与许可证核对独立记录于[源码审计](../research/2026-09-19-source-reuse-audit.md)：本轮借鉴 boardgame.io 的校验与日志设计，未复制其业务代码或新增运行时框架。
