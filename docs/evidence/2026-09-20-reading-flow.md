# 2026-09-20 · 阅读、选择列表与输入焦点衔接验证

MW-35 / SP-20 / MW-AC-35 当前桌面范围通过：已取得桌面长句分页、滚轮/合成拖动、方向变化、选项翻动、三路线、面板/pending 回归、导入生命周期及 11 项组合输入/焦点复测证据；微信 iOS/Android 真机仍待测。依赖 MW-34；前轮布局/方向证据保留，但不计为本轮行为验证。执行时间为 2026-09-20 UTC（Asia/Shanghai 已跨至 2026-09-21）。

## 本轮范围

用户要求继续完善横屏游玩。本轮针对阅读、滚动、选择列表和输入焦点衔接修复，下列为实现默认，用户未逐项指定：

- 长句尚未看到底时，“继续”先向下滚动一屏，当前句索引不变；到底后的新一次操作才换句，短句不多加一步。明确“提前行动”仍可用。
- 文字滑动/拖动与点击分开，滑动结束不跳句；之后独立点击仍可继续。
- 下方仍有选项时给出提示和可点击翻动入口；翻动只滚动列表，不提交行动。
- 中文输入法确认候选字、组合输入和 Enter repeat 不提前发送预览；组合结束后新操作可正常提交。组合期间 Escape 不关闭编辑面板。
- 面板打开焦点进入、关闭归还；行动预览与取消回到非执行容器，避免同一次 Enter 顺带确认或执行推荐。

不扩写剧情、不改后端、世界规则、时钟或存档协议。阅读/翻动/焦点操作只改变界面，不自动确认 pending。世界自然时间仍由服务端推进。

## 环境与执行记录

| 项目 | 实际记录 |
| --- | --- |
| 浏览器 | Desktop Chrome 153.0.8010.52，无头浏览器；移动尺寸仿真，组合/指针事件为合成事件 |
| 服务与数据 | 阅读路线/补测使用独立 18770、18772 会话；输入与焦点使用独立 18771 会话；生命周期使用独立临时 SQLite。没有通过这些脚本清理用户 18766 的会话或原库 |
| 视口 | 568×320、667×375、844×390 横屏长句/滚轮/拖动/尺寸变化；三档多选翻动；390×844 竖屏面板/pending 回归；三路线通关 |
| 测试命令 | `npm test`：104/104；`npm run typecheck`、`npm run build`、`npm run hex:build`、`python3 -m compileall -q backend` 均通过 |
| 浏览器命令 | `node /tmp/voodoo-reading-flow.mjs`、`node /tmp/voodoo-reading-routes.mjs`、`node /tmp/voodoo-reading-supplement.mjs`、`node /tmp/voodoo-ime-focus-fixed.mjs`、生命周期复测脚本；报告 `errors=[]` |
| 本轮报告 | 已归档为 `2026-09-20-reading-flow-browser.json`、`-routes.json`、`-supplement.json`、`-ime.json`、`-lifecycle.json`；原始脚本仍保留在 `/tmp` |
| 源码标识 | 最终报告 hash：`hex/play.ts` `71f59662d00be414104390505b6c636e72c99796e4aa4b13d02b3f4d8d89b778`；`hex/play.css` `3ae65cf46fb6fe9cc59472d3a2db4241b1245e345b3ed9c6702028631294ab70`；`hex/play-reading.ts` `a326466313e544911d5138fe81d6a55e26b232e2f70e0e4696aef3c2b7cf9e2c` |
| 18766 HTTP | 重新构建后 `curl http://127.0.0.1:18766/healthz` 返回 200、`schemaVersion=4`；仅证明本机 HTTP，不代表公网或微信真机 |

## 验收矩阵

| 子项 | 实际结果 | 尚未覆盖 |
| --- | --- | --- |
| A 长句继续 | 568×320 需 8 次、667×375 需 4 次、844×390 需 4 次继续才滚到底；期间索引保持 0，再一次继续才变为 1。滚轮、拖动、方向/尺寸变化后仍不跳句；世界版本和 POST 数不变 | 真实触摸仍待测 |
| B 滑动不跳句 | 568/667/844 合成 pointerdown/move/up 及滚轮后索引不变，随后独立继续可分页；无请求 | 真实触摸仍待测 |
| C 更多选项 | 三档短屏翻动均可到末项，提示在底部消失并可回顶部；零新增 intent/confirm，焦点留在 `single-guidance`，返回对白不执行。三条完整路线各 21 次行动只产生各 21 组 intent/confirm | 真实触摸仍待测 |
| D 组合输入/Enter | 11 项 IME/焦点报告中，`isComposing`、旧键码 229、显式组合状态和 Enter repeat 均零 intent；组合中的 Escape 保持编辑器。组合结束后新 Enter 各发 1 次 intent、0 次 confirm，按住 Enter 不穿透预览 | 微信 iOS/Android 实际中文候选字、软键盘和浏览器事件顺序 |
| E 焦点交接 | 568/667/844/390×844 三类面板焦点进入并由 Escape/收起回入口；预览聚焦 `intent-preview`，取消回 `single-dialogue`；pending 旋转/刷新取消保留输入、游标和世界版本。导入 5 次、故事库往返 5 次均只保留一个活动阅读 observer/listener | 微信软键盘仍待测 |
| 正常故事回归 | 844×390 trust/车站、667×375 protect/厨房、568×320 audit/车站全部到正确结局；共 455 次阅读，读取不发行动 POST。每条 22 个画面状态、21 次世界行动；无横向溢出，阅读/选项底部控件在视口内 | 自动点击耗时不能作为完整真实阅读时长 |
| 竖屏 | 390×844 本轮正文点击可换至下一句、进入选择不变更世界版本；其多选测试随后主动切到 568×320，不计为 390 多选证据 | 本轮完整竖屏输入/面板/pending 与横竖往返专项 |
| 微信 iOS/Android 真机 | 待测 | 实际中文候选字 Enter、软键盘、触摸滑动及设备安全区 |

## 复现、修正与复测

1. 修复前 568×320 的正文 `scrollHeight=776`、`clientHeight=115`、`scrollTop=0`，直接继续把索引变为 1，跳过未读部分；记录在 `/tmp/voodoo-flow-before.json`。修复后上述 8 页/4 页测试保持句索引，到底后下一次操作才换句。
2. 初测发现组合中的 Enter（包括 229）误发预览、组合 Escape 关闭编辑器，预览/取消后焦点落到 BODY；记录在 `/tmp/voodoo-ime-focus-review.json`。修复后 `/tmp/voodoo-ime-focus-fixed.json` 为 11/11、0 失败，覆盖组合守卫、焦点交接和故事库往返。
3. 本轮单测新增 5 项，104/104。导入/故事库重建在生命周期专项中连续 5 次验证，active reading listener/observer 始终各 1 个；pending 刷新取消保持草稿与游标，intent=1、confirm=0。

## 截图记录

- `reading-flow/reading-568-long.png`、`reading-flow/reading-844-long.png`：长句滚到底后继续入口。
- `ime-focus/ime-cancel-568.png`、`ime-focus/ime-cancel-844.png`：取消回正文。
- `reading-flow/routes-{568,667,844}-choices.png`、`routes-{568,844}-decision.png`：本轮三路线阶段；`supplement-*-options.png` 与 `supplement-*-cancel.png` 为补测截图。

截图为本机临时文件；最终归档路径及人工视觉检查由集成负责人补入。上述 DOM/请求断言是本页通过结论的直接依据。

## 结论与边界

本轮桌面模拟项目通过，MW-35 在桌面范围完成；真实手机触摸、中文输入法、软键盘和安全区仍待测。公网、长篇故事质量、真实游玩时长及旧 v2 剧情缺陷不属于本轮证据，不据此宣称整体预发布完成。
