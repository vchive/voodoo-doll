# 0007 · 世界交互工具边界与参数化环境能力

日期：2026-09-18；更新：2026-09-19（Asia/Shanghai）
状态：**方向已确认，部分实现；本轮实体/公开日程/遭遇编译与原子发布已有验证，完整工具与世界搭建待验收**

## 背景

开放世界中的角色不只会说话，还会开车、坐地铁、骑自行车、开关灯、使用电脑、进出房间和操作其他物件。若为每一辆车、每一盏灯、每一条地铁线路都写一个独立模型工具，工具数量会随世界内容线性膨胀；若允许模型在运行时生成任意工具，又会把世界权限交给模型，破坏可重放、权限校验和存档安全。

004 已确定 Python World Kernel 是唯一世界权威，`ENV` 只负责规则反馈，角色 Agent 只能提交行动提案。本决策把“工具”分成固定能力、注册实体和组合动作三层，使相同的 Kernel 能力覆盖许多具体物件，同时保留角色差异和世界观扩展能力。

## 决定

### 1. 三层工具模型

| 层 | 内容 | 谁维护 | 是否可在运行时生成 |
| --- | --- | --- | --- |
| 原子能力（primitive） | `look`、`move`、`speak`、`use_object`、`travel`、`board`、`alight`、`operate_vehicle`、`wait` | Kernel 代码与契约 | 否，版本化发布 |
| 实体注册表（entity/affordance） | 一辆车、一盏灯、一站地铁、一个门、一个站位的类型、状态、位置、可用动作和前置条件 | 世界构建流程与注册表 | 可以由世界草稿提出，确认后才进入运行时 |
| 组合动作（compound action） | “开车去公司”“乘地铁到酒吧”“骑车回家”等由多个原子事件组成的可重放模板 | Kernel resolver / planner | 只能从已发布模板组合，不能生成可执行代码 |

模型面对的是当前场景的**受限工具目录**，例如：

```json
{
  "toolId": "operate_vehicle",
  "actor": "A",
  "args": {
    "vehicleId": "car-a",
    "destinationRoomId": "office"
  }
}
```

模型不得提交 `drive_car_a_to_office_and_make_noise()` 之类的新函数，也不得直接写 `roomId`、`fuel`、`light` 或关系数值。模型的输出永远只是提案，Kernel 会重新计算目标、时间、路线、资源消耗和可见结果。

### 2. 具体交互如何落地

| 玩家可观察行为 | Agent 提案 | Kernel 校验/结算 | ENV 可见反馈 |
| --- | --- | --- | --- |
| A 开车去公司 | `operate_vehicle(vehicleId, destination)` | A 是否在车旁、是否有驾驶能力、车辆是否可用、道路是否连通；消耗行程时间并更新 A 与车辆的投影位置 | 引擎声、车灯、车辆离开/到达；不替 A 决定心情或台词 |
| A 乘坐地铁 | `board(transitId, station)` → `travel(mode="transit")` → `alight(station)` | 当前站点、线路时刻、票/容量、目的站和统一时钟；生成一组可重放的乘车事件 | 进站提示、列车到站、车门关闭、站内广播 |
| A 骑自行车 | `operate_vehicle(vehicleId, destination)`，实体类型为 `bicycle` | 是否拥有/能使用该车、是否在允许区域、路线和天气条件 | 链条声、车轮经过、到达位置 |
| A 打开台灯 | `use_object(objectId, verb="on")` | 台灯是否在同一兴趣范围、开关是否存在、该角色是否具备动作能力 | 灯光状态、阴影和一条短环境描述 |
| 玩家让娃娃“灯闪一下” | `PLAYER_DOLL` 提交已注册的 `flicker` 暗手 | 仅允许娃娃能力表中的物件和场景条件；不改变角色意志 | 灯闪、声音或短暂氛围变化 |

车辆和交通不需要为每个实例写新工具。`operate_vehicle` 读取 `vehicle.type`、`controlMode`、`routePolicy` 等注册数据；`car`、`bicycle`、`scooter` 可以共享同一动作契约，差异由注册表和 resolver 参数表达。地铁也不需要把每一站写成一个工具，`TransitNetwork` 注册线路、站点、班次和换乘关系，`board/travel/alight` 使用实例 ID 和站点 ID。

### 3. ENV 与角色 Agent 的职责分离

- 角色 Agent 决定“我想做什么”，并可以拒绝、改变计划、等待或离开。
- World Kernel 决定“这件事是否合法、花费多少时间、产生哪些权威状态变化”。
- ENV resolver 决定“旁观者能看到什么”，例如灯光、声音、门、天气和交通提示。
- World Observer 只检查时间表、实体状态、路线和事件不变量，不能把失败的行动改写成成功行动，也不作为剧情角色与玩家对话。

因此，世界模型可以通过系统事件与用户产生反馈，但普通用户不会直接和 ENV Agent 对话来改变世界。玩家通过 `YOU` 与场景交互；巫毒娃娃可以提出有限的暗手；世界构建阶段才允许玩家与高能力模型共同编辑注册表草稿。

### 4. 工具目录按兴趣范围裁剪

每次角色被激活时，Context Builder 只下发：

1. 当前地点和兴趣范围内的实体；
2. 该角色拥有或能够使用的原子能力；
3. 满足前置条件的动作参数枚举；
4. 不满足条件但可解释的拒绝原因，例如“没有驾驶资格”“地铁尚未到站”。

未进入玩家兴趣范围的角色不接收工具调用，也不持续运行模型；他们只保留时间表产生的 `PresenceProjection`，跨地点时增加包含起终点、交通方式和预计到达时间的 `TravelProjection`。这使“上班”“乘车途中”“在家休息”可以先作为低成本投影。玩家在途中进入同一车厢、道路或站点时，Kernel 以同一行程 ID 把剩余步骤物化为可交互场景；无人观察时，到点只更新驻留投影。

### 5. 动态生成的边界

动态生成只发生在世界构建或管理员发布流程：

1. 强模型把玩家叙述转换成房间、实体、关系、日程和遭遇草稿；
2. 草稿只能引用已发布的原子能力；
3. `ToolCompiler` 校验实体类型、参数 schema、前置条件和可见性，拒绝任意代码、网络调用、文件操作和未注册副作用；
4. 玩家确认后生成带版本的注册表；
5. 运行时 Agent 只能调用已发布 `toolId`，未知工具直接拒绝并写入审计事件。

如果未来需要一种全新的交通方式或魔法机制，应新增一个版本化 primitive/resolver，并补充契约测试；不能让单次模型输出悄悄扩大权限。

### 6. 失败、重放与成本

- 原子动作失败只产生结构化拒绝，不写入部分状态。
- 组合动作按步骤写入事件，步骤带 `compoundId` 和稳定种子；取消或超时按模板定义是否回滚，不能由模型临时决定。
- 车辆、地铁和灯光的常规结算优先由确定性 resolver 完成；模型只负责角色意图和可选旁白。
- ENV 模型不可用时使用本地短反馈，不能阻塞移动、开灯或换乘。
- 事件记录 `toolId`、参数摘要、resolver 版本、前置条件结果和可见性，重放不重新调用模型。

## 首版工具契约草案

```json
{
  "toolId": "use_object",
  "version": 1,
  "actorKinds": ["player_doll", "person", "extra"],
  "input": {
    "objectId": "string",
    "verb": "string",
    "payload": "object"
  },
  "effects": ["object_state", "environment_feedback"],
  "resolver": "object.v1"
}
```

```json
{
  "toolId": "operate_vehicle",
  "version": 1,
  "actorKinds": ["person", "extra", "player_body"],
  "input": {
    "vehicleId": "string",
    "destinationRoomId": "string"
  },
  "effects": ["travel_time", "presence_projection", "vehicle_state", "environment_feedback"],
  "resolver": "mobility.v1"
}
```

未来增加公共交通时优先复用 `travel`、`board` 和 `alight`，而不是增加 `ride_subway_line_2`、`take_bus_17` 这类实例化工具。

## 影响的 SDD 任务

- `MW-05/MW-07`：把当前物件动作校验扩展成版本化 `AffordanceRegistry` 和 resolver。
- `MW-18/MW-19`：PresenceProjection 和 ActivationLease 需要支持交通中的“预计位置/到达时间”投影。
- 新增 `MW-23`：实现 primitive tool registry、实体 affordance 和 `use_object` 兼容层。
- 新增 `MW-24`：实现 mobility resolver（车辆、地铁、自行车）及组合动作事件。
- 新增 `MW-25`：实现世界构建草稿的 ToolCompiler，禁止动态代码和未注册副作用。
- 新增 `MW-26`：补充工具提案、失败原子性、重放、兴趣裁剪和 ENV fallback 验收。

当前运行时工具来自固定 PrimitiveRegistry 与已确认的 PublishedRegistry，内置 lamp/bell/door 等只是默认实体；模型返回的任意函数名仍不可作为合法能力。上文车辆时间/资源/天气、人物工具和组合动作均是目标设计，不代表已实现。当前工具 HTTP 入口只接受 YOU/PLAYER_DOLL，参数以 `entityId`、`destinationId`、`stationId` 为准。

### 2026-09-19 实现补充

- `tool-compiler-2` 可以在已有房间内编译实体、A–Y 公开重复日程和公开遭遇候选；先校验类型、动作、路线、角色引用、范围和重复 ID，再产生预览。新增房间/角色、例外日期、非零容差与私密日程明确拒绝。
- 草稿保存在独立表；创建不得覆盖已有 ID。确认时复核内容哈希、基础注册表版本与世界 CAS，并在同一 SQLite 写事务中发布所有定义、事件、回执及删除草稿。跨连接取消不能被缓存复活；并发确认与重启重试返回首次回执。
- 显式更新车辆/交通定义时同步已确认的地点、类型和路线到运行投影；resolver 仍二次校验目的地。定义与可变状态的完整拆分继续列入 MW-23。
- 此切片沿用自有 Python 内核。boardgame.io 源码及 MIT 许可证已下载核对，其 TS/Redux reducer 不直接复制；来源和理由见[源码审计](../research/2026-09-19-source-reuse-audit.md)。

测试及未完成项见[本轮验证记录](../evidence/2026-09-19-world-builder-verification.md)。
