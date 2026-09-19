# 002 · 服务端

静态服务 + 模型编剧代理。两份职责都是 002 spec 的 P0/P1 要求。

## 跑起来

```bash
npm run hex:serve          # 构建 + 启动
npm start                  # 只启动（需先构建）
```

默认 http://localhost:8080。

**没有配置模型也能正常启动**，`/api/write` 返回本地站剧本。这不是降级妥协，是
spec 的 HF-18 要求，也是一条必须验收的路径。

## 配置模型

```bash
cp .env.example .env       # 填入 MODEL_API_KEY 与 MODEL_NAME
node --env-file=.env server/index.js
```

填完先自检，不用先把服务跑起来：

```bash
node --env-file=.env scripts/check-model.mjs
```

它会确认网关可达、密钥有效、模型名存在，并且**只显示密钥的前后各 4 位**。

### 网关

当前使用的网关是**多协议聚合**的：同一把密钥同时提供 OpenAI 风格与 Anthropic 原生两种端点，
底下可以是 claude / gpt / gemini / glm / kimi / deepseek 等任意模型。

| 变量 | 说明 |
| --- | --- |
| `MODEL_BASE_URL` | 网关地址，不带结尾斜杠 |
| `MODEL_API_KEY` | 形如 `sk-xxxxxxxx` |
| `MODEL_NAME` | 例如 `claude-opus-5`、`gpt-5`、`gemini-2.5-pro`、`glm-4.5`、`kimi-k3` |
| `MODEL_API_STYLE` | `openai`（默认，走 `/v1/chat/completions`）或 `anthropic`（走 `/v1/messages`） |

两种风格的差异由 `server/model.js` 内部消化，对上层完全透明：

|  | OpenAI 风格 | Anthropic 风格 |
| --- | --- | --- |
| 端点 | `POST /v1/chat/completions` | `POST /v1/messages` |
| 认证 | `Authorization: Bearer sk-xxx` | `x-api-key` + Bearer（两个都带） |
| system 提示 | `messages[0]` | 顶层 `system` 字段 |
| 取文本 | `choices[0].message.content` | `content[].text` |

三个必需变量齐了才启用模型；缺任何一个都走本地站。**密钥只在服务端读取**，
不发送到浏览器、不写进日志、不进构建产物。（本机验证：前端产物里搜 `sk-` 只命中一个 CSS 类名。）

## 路由

| 路由 | 说明 |
| --- | --- |
| `GET /` | 构建产物首页 |
| `GET /assets/*` | 带指纹的静态资源，长缓存 |
| `GET /healthz` | `{ ok, contract, model: 'configured' \| 'not-configured' }` |
| `POST /api/write` | 编剧接口，见下 |

## POST /api/write

请求：

```json
{
  "text": "我想让他今晚说不出话",
  "roomId": "bedroom",
  "nights": 2,
  "history": [{ "who": "you", "text": "..." }, { "who": "doll", "text": "..." }]
}
```

响应（**永远 200，永远带一个可用剧本**）：

```json
{
  "ok": true,
  "source": "model",
  "script": {
    "version": 1,
    "source": "model",
    "ack": "你是想让他今晚开不了口。",
    "ask": null,
    "options": [],
    "steps": [
      { "at": 0, "action": "move", "role": "villain", "spot": "window" },
      { "at": 3600, "action": "burst", "role": "villain", "effect": "wave" }
    ],
    "aftermath": "他把想说的话咽了回去。"
  }
}
```

`reason` 字段说明为什么用了本地站：`model-not-configured`、`timeout`、
`model-error`、`invalid-model-output`、`rate-limited`、`daily-budget-exhausted`。

### 为什么失败也返回 200

因为对玩家来说「模型挂了」和「娃娃今天不想说话」不该有区别。任何失败都在服务端
内部消化成一份合规剧本，前端只有一条代码路径。这样前端不需要处理半成品状态，
玩家也不会在情绪最需要出口的时候看到报错。

## 三层防护

**第一层：输入校验**（`shared/script-contract.js` 的 `validateRequest`）
长度上限 200 字、拒绝可执行标记、房间名白名单、历史逐条清洗。

**第二层：输出校验**（同文件的 `validateScript`）
动作/角色/站位/特效全部走白名单；文本长度限制；拒绝 HTML、脚本、外链、模板标记。
模型返回畸形 → 丢弃 → 回退本地站。**不重试**，spec 明确禁止无限重试。

**第三层：限流与预算**（`server/rate-limit.js`）
单 IP 每分钟 20 次、全局每日 300 次。超限不报错，直接给本地站结果。
IP 节流对 NAT 共用出口无效，所以真正的最后保护是每日总量上限。

## 静态服务的边界

- 路径解析后必须仍在 `DIST` 之内，挡 `../` 与编码变体
- 不提供目录列表
- 隐藏文件（`.` 开头）与 `.map` 不对外
- 只接受 GET/HEAD，其余 405
- 请求体按实际字节数计数，不信任 `Content-Length`

## 测试

```bash
# 无模型启动
node server/index.js
curl -s localhost:8080/healthz
curl -s -X POST localhost:8080/api/write -H 'content-type: application/json' \
  -d '{"text":"我想让他今晚说不出话"}' | head -c 200
```

异常路径（上游 500、返回非 JSON、返回含脚本、超时）的验证方式见
`docs/decisions/0001-model-proxy.md`。
