# 教程第二天支线回归记录

日期：2026-09-20（Asia/Shanghai）

## 范围

本记录对应 MW-32 / SP-17 / MW-AC-32。验证主线《雨停以前》三种结局之后，玩家可以继续第二天可选支线：回地铁站查旧伞登记、回办公室查旧卡片、回家开门保存记录。支线使用已有移动、观察、询问和物件交互，不生成动态工具或运行时代码。

## 自动化结果

执行：

```text
PYTHONPATH=. python3 -m unittest discover -s backend/tests -p 'test_*.py'
.........................................................................
Ran 138 tests ...
OK

npm test
1..93
# tests 93
# pass 93
# fail 0

npm run typecheck
tsc --noEmit

npm run hex:build
vite ... built in ...

git diff --check
```

Python 的总耗时随本机环境变化；本轮支线专用 `backend.tests.test_narrative` 为 34/34。Node、TypeScript 和 Hex 构建沿用同一工作区回归，未使用模型密钥。

## 关键状态证据

在 `trust` 主线结局之后：

```text
ending=trust
postscript=ready
guidance.objective=回到地铁站，问问周野那把旧伞的来历（可选支线）。
```

周野仍在地铁站时，确认“问周野：伞柄上的日期是什么？”后：

```text
postscript=office
clues=["station-pass"]
ending=trust
```

将周野的公开日程改为全天在家后，确认“去地铁站”再选择“查看失物登记处”：

```text
postscript=office
clues=["station-pass-late"]
dialogue.speakers ⊆ {ENV, YOU}
```

继续“去办公室 → 看看办公桌 → 回家 → 开门”：

```text
postscript=complete
clues ⊇ ["archive-card"]
ending 保持原值
```

支线在办公室状态导出后重新导入，`postscript=office`、地点和主线 `ending` 保持；删除旧存档中的 `postscript` 字段后仍能导入，下一次确认“去地铁站”会补建 `postscript=station`。预览和取消均不写入世界快照。

## 未覆盖范围

本记录没有把桌面浏览器、微信 iOS/Android 真机、公网 HTTPS、断网/响应丢失/存储失败矩阵写成通过。已有主线浏览器记录仍见[短篇验收](2026-09-20-playable-tutorial.md)和[对话窗验收](2026-09-20-galgame-dialogue.md)；支线的这些设备与故障场景进入下一次手工验收。
