# 2026-09-20 · 本地预发布启动与教程入口验证

对应 SDD 的单人预发布入口和教程标杆切片。该记录只证明本机 HTTP 启动与接口流程，不代表微信真机、公网 HTTPS 或浏览器自动化验收。

## 启动修复

`npm run prerelease` 原先能够完成 Hex 构建，但直接执行 `python3 backend/run.py` 时将 `backend/` 误作为导入根，导致 `ModuleNotFoundError: No module named 'backend'`。`backend/run.py` 现在在导入应用前把仓库根目录加入 `sys.path`，因此交接文档中的启动命令可以直接执行，不需要调用者额外设置 `PYTHONPATH`。

## HTTP 验证

使用独立临时数据库 `/tmp/voodoo-prerelease-20260920.sqlite` 和端口 `18768` 执行：

```text
WORLD_STATIC_DIR=./dist-hex WORLD_PORT=18768 WORLD_DB_PATH=/tmp/voodoo-prerelease-20260920.sqlite npm run prerelease
GET /healthz -> 200 {"status":"ok","schemaVersion":4}
GET / -> 200 (Hex 静态首页)
GET /api/v4/session -> 200 (创建单人 cookie 会话)
```

随后在同一 cookie 会话中确认 `rainy-office-v1`：

1. 新手故事进入第一章，推荐动作同时包含“观察周围”“去开门，看看里面有啥东西”“等待10分钟”。
2. 故事动作预览返回与确认前相同的 `worldVersion`，没有提前写入世界。
3. 确认“去开门，看看里面有啥东西”后章节进入第二章；确认“去地铁站”后地点为地铁站，推荐动作变为打开玻璃门。

这证明入口能够启动、故事能够开始，且玩家能从推荐动作进入教程。视觉浏览器和真机证据仍沿用各自的待验状态。
