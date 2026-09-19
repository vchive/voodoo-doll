# Python World Kernel

Python FastAPI World Kernel 是当前 TypeScript/PixiJS 单人预发布版的权威后端；
Node/Pi `legacy-v2` 仅保留为回滚路径。领域层不依赖模型服务，未配置模型或模型不可用时
仍可使用本地规则完成核心流程。

安装 API 和测试依赖：

```bash
python3 -m pip install -e 'backend[api,test]'
```

从仓库根目录构建前端并启动单人预发布服务：

```bash
WORLD_STATIC_DIR=./dist-hex npm run prerelease
```

默认监听 `0.0.0.0:8000`，SQLite 数据库为 `data/world.sqlite3`。可用
`WORLD_HOST`、`WORLD_PORT`、`WORLD_DB_PATH` 覆盖。Python 启动器不会自动读取
Node 使用的 `.env` 文件；请通过进程环境、服务管理器或部署平台注入这些变量。

The authoritative flow is:

```text
YOU command -> WorldKernel validation -> isolated A/B/C/Z rule response
-> deterministic ENV feedback -> atomic SQLite snapshot + append-only events
```

客户端不能直接提交 A/B/C/Z 的动作。模型适配器只能返回结构化提案，不能获得数据库
句柄或直接写世界状态的权限。未观察角色按统一世界时钟和公开日程投影；玩家进入兴趣
范围后才激活角色执行。

## 单人产品接口与安全边界

- `/api/v4/session` 和 `/api/v4/play/*` 是浏览器可访问的单人产品接口。
- 其余 `/api/v4/*` Kernel 调试接口和 `/internal/*` 需要
  `Authorization: Bearer <WORLD_ADMIN_TOKEN>`。未配置令牌时返回 404，错误令牌返回 403。
- 写请求校验 `Origin`。`WORLD_ALLOWED_ORIGINS` 可配置逗号分隔的允许来源；同源请求仍可用。
- 请求体默认上限为 1 MiB，可用 `WORLD_MAX_BODY_BYTES` 调整。
- 正式 HTTPS 环境应设置 `WORLD_COOKIE_SECURE=1`。
- `WORLD_STATIC_DIR` 指向构建产物目录；静态服务不会暴露父目录、敏感文件或目录列表。

单人接口支持故事预览/确认/取消、行动预览/确认/取消、存档导出，以及 current、
`voodoo-hex-v5`、`voodoo-cabinet-v1` 导入。导入旧档时强制回到 SFW，非法导入不会
覆盖当前世界。

## 004 世界草稿与验证

世界搭建入口为 `POST /api/v4/world-builder/drafts`，只接收声明式实体、公开日程和遭遇；读取预览后使用 `/{draftId}/confirm` 确认，或 `/{draftId}/cancel` 取消。日程/遭遇和实体同事务发布；未确认内容不进入角色上下文，重复确认返回原结果。当前不支持的新房间、角色、例外日期、非零日程容差与私密日程会返回 422。完整状态见 `docs/specs/004-multi-agent-world/`。

运行完整 Python 回归：

```bash
PYTHONPATH=. python3 -m unittest discover -s backend/tests -v
```

2026-09-20 本地结果为 103/103。该结果包含 Kernel、生命周期、ToolCompiler、SQLite
恢复、cookie 会话隔离、current/v5/v1 导入、Origin、请求体限制、管理令牌和静态敏感
路径检查。

当前可以进入本地单人预发布验收，但微信 iOS/Android 真机、公网 HTTPS、多 worker
一致性、完整动态世界搭建、WorldObserver 低频模型与受限修复、003 Python 策略迁移
仍未完成。预发布部署应保持单 worker。
