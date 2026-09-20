# 2026-09-20 · 可玩 Galgame 与 Agent 世界源码调研

本轮实际下载并定点阅读了 **inkjs、AI Town、Generative Agents 三个 GitHub 项目**，并读取 **Fate/stay night REMASTERED、STEINS;GATE 的官方产品资料**。没有运行这三套上游项目，没有实玩这两部商业游戏，也没有把第三方源码、剧本文本或美术素材加入本项目。本文是可复核的设计研究，不是本项目功能通过验收的证据。

工作范围对应 004 的 `MW-28 / SP-11 / MW-AC-28`，依赖既有故事确认、行动预览/确认、WorldClock、日程、PresenceProjection 与存档恢复。用户进一步确认的目标是：推荐动作与自由表达并存、主人公有工作/上学等生活主线、教程本身成为有起承转合和结局的可玩游戏。本文件只记录来源、源码结论与设计映射；实现状态由 004 任务/验收和 `HANDOFF.md` 管理。

## 1. 获取方式、版本与许可

2026-09-20 对下列仓库执行 `git clone --depth 1`，均完成检出；随后读取本地 `HEAD`、`origin`、许可证和下文列出的源码片段。临时审计目录为 `/tmp/voodoo-research-OVgZc7/`，不作为产品依赖或长期交付物。可使用表中的提交链接重新取得同一版本。

| 项目与固定提交 | 本轮实际获取 | 许可证正文核对 | 当前采用范围 |
| --- | --- | --- | --- |
| [inkjs](https://github.com/y-lohse/inkjs/tree/6b1153410ab1c4bcfd9ef04eb2f0107f36be7778) · `6b1153410ab1c4bcfd9ef04eb2f0107f36be7778` | 完整浅克隆；`package.json` 版本 `2.4.0`；HEAD 提交日期 2026-09-01 | [`LICENSE.md`](https://github.com/y-lohse/inkjs/blob/6b1153410ab1c4bcfd9ef04eb2f0107f36be7778/LICENSE.md)：MIT，版权 inkle Ltd. 与 inkjs contributors（2017） | 借鉴条件选项、分支执行和进度保存；未新增依赖 |
| [AI Town](https://github.com/a16z-infra/ai-town/tree/8e05997f2409275669c8344b84a51692e83f3f33) · `8e05997f2409275669c8344b84a51692e83f3f33` | 完整浅克隆；HEAD 提交日期 2026-08-25 | [`LICENSE`](https://github.com/a16z-infra/ai-town/blob/8e05997f2409275669c8344b84a51692e83f3f33/LICENSE)：MIT，版权 a16z-infra（2023） | 借鉴输入序号、提交代次、异步操作状态和世界休眠；未接入 Convex |
| [Generative Agents](https://github.com/joonspk-research/generative_agents/tree/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4) · `fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4` | 完整浅克隆，含上游样例模拟数据；HEAD 提交日期 2023-08-11 | [`LICENSE`](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/LICENSE)：Apache-2.0，版权 Joon Sung Park（2023） | 借鉴日程、局部感知和计划/执行分层；未复制运行代码或地图素材 |

MIT 代码若实际复制，须保留版权与许可全文。Apache-2.0 代码若实际复制，须保留许可/适用署名、标明修改，并处理适用的 NOTICE。Generative Agents 的 README 单独感谢背景、家具、角色素材作者；本轮未审计这些素材的逐项许可，不能把根代码许可证当成全部美术素材的复用授权。Fate 与 STEINS;GATE 的资料仅用于研究玩法与叙事结构。

## 2. inkjs：把可选行动做成叙事的一部分

实际阅读：`README.md` 的基本运行方法、`package.json`、`LICENSE.md`，以及下列实现片段。没有安装上游依赖、运行编译器、执行上游测试或验证它与本项目 Python 后端的适配。

| 源码位置与符号 | 源码确实做了什么 | 对本项目的具体启示 |
| --- | --- | --- |
| [`Story.ts:57`](https://github.com/y-lohse/inkjs/blob/6b1153410ab1c4bcfd9ef04eb2f0107f36be7778/src/engine/Story.ts#L57) · `currentChoices`；`:336` · `Continue` | 故事继续产生文本，并提供当前可见选项；隐藏默认选项不会作为用户选项返回 | 每段剧情后给出少量当前能执行的选择，不能把一切交给玩家猜命令 |
| [`Story.ts:915`](https://github.com/y-lohse/inkjs/blob/6b1153410ab1c4bcfd9ef04eb2f0107f36be7778/src/engine/Story.ts#L915) · `ProcessChoice` | 先判断选项条件；一次性选项用访问计数决定是否再出现；未通过条件则不产生该选项 | “问林川那封信”要依赖人物在场、时间窗和已知线索；已办完的工作不再继续推荐 |
| [`Story.ts:1726`](https://github.com/y-lohse/inkjs/blob/6b1153410ab1c4bcfd9ef04eb2f0107f36be7778/src/engine/Story.ts#L1726) · `ChooseChoiceIndex` | 校验选项索引、取得对应选项，再跳转到目标故事路径 | 选项必须有稳定目标和可验证的后果；不能只是把按钮文案填进聊天框然后显示通用旁白 |
| [`StoryState.ts:37`](https://github.com/y-lohse/inkjs/blob/6b1153410ab1c4bcfd9ef04eb2f0107f36be7778/src/engine/StoryState.ts#L37) · `ToJson / LoadJson` | 叙事状态可以序列化/恢复，载入后可通知观察者 | 教程在刷新后应恢复至已确认的节点；实际世界事实仍从 World Kernel 回执恢复 |
| [`Story.ts:1934`](https://github.com/y-lohse/inkjs/blob/6b1153410ab1c4bcfd9ef04eb2f0107f36be7778/src/engine/Story.ts#L1934) · `BindExternalFunctionGeneral / BindExternalFunction` | 外部函数需要显式绑定，区分是否可安全用于预读 | 若未来用 Ink 写长篇，应通过受控桥接提交行动提案；不能把叙事预读当成开门、转移地点或修改关系的提交 |

当前决定：先将本项目教程写成可审查的数据化章节/节点，以既有 Kernel 完成真实行动。inkjs 可以成为后续长篇创作或纯文本原型的候选；本轮不为短篇引入第二套权威存档，也不把 TypeScript 故事 VM 强行移入 Python。是否引入应另做“内容编译、服务端校验、恢复、时间窗、取消不提交”的窄适配实验。

## 3. AI Town：世界模拟、输入提交和模型工作分开

实际阅读：`LICENSE`，`convex/engine/abstractGame.ts`，以及 `convex/aiTown/{game,agent}.ts`、`convex/world.ts`、`convex/agent/memory.ts` 中下列方法。没有配置 Convex、启动世界、执行模型调用或测试吞吐量。

| 源码位置与符号 | 核实结论 | 本项目映射 |
| --- | --- | --- |
| [`abstractGame.ts:22`](https://github.com/a16z-infra/ai-town/blob/8e05997f2409275669c8344b84a51692e83f3f33/convex/engine/abstractGame.ts#L22) · `AbstractGame.runStep` | 读取有序输入；按 tick 处理输入和模拟；一次 step 记录已处理输入、推进时间和 generation 后保存 | 命令、时间变化和结果必须经过同一权威提交，不能前端先变地点再等模型补结果 |
| [`abstractGame.ts`](https://github.com/a16z-infra/ai-town/blob/8e05997f2409275669c8344b84a51692e83f3f33/convex/engine/abstractGame.ts) · `loadEngine / applyEngineUpdate` | 检查 running、预期 generation、时间不能倒退、输入不能重复完成 | 推荐行动和自由输入同样需要版本检查与幂等；旧页面的行动不因曾可见就永远有效 |
| [`game.ts:46`](https://github.com/a16z-infra/ai-town/blob/8e05997f2409275669c8344b84a51692e83f3f33/convex/aiTown/game.ts#L46)、[`:177`](https://github.com/a16z-infra/ai-town/blob/8e05997f2409275669c8344b84a51692e83f3f33/convex/aiTown/game.ts#L177) · `Game.tick` | 设置 16ms tick、1000ms step；tick 遍历玩家、路径、位置、对话和所有 agent | 它是持续模拟的方案；不代表本项目要按同样频率驱动叙事角色 |
| [`agent.ts:52`](https://github.com/a16z-infra/ai-town/blob/8e05997f2409275669c8344b84a51692e83f3f33/convex/aiTown/agent.ts#L52)、[`:238`](https://github.com/a16z-infra/ai-town/blob/8e05997f2409275669c8344b84a51692e83f3f33/convex/aiTown/agent.ts#L238) · `Agent.tick / startOperation` | 在途操作记录 ID、名称和开始时间；未超时则等待；行动、对话生成、会话记忆是不同操作 | 角色状态和模型耗时分离，避免一次按钮触发多个在途回应；超时后有本地回退 |
| [`world.ts:59`](https://github.com/a16z-infra/ai-town/blob/8e05997f2409275669c8344b84a51692e83f3f33/convex/world.ts#L59) · `stopInactiveWorlds` | 按整个世界的 `lastViewed` 判断不活跃并停引擎；heartbeat 可恢复 inactive 世界 | 可参考整体世界休眠；**这不是按玩家距离逐个休眠 NPC** |
| [`memory.ts`](https://github.com/a16z-infra/ai-town/blob/8e05997f2409275669c8344b84a51692e83f3f33/convex/agent/memory.ts) · `rememberConversation / searchMemories` | 对已完成对话做角色视角摘要；向量检索按 `playerId` 过滤后再排序 | 记忆是角色感知后的摘要，不替代实际事件；不能让角色凭空知道其他地点的私密对话 |

修正此前容易混淆的结论：本项目“远处角色只按日程投影、进入兴趣范围才调用角色模型”是本项目根据成本和玩法作出的设计。AI Town 的世界级休眠不能用作这套 NPC 按需激活已经被上游验证的证据。现有 generation/事件提交边界值得保留，当前没有理由为复用 AI Town 而把 Python Kernel 重写为 Convex。

## 4. Generative Agents：有日程的角色并不等于低成本运行

实际阅读：`README.md` 的启动/存储介绍和素材致谢、`LICENSE`，以及下列函数。没有配置模型凭证、安装依赖、启动 Django/Reverie 或播放样例模拟。没有测出任何运行成本、延迟或节省比例。

| 源码位置与符号 | 核实结论 | 本项目映射 |
| --- | --- | --- |
| [`persona.py:185`](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/reverie/backend_server/persona/persona.py#L185) · `Persona.move` | 更新角色时间/坐标，判断新的一天，依次调用 perceive、retrieve、plan、reflect、execute | 角色“知道什么、想做什么、能执行什么”应分层；模型生成意图不等于动作自动成功 |
| [`plan.py:461`](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/reverie/backend_server/persona/cognitive_modules/plan.py#L461) · `_long_term_planning` | 基于起床时间和每日计划生成带持续分钟数的日程；新一天更新身份后仍有沿用 `daily_req` 的 TODO | 可借鉴日程是独立数据的结构；不能声称上游已解决完整跨日人生规划 |
| [`plan.py:931`](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/reverie/backend_server/persona/cognitive_modules/plan.py#L931) · `plan` | 新一天做长期计划，动作结束后定下个行动，遇到事件后可聊天/等待并改计划 | 默认作息提供稳定预期；关键事件可以产生经过校验的例外日程 |
| [`perceive.py:25`](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/reverie/backend_server/persona/cognitive_modules/perceive.py#L25) · `perceive` | 限制视野范围、同 arena、注意力数量和近期事件去重 | 不应把所有世界事件直接塞给每个角色；但这里的感知过滤不等于停止远处角色模型 |
| [`execute.py:15`](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/reverie/backend_server/persona/cognitive_modules/execute.py#L15) · `execute` | 把计划中的地点/物件地址映射成候选格子，再寻路推进坐标 | 先有可寻址实体和规则执行层，不能仅靠一段旁白宣布物件动作发生 |
| [`reverie.py:373`](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/reverie/backend_server/reverie.py#L373) · `ReverieServer.start_server` 的主循环 | 每一模拟步遍历全部 persona 调用 `move`，写 movement 文件，再把统一时间推进 `sec_per_step` | 上游支持统一时间下全员推进；它没有证明“无人看见的 NPC 不运行”的方案 |

适配结论：保留本项目的统一时钟、公开日程、惰性位置投影与兴趣范围激活。长期计划只在世界创建/跨日或关键事件时提出，普通工作时段无需让模型逐分钟“认真工作”。玩家接触角色时再以当前地点、事务事实、角色记忆产生细节。这是基于上游分层经验做的产品设计，仍需本项目生命周期回归证明。

## 5. 两部经典作品：已查官方资料的范围

下列页面于 2026-09-20 实际取得 HTTP 200 并阅读文本。商业作品没有在本轮安装或实玩；以下剧情事实止于官方概要，不能写成已经通关、逐章审读或完成作品评测。

| 作品与来源 | 官方资料支持的事实 | 可借鉴的结构；本项目自己的推导 |
| --- | --- | --- |
| Fate/stay night REMASTERED：[TYPE-MOON 官网](https://typemoon.com/products/f-sn/)、[Introduction](https://typemoon.com/products/f-sn/introduction/)、[Aniplex Steam 产品页](https://store.steampowered.com/app/2396980/Fatestay_night_REMASTERED/)（读取官方 [appdetails](https://store.steampowered.com/api/appdetails?appids=2396980&l=english)） | 官方定位为传奇活剧视觉小说；士郎怀有“正义的伙伴”的理想，平静夜晚卷入圣杯战争，与救下他的剑之从者建立命运联系。Introduction 明列 Fate / Unlimited Blade Works / Heaven's Feel 三路线 | 主人公先有生活和价值追求，异常事件打破生活，关系伙伴使选择有情感分量，路线表达不同立场。**这是叙事提炼，不是对其具体节点条件/存档代码的核验** |
| STEINS;GATE：[MAGES 官方网站](https://steinsgate.jp/)、[Spike Chunsoft Steam 产品页](https://store.steampowered.com/app/412830/STEINSGATE/)（读取官方 [appdetails](https://store.steampowered.com/api/appdetails?appids=412830&l=english)） | 一群年轻人发现能借邮件改变过去的装置，实验卷入更大的阴谋。官方明确 Phone Trigger 可接/忽略电话，收发邮件，日常选择改变剧情结局；为非线性、多结局视觉小说 | 行动可通过角色生活中的媒介呈现。回应、暂缓、没赶上都能产生可读后果；本项目可用便笺、公告、工作任务和相约时间把选项融入生活 |

Fate 官方本次读取到的页面没有给出完整选项树、各路线解锁条件或玩法实现细节，本文不据此推断开放地图、NPC 作息或实时模拟。STEINS;GATE 官方页面写有阅读时长范围，但这不构成本项目教程时长的证据。

与用户偏好对应，教程可参考 Fate 的“日常身份—异常事件—结盟—立场冲突—关系后果”结构；本次具体人物、场景、台词、谜题与结局使用本项目原创内容。不直接以圣杯战争、原作角色对白或美术替代教程创作，也不把这两部商业作品叫作开源项目。

获取时最初尝试 `https://www.fate-sn.com/remastered/` 返回 404，随后找到并实际读取上述 TYPE-MOON 官方页面；404 页面不是证据来源。

## 6. 将研究落实到当前短篇《雨停以前》

当前主任务选定 `rainy-office-v1`《雨停以前》为第一段完整闭环：**雨晨观察/开家门 → 地铁站开玻璃门看告示 → 办公室完成今日校对 → 10 点前找林川，选择相信/追问 → 回家开门读后记**。错过时间也有结局。标准路线 10 次确认动作是当前实现规模，不是 60–120 分钟内容承诺；实际流程、动作数与耗时以实现及试玩记录为准。

| 章节 | 剧情与生活目标 | 教会的玩法 | 应留下的真实后果 |
| --- | --- | --- | --- |
| 雨晨 | 主人公要出门上班，在家发现异常便笺 | 看当前目标、观察环境、打开门 | 取得线索；门状态改变；下一步由“去上班”的生活责任自然引出 |
| 通勤 | 去地铁站，开玻璃门查看告示 | 场景物件、地图移动、推荐动作和自由表达 | 明确看到门后/公告信息；不能只回复通用“脚步回响” |
| 今日工作 | 到办公室完成校对任务 | 主人公也有正事、行动有时间成本 | 工作完成标记真实落盘，不重复完成/反复结算；NPC 同时按自己的表走 |
| 有限的相遇 | 林川在 10 点前有可交谈窗口；玩家询问信件并作出态度选择 | 看 NPC 公开行程、选择有限机会、对话分支 | 按时回应给出信息与关系反馈；迟到则角色确实不在，进入可理解的错过分支 |
| 回到生活 | 回家、开门、阅读后记 | 剧情闭环、记忆与持续世界 | 工作、线索、选择/错过在后记有所回应；刷新恢复；结局后仍可探索同一世界 |

借鉴关系应可追踪：inkjs 的条件选择对应“此刻推荐什么”；Fate 的日常与价值冲突对应“为什么我要去做”；STEINS;GATE 的生活媒介/忽略也有后果对应“错过同样有故事”；Agent 世界源码对应“角色不是为了等玩家才存在”。

### 推荐动作应是经过校验的可玩入口

每个场景优先给 2–4 个明确动作，可按“当前目标、当前物件、当前在场人物、生活安排”排序。每个动作应带具体目标、预计用时或时间窗、简短缘由。这个数量是实现建议，不是上游通用标准。

- “打开地铁站玻璃门，看看告示”应绑定当前场景门与允许动作；成功后给出可观察的环境变化和信息。
- “完成今天的校对”应绑定工作的前置条件与一次性结算；完成后推荐下一目标。
- “问林川那封信的事”只在他确实在场且机会有效时出现；如果界面呈现后时间已过，提交时仍由服务端重新检查并给恢复路线。
- 自由输入始终保留。识别不了的输入应回到可行选项，说明“这里可以做什么”；不能用默认观察掩盖没有执行，也不能为凑回复让模型凭空新增已生效工具。

推荐动作与自由输入最终进入同一个行动预览、确认、Kernel 校验和事件提交路径。脚本只定义意图、节点条件和表现；环境工具仍采用固定原语与实体能力表。未来模型可以提议新物件/能力声明，由 ToolCompiler 校验并确认发布；无需在一轮聊天中动态生成和执行任意工具代码。

### 完整短篇之后怎样扩写

扩写应优先增加下一天的生活与选择后果，再增加地图面积。可以让今日是否完成工作影响明日工作安排，让相信/追问/迟到影响下次见面的方式；再加入第二人物的有限时间线，使玩家必须安排顺序。每次新增章节都带一条可从开始走到结局的路径，以及合理的错过路径。

这会逐步验证预约、工作、通勤、物件探索、关系、消息、改日再见等稳定交互。更长篇幅、多个完整角色路线、跨日剧情均属于后续扩写，本文不把它们记成已经写好或可以游玩。

## 7. 本轮证据与未验证项

本轮研究已完成：3 个源码仓库下载；3 份代码许可证核对；上述函数/片段阅读；2 部作品官方资料阅读；与当前教程方案逐章映射。研究未完成项：上游测试/部署、商业游戏实玩、运行时性能比较、第三方代码适配实验。本项目首个短篇的自动化与浏览器验收另见[实际可玩证据](../evidence/2026-09-20-playable-tutorial.md)，研究资料本身不能作为产品验收证据。

本项目的验证准则为：推荐动作全部真实可执行；用户原句“去开门，看看里面有啥东西”在地铁站命中当地门；正常/迟到都有结局；等待确实推进世界时间；NPC 按日程离开；主人公工作只结算一次；未知输入给可行选项；刷新恢复和取消不推进；无模型可玩；390×844 与 320×568 不遮挡关键选择。当前覆盖及未测边界以上述实际证据为准。测试不能只证明文本被渲染，应同时检查世界状态/事件和玩家可见后果。

### 本地核对用 SHA-256

| 文件 | SHA-256 |
| --- | --- |
| inkjs `LICENSE.md` | `040e957a77e3e19432e265cb549d5c3b4ca6f3551e24d22b81785ffd1bc2b67b` |
| inkjs `src/engine/Story.ts` | `f14f16ef055d57bd54abfbb96e352fe47e38452deeca6a9692fd4d4a55668fdc` |
| inkjs `src/engine/StoryState.ts` | `1606c4d459db538e2cc07c88aa0e2881a5c4a2733794667c3886b8bcca8c7411` |
| AI Town `LICENSE` | `9930be850173b81feab38afc429f798f0bb79aa50bb26138e9713d8767bec177` |
| AI Town `convex/engine/abstractGame.ts` | `9e115dacfffc46c03b2134bf20f7f21b64cff933fa74e2777881626f6669a9c1` |
| AI Town `convex/aiTown/game.ts` | `75765dd1289d768081ed6ff78f474e5ab0006d3ddea3f5174e1bf6f488cbcb8f` |
| AI Town `convex/aiTown/agent.ts` | `1907d0ce505ff461553d17cfcac83729765c65ea41779b76916f3064cdad801f` |
| AI Town `convex/world.ts` | `e2496188ae5b6ce064d3e45e9813aae8e4aec96a4735977d0fb50e0f425565dd` |
| AI Town `convex/agent/memory.ts` | `b599dfe79eef2b617baf5eb832f1b4b0130b1ae63a0cb9094bedee000c19a43e` |
| Generative Agents `LICENSE` | `171fd8201c63d379bccf5a770b26c6c535f33be98f541c02b5d069937070f32b` |
| Generative Agents `reverie/backend_server/reverie.py` | `3da30a2b9504ab7951dc702cef6e75b596850435b0310c553d51320238060a1a` |
| Generative Agents `reverie/backend_server/persona/persona.py` | `02f9ee127aec991f8212fd1ee31aa320a6b866358703ffe9b1ed2e6f1af21226` |
| Generative Agents `reverie/backend_server/persona/cognitive_modules/plan.py` | `d0cf387a9015750b05606693d126d1d5e1c2d12b95a85b22937a2b3d8b14042a` |
| Generative Agents `reverie/backend_server/persona/cognitive_modules/perceive.py` | `e0243136ac0bd78fd39e38c3dcb8239a219e9da1398a3d9d0224c2785befe29a` |
| Generative Agents `reverie/backend_server/persona/cognitive_modules/execute.py` | `1696505486cc71bb6a7a125a2da06f1a56d8c80d696d0c897f81e703cbeff8ac` |

官方响应保存于临时审计目录 `official/`，以下哈希只标识本次响应，页面以后变化不意味着本次记录错误：

| 官方响应 | SHA-256 |
| --- | --- |
| `fate-home.html` | `31be5e9a04f1e799f94a9b26847d309c72eabd0a05d102a140b24bb6eecac9f6` |
| `fate-introduction.html` | `3f8dc912c4a1ab9566eaf6690b6060969c6d5b624b3dc24099387c54b7cbcaa8` |
| `fate-steam.json` | `110a2f5916491d6051f4010f51f93204e632d9d7c60a4e1a6efea5a183f0d147` |
| `steinsgate-home.html` | `d35718002009159b0a40a9e6e917327d9cb2213404ef6c42ae5d8aa0aba3cbb5` |
| `steinsgate-steam.json` | `50a62436d6e837aaf7edeab19f2ffe26258e9dd29f4e1cbec98bada538debe81` |
