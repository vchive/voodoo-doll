# 新手教程 · 红灯下的第三次回声

本轮实际验证（2026-09-20）：Python 159/159、Node 96/96、类型检查与双构建通过；独立HTTP 220请求覆盖四结局与读档，桌面Chrome完成390×844署名、320×844保护、320×568审计路线。新故事本机闭环通过，整项仍部分完成：长篇内容/时长、微信、公网和完整故障矩阵未完成。见[本轮证据](../../evidence/2026-09-20-signal-story.md)。
更新日期：2026-09-20。当前默认 `templateId=signal-rain-v1`、`version=1`，独立于保留的 `rainy-office-v1/v2`。本轮使用狄更斯《The Signal-Man》的警报、值班和重访结构，改写为现代城市中的档案调查；人物、事故、中文对白及结局为项目新写。约 135 句、4,372 个汉字、20 个服务端步骤仅描述当前文本和状态机规模；尚无完整阅读时长数据，不承诺“足够玩很久”已经达成。

任务追踪：MW-28 → SP-11/SP-14 → MW-AC-28；MW-29 → SP-12/SP-13 → MW-AC-29；MW-30 → SP-15 → MW-AC-30；MW-31 → SP-16 → MW-AC-31。来源见[改编研究](../../research/2026-09-20-signal-man-adaptation.md)，验收见[本轮证据](../../evidence/2026-09-20-signal-story.md)。

## 用户要求与实现默认

用户要求完整可游玩的故事、方便的推荐动作和自由对话、主人公生活职责、NPC 独立日程，以及实际试玩后评测；本轮另外要求到网上找短篇小说融入。选择狄更斯、三日结构、事故时间点、人物关系和具体窗口是实现默认。故事仍处于改写和专项验证阶段，不能把增加文本等同于已经解决内容质量或预发布可用性。

## 故事因果

玩家是档案馆校对员。小墨跟随主人公，帮助区分观察与猜测，不代替玩家选择。首日九点，桌上的便笺要求十点前见林川；旁边通行证印着明日的更正预约日期。它是林川提前送出的纸面预约，不是超自然生成的物件。玩家通过通勤、公开信号记录和事故原稿接近真相。

06-17 暴雨夜，21:11 的红色警报被当成故障；21:14 有微弱的“别下来”；21:17 顾师傅扳下手动红灯，拦住列车，救下隧道口的人。顾师傅是真正的信号员，林川是在办公室改写事故记录的人。林川迫于上级要求把“手动红灯”写成“设备故障”，害怕失业后无力照顾父亲；他的恐惧解释行为，不免除责任。第二天，交班见证人周野保留了交班抄件，沈青则保存录音，并希望保护自己的隐私。玩家只能把确认获得的材料写进最终档案。

第三天核对回执原件后，提前预约的来历得到解释。最后的冲突是如何对待记录和相关的人：共同署名、公开审计或暂存保护。结尾不能声称未取得的交班卡或录音已经入档。原作的致命循环被改为可行动、可承担后果的调查；这不是原作逐章复刻，也不复用现成中文译文。

## 人物与时间表

| 人物 | 身份与诉求 | 教程关键窗口 | 机会关闭后 |
| --- | --- | --- | --- |
| YOU | 档案馆校对员；核对原稿并承担自己的结论 | 从第一日 09:00 开始，移动/交谈/校对共用世界时钟 | 可以继续移动、观察和保存，不重开已完成结局 |
| PLAYER_DOLL | 小墨，跟随主角，提醒证据与时间 | 与 YOU 共用执行入口 | 不读取 NPC 私密思考，不替玩家收集证据 |
| A 林川 | 改写过报告的同事，要照顾父亲 | 第一日 09:00–10:00、第三日 09:00–12:00 办公室 | 按日程离开；关键机会过期直接形成 missed |
| C 周野 | 交班见证人，保留交班抄件 | 第二日已发布日程 09:00–11:00 车站；教程从 10:00 起可赴约 | `missedWindows` 记录 day2-station；只能看公开交班簿 |
| B 沈青 | 保留现场录音并关心隐私的居民 | 第二日 10:00–12:00 厨房 | 记录 day2-kitchen，转档案调查；不能得到录音事实 |
| 顾师傅 | 退休信号员，事故中的手动红灯执行者 | 当前是材料和叙述中的人物，没有独立可操作 NPC 槽位 | 不凭空生成本人当面对白 |

日程为半开区间，服务端统一时钟自然流逝。阅读对白不增加行动耗时，但不暂停世界。当前状态机在合法行动结算后的时钟检查截止；因此跨过截止点的行动也可能结束窗口，预览不是锁定席位。此规则属于当前实现默认，必须在边界测试中明确记录。

## 20 步骤与玩家动作

| 步骤 | 目标地点与动作 | 确认后的状态 |
| --- | --- | --- |
| arrival | 会客厅观察回执/便笺（普通等待不算） | passSeen；tomorrow-review |
| depart | 会客厅开门 | station；不开启下一天 |
| station | 移动到地铁站 | signal-clue |
| signal-clue | 看/使用交班簿或信号机 | signalNotice、manualRed；manual-red、06-17 |
| office | 移动到办公室 | dossier |
| dossier | 查看/使用事故档案夹或办公桌 | dossierRead；receipt 是首日纸面线索 ID，不代表核验回执原件 |
| meeting | 向在场林川问事故 | day1-choice |
| day1-choice | 向林川明确表示署名/审计/保护 | choice 和首日立场线索；day1-home |
| day1-home | 回家 | sleep1；回家本身不跳日 |
| sleep1 | 在家明确睡觉到第二天 | 第 2 日 10:00；day2-start |
| day2-start | 去地铁站或厨房，二选一调查 | day2-station 或 day2-kitchen |
| day2-station | 向周野问询或实际查看公开交班簿 | manualWarning、auditSaved；handover-06-17 |
| day2-kitchen | 在窗口内使用录音机或向沈青问询 | tapeHeard、auditSaved；shen-tape |
| day2-office | 回办公室，将已取得材料校对归档 | auditSaved；evidence-file；sleep2 |
| sleep2 | 先回家，再明确睡觉到第三天 | 第 3 日 09:00；day3-archive |
| day3-archive | 到办公室查看事故档案夹中的回执原件 | receiptSeen；future-receipt；day3-hearing |
| day3-hearing | 向在场林川询问提前送来回执的原因 | day3-decision |
| day3-decision | 向 A 明确 ask/tell 表达最终立场 | finalChoice、ending；day3-home |
| day3-home | 回家收好材料 | complete、completed=true |
| complete | 阅读后记并继续自由探索 | 已有 ending 保留，不再改写 |

标准路线的第二日两种证据是替代调查入口，不声称一条路线取得两种材料。普通观察、等待、开门不取得第二日交班卡/录音；到过地点不等于读过资料。最终选项必须包含明确立场，普通聊天不能自动选 trust，使用门/办公桌也不等于最终决定。

## 事实与结局契约

权威对象为 `WorldState.metadata.narrative`，字段为 `templateId/version/step/day/startedDay/completed/ending/choice/finalChoice/day2Route/facts/clues/missedWindows`。当前 facts 如下：

| 字段 | 含义与获得条件 |
| --- | --- |
| passSeen | 首日已确认观察桌面 |
| signalNotice、manualRed | 在车站明确核对首日信号记录 |
| dossierRead | 首日核对事故原稿 |
| manualWarning | 第二日实际问周野/查看公开交班簿 |
| tapeHeard | 第二日窗口内听录音/问沈青；错过不补 |
| auditSaved | 第二日取得证据或实际整理档案；不等于两条证据齐全 |
| receiptSeen | 只在第三日核对回执原件后为 true |

| 结果 | 当前门槛与实际后果 |
| --- | --- |
| trust | 办公室向 A 明确表示共同署名，且 manualRed+dossierRead 已成立；共同留下更正及双方责任 |
| audit | 办公室向 A 明确要求审计，且 auditSaved 已成立；仅将已得材料提交核验，林川承担岗位后果 |
| protect | 办公室向 A 明确提出保护/暂不公开；材料暂存，公开更正仍未完成 |
| missed | 第一日 10:00 前仍未完成 day1-choice，或第三日 12:00 前仍未完成最终选择；直接 complete+missed，之后任何行动不能覆盖 |

第一日截止适用于 arrival 到 day1-choice 的所有前期步骤，不允许早期绕路无限延后林川。第二日周野过期保留公开交班簿，需要玩家确认实际查看后才获得事实；沈青过期直接转 day2-office，tapeHeard 保持 false。第三日没有林川离场后的桌面代签路径，错过即结束该次教程。结束不删除世界，仍可做普通世界动作。

## 展示、存档与限制

`guidance` 提供 title/chapter/objective/passage/dialogueId/dialogue/actions/journal/playerRoutine/scheduleHint。对话投影依据地点、在场和已得事实，只有 YOU 可显示 thought；旁白动作不放进 NPC 引号。前端阅读游标按 worldId/dialogueId 隔离，不改变 Kernel 世界状态。

新故事定义由 `signal_story.py` 管理，文稿在 `signal_content.py`，`narrative.py` 只派发模板；`gameplay.py` 使用新模板专用耗时与睡觉解析。固定物件为 signal-lever、handover-book、dossier、recorder；新存档导入重新安装这些 canonical 道具而不重置进度。发布/导入 v1、v2 或自定义故事时清理新故事的道具、专属办公桌描述和日程，保护旧档语义。

无模型可运行；不意味着断网时可继续提交同一个服务端世界。使用独立测试世界，不清除用户旧进度。预览/取消/重复确认、SQLite 重启、导入、窗口边界、在场文本和 320/390 布局须有新证据。长篇内容、多轮独立人物路线、真实阅读时长、微信真机、公网和完整网络故障矩阵仍未完成。

## 历史模板

- `rainy-office-v1`：五章短篇，信任/追问/错过与结局后旧伞支线；由原 `narrative.py` v1 处理，MW-32/SP-17/MW-AC-32 保持独立。
- `rainy-office-v2`：历史三日通行证调查、地铁站/厨房入口与 trust/audit/protect/missed；原文稿和存档路径不变。已有四类已知缺陷仍未修复，兼容保留不等于通过。
- 不自动升级模板或重写用户已确认事实。历史测试与浏览器证据只覆盖各自版本，不能替代 signal 的内容与可用性评测。
