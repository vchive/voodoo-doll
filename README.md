# 巫柜 · Voodoo Doll

一个移动端优先的开放世界 Galgame 原型。玩家与巫毒娃娃共用一个行动主体，通过叙述
搭建世界、移动到不同地点并接触拥有各自日程和回应边界的角色。未被观察的角色只按
统一世界时间做位置投影；玩家进入兴趣范围后，角色才会激活并参与当前剧情。

## 当前架构

- 前端：TypeScript + PixiJS，构建输出为 `dist-hex/`。
- 权威后端：Python FastAPI World Kernel + SQLite。
- Agent 边界：模型只提交结构化提案；World Kernel 校验能力、在场、可见性、版本和工具参数后原子提交。
- 无模型回退：未配置模型或网络不可用时，本地规则仍可完成单人核心流程。
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
- 匿名 cookie 世界隔离、刷新和 SQLite 重启恢复。
- 当前存档导入导出，以及 `voodoo-hex-v5`、`voodoo-cabinet-v1` 旧档导入。
- 无模型本地规则回退；旧档和非法导入不会覆盖原始浏览器 key。

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

2026-09-20 本地门禁结果为 Python 103/103、Node 79/79，类型检查、两套前端构建和
编译检查通过。Chrome 153 的 320×568、390×844、430×932 三档移动视口仿真已完成故事、
移动、人物回应、刷新恢复和双会话隔离闭环；390×844 还完成了 11 地点移动、离线存档往返、
坏导入恢复和确认响应丢失恢复。这不等于微信 iOS/Android 真机或公网/HTTPS 发布验证。

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
hex/            TypeScript/PixiJS 单人前端和 API 客户端
contracts/      跨语言事件与动作契约
docs/specs/     SDD 需求、方案、任务和验收
server/ shared/ Node/Pi legacy-v2 回滚路径
index.html      早期单娃娃原型入口
```
