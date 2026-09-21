# 巫柜 · Voodoo Doll

一个移动端优先的开放世界 Galgame 原型。玩家与巫毒娃娃共用一个行动主体，通过叙述
搭建世界、移动到不同地点并接触拥有各自日程和回应边界的角色。未被观察的角色只按
统一世界时间做位置投影；玩家进入兴趣范围后，角色才会激活并参与当前剧情。

## 当前架构

- 前端：TypeScript，默认单人界面融合 PixiJS 俯视场景与人物立绘，共用同一个对白/选择窗。构建输出为 `dist-hex/`。
- 权威后端：Python FastAPI World Kernel + SQLite。
- Agent 边界：模型只提交结构化提案；World Kernel 校验能力、在场、可见性、版本和工具参数后原子提交。
- 无模型回退：服务端未配置模型时仍可完成教程；断开世界服务后可在本机观察、移动、开门和等待，剧情进度保留。
- 回滚路径：Node/Pi `legacy-v2` 代码仍保留，但不是当前单人预发布入口。

架构、需求、任务和验收状态以 [交接文档](docs/HANDOFF.md) 和
[004 SDD 规格](docs/specs/004-multi-agent-world/spec.md) 为准。

## 启动单人预发布

需要 Node.js 22.19+ 和 Python 3.9+。

```bash
npm ci
python3 -m pip install -e 'backend[api,test]'
WORLD_STATIC_DIR=./dist-hex npm run prerelease
```

浏览器打开 `http://127.0.0.1:8000/`。`npm run prerelease` 会先构建 Hex 前端，再由
FastAPI 同源提供页面和产品 API。默认数据库为 `data/world.sqlite3`；可通过
`WORLD_HOST`、`WORLD_PORT`、`WORLD_DB_PATH` 调整。

Python 启动器不会自动读取 Node 的 `.env` 文件。模型密钥和生产配置应通过进程环境、
服务管理器或部署平台注入。核心玩法不要求模型配置。

当前单人闭环支持：

- 首次故事搭建的预览、确认和取消。
- 在地点间移动、询问在场角色、操作已注册物件。
- 三位主要人物的默认立绘与表情、六张场景背景、说话高亮及已确认动作的轻量演出；来源见 [美术署名](CREDITS.md)。没有素材的人物/地点仍可继续文字玩法。
- 探索时看房间与在场人物，对话时看立绘并保留小俯视图；可随时切换视角。点俯视人物先预览交谈，确认后才行动。室内站位是展示布局，不是新的自由行走规则。
- 匿名 cookie 世界隔离、刷新和 SQLite 重启恢复。
- 当前存档导入导出，以及 `voodoo-hex-v5`、`voodoo-cabinet-v1` 旧档导入。
- 无模型本地规则回退；旧档和非法导入不会覆盖原始浏览器 key。
- 离线探索和在线故事分开保存。联网刷新继续保留本机进度；从菜单选择“回到在线故事”时先备份，之后可用“离线备份”导出恢复。

## 验证

```bash
PYTHONPATH=. python3 -m unittest discover -s backend/tests -v
npm test
npm run typecheck
npm run build
npm run hex:build
python3 -m compileall -q backend
node --check app.js
```

可重复的浏览器试玩检查：

```bash
npx playwright install chromium
npm run test:play
```

也可用已安装的 Chrome：`PLAYWRIGHT_CHANNEL=chrome npm run test:play`。脚本会构建前端，
启动随机本机端口、临时 SQLite 和独立浏览器会话，不读取模型配置，也不会连接正在游玩的服务。
报告与截图输出到 `artifacts/playtest/`，临时数据库保留供排查。需要 Python API 依赖；
`PYTHON` 可指定解释器。只重测指定场景时可设置 `PLAYTEST_CASE` 为名称正则。

检查覆盖三种结局 × 两条调查路线、错过时间窗、读完最终对白、导出导入、实际服务重启、
丢响应与取消、离线重连和损坏预览缓存。世界推进通过实际界面操作；损坏缓存与断网是明确注入的故障。
当前执行结果见 [最新交接](docs/HANDOFF.md)。桌面移动视口模拟不代表微信 iOS/Android 真机、
人类完整阅读时长或公网/HTTPS 发布验证。

## 安全与发布边界

- 浏览器产品接口只有 `/api/v4/session` 和 `/api/v4/play/*`。
- 其他 Kernel 与 internal 接口需要 `WORLD_ADMIN_TOKEN`；未配置时保持关闭。
- 写请求校验 `Origin`，请求体默认上限为 1 MiB。
- 正式 HTTPS 环境设置 `WORLD_COOKIE_SECURE=1`。
- 当前预发布只建议单 worker；多 worker 世界协调尚未完成。

当前仍未完成高能力模型动态生成完整世界、WorldObserver 受限修复、003 Python 策略迁移、
微信 iOS/Android 真机和公网 HTTPS 验证。这些项目在 SDD 任务和验收表中保持未完成状态。

## 目录

```text
backend/        Python World Kernel、FastAPI、SQLite 与测试
hex/            TypeScript 单人前端、立绘舞台、旧 PixiJS 模式和 API 客户端
contracts/      跨语言事件与动作契约
docs/specs/     SDD 需求、方案、任务和验收
server/ shared/ Node/Pi legacy-v2 回滚路径
index.html      早期单娃娃原型入口
```
