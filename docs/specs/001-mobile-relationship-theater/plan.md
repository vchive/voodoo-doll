# 技术方案 · 001

状态：设计，尚未实施。需求来源见 [spec.md](spec.md)，当前代码状态见 [HANDOFF](../../HANDOFF.md)。

## 1. 实现策略

保留 Vite + 原生前端，不为本轮强制迁移 React 或更换视觉体系。先把 `app.js` 中状态/存储/仪式与 DOM 绑定分离，再增加人物对与双人舞台。运行时不需要数据库。

建议模块（路径为计划路径，当前不存在）：

- `src/state.js`：状态验证、稳定 ID、人物/关系操作、法力结算；纯函数优先。
- `src/storage.js`：旧档迁移、新档写入、错误结果与恢复策略。
- `src/rituals.js`：固定仪式注册表、输入归一化和状态机。
- `src/director.js`：本地剧本 provider，与后续 HTTP provider 共用契约。
- `src/stage.js`：从模型渲染单/双娃娃与结果，避免 DOM ID 重复。
- `src/ornament.js`：时钟、音频、动画和 wake-lock 生命周期。
- `app.js`：逐步收敛为页面入口与事件协调；保留已有页面 ID 时需避免新旧两套 handler 同时结算。

无需先一次性重构所有代码；各里程碑可独立运行、验证。

## 2. 状态协议 v2

```ts
type Doll = {
  id: string; name: string; avatar: string | null;
  fabric: string; accessory: 'ribbon' | 'bell' | 'none';
  pins: Array<'额头' | '心口' | '手腕'>;
};
type Relationship = {
  id: string; dollIds: [string, string];
  type: '暧昧' | '欺骗' | '背叛' | '甩锅' | '其他';
  label?: string;
  result: 'neutral' | 'pot-pair' | 'knotted' | 'boxed';
  lastRitualId?: string;
};
type SaveV2 = {
  schemaVersion: 2;
  dolls: Doll[];
  activeDollId: string;
  selectedDollIds: string[]; // 单人 1 个，组合 2 个
  relationships: Relationship[];
  mana: number; visits: number; lastVisit: string;
  spellDay: string; spellsToday: number;
  history: Array<{
    id: string; at: string; text: string;
    ritualId?: string; targetIds?: string[]; targetNames?: string[];
  }>;
  ornament: {
    scene: 'amber' | 'moon'; candle: boolean; breath: boolean; sound: boolean;
    mode: 'single' | 'relationship'; dollId?: string; relationshipId?: string;
  };
};
```

约束：1–4 只、ID 唯一；选中 ID/关系端点必须存在且不同；同一无向人物对只建一个关系；历史保留 30 条并保存名字快照；0 是合法法力；每个日期只结算一次恢复。仪式运行时状态不落盘，刷新视为取消。

### 存档迁移

1. 优先读取 `voodoo-cabinet-v2`，先 parse 再验证结构/枚举/范围。
2. 不存在有效 v2 时尝试 v1；使用旧名字/头像/布料/配件创建 `doll-001`，保留法力、日期、记录、摆件开关。
3. 旧针数据优先 `pinParts`；缺失时才按旧 `pins` 数量推导，避免默认空数组覆盖旧值。
4. 验证后一次写入 v2，**不删除 v1**；配额失败时保持旧档与当前会话并告知未持久化，不能显示“已保存”。
5. 重复执行迁移不得再加娃娃、再加法力或覆盖有效 v2。
6. 新版本结构未知时不直接覆盖存档，显示恢复入口；损坏的关系/选中项/摆件引用应修复为有效状态，删除角色留给后续规格。

图片沿用居中裁切，最大 20 MB 输入、384×384 输出；多个头像须覆盖配额测试。异常或过大的已存字符串要在加载时校验，不直接插入 HTML。

## 3. 仪式状态机

```text
idle → preparing → ready → running ⇄ paused → completed → result
            └──────────────→ cancelled ←────────┘
```

- `preparing`：锁定目标 ID、关系和剧本；模型失败转本地剧本，尚不扣费。
- `ready/running`：输入只影响本次进度/动画。选择目标与编辑头像暂时关闭；用户可取消。
- `paused`：pointercancel、页面隐藏、松开长按时暂停；返回后不自动补算隐藏期间进度。
- `completed`：同一 runtime ritual instance 只允许一次成功转换；再次验证目标仍有效、法力足够，然后一次性扣费、写结果与记录、保存。
- `cancelled`：取消、关闭、刷新均不扣法力/不覆盖旧结果。清除 RAF、计时器、监听、临时声音。
- `result`：展示一次结果；重玩创建新的 instanceId，不能复用旧 completion 回调。

仪式名、费用和输入类型来自可信注册表。编剧只改变允许的文案与受限表现枚举，不能改变扣费、执行代码或任意跳转。

## 4. 本地/模型编剧契约

P0：固定本地剧本 + 少量变体。先在代码中实现同样的数据校验，使 P1 只替换生成来源。

计划中的 P1 HTTP 接口：`POST /api/ritual-script`。同源服务端调用供应商，不在浏览器请求模型平台。

```json
{
  "version": 1,
  "requestId": "client-generated-id",
  "ritualId": "blame-loop",
  "roles": ["A", "B"],
  "relationship": "甩锅",
  "mood": "愤怒",
  "style": "荒诞",
  "context": "可选，最多 240 字"
}
```

```json
{
  "version": 1,
  "source": "local",
  "ritualId": "blame-loop",
  "title": "责任永动机",
  "beats": [
    {"role": "A", "text": "这锅我先递过去。"},
    {"role": "B", "text": "巧了，它又回来了。"}
  ],
  "ending": "责任循环系统已闭合。",
  "effect": "pot-pair"
}
```

模型请求不包含头像或真实姓名，页面用 A/B 映射本地昵称；自由文本的发送须在产品中说明，未启用在线编剧时不上传。限制：title ≤24 字，beats ≤3、每句 ≤48 字，ending ≤80 字；role/ritual/effect 必须匹配注册表；禁止返回 HTML/JS/工具指令。服务端和前端都校验；畸形响应直接回退。

默认生成超时 8 秒；准备中允许“直接开始”选择本地版。超时/取消后到达的响应不能替换已开始的剧本。供应商返回失败时禁止无限自动重试。

可选后端环境变量：`MODEL_BASE_URL`、`MODEL_API_KEY`、`MODEL_NAME`。供应商兼容性需单独 adapter；不用目前未确定的某个厂商 SDK 强绑定 P0。

P1 上线前必须配置请求体限制、按来源速率限制、全局并发上限、每日模型请求/费用上限，达到上限返回本地脚本；不在日志保存头像、自由输入或密钥。无账号公网服务优先使用 IP 节流但承认 NAT 共用 IP 的限制，预算上限是最后保护。

## 5. 手机与微信

- viewport-fit、安全区、横竖屏调整、44px 触区；拖动区限定娃娃/封条，其他区域允许纵向滚动。
- input/textarea 至少 16px，避免 iOS 自动放大；弹层考虑键盘遮挡、焦点和关闭入口。
- 所有核心流程通过触控完成，传感器只增强；拒绝权限不反复弹窗。
- 用户点击后才建立/恢复 AudioContext；隐藏暂停，退出关闭；捕获 resume/release 的拒绝，不产生未处理 Promise。
- 常亮请求返回后再次检查当前模式/可见性，不需要时立刻释放；多次进入/退出不会遗留锁。
- 不支持浏览器全屏时使用 fixed 页面内场景；原生全屏退出也需同步 UI 状态。
- 删除 Google Fonts 外部强依赖或改同源字体；首屏核心资源不可依赖境外 CDN。
- IP+HTTP 不保证微信放行或所有增强 API 可用。最终用真实设备从聊天消息打开测试；遇到平台限制记录事实，再安排域名/HTTPS，不承诺绕过。

## 6. 发布设计

P0 无业务后端 ≠ 不需要 HTTP 服务。建议 Node 22 内置 HTTP 静态服务器，只服务构建 `dist/`，Docker 长期运行，默认 8080；服务器当前已有 Docker。

发布任务需要新增（目前不存在）：

- `server.mjs`：只读服务 dist，GET/HEAD、正确 MIME、路径校验、404、`/healthz`；源码/环境变量不在根目录内；静态服务不暴露目录索引。
- `npm start`，构建后提供生产服务；不能用 Vite dev 作为生产入口。
- Dockerfile/Compose：固定可解释的镜像版本，非 root 应用用户、只读构建资源、restart 策略与健康检查；密钥不进镜像。
- 本地构建产物在 CI/开发机生成后发布，或服务器构建；选择一种主路径写清，不假设服务器安装 npm。
- 发布使用版本化目录或带版本标签镜像，记录上一可用版本。外网 HTTP 检查失败时不宣告上线。

首次部署路径建议 `/opt/voodoo-doll`，端口建议 8080；接手重新检查，不覆盖已有 8888 服务。仅为本游戏配置必要的访问；遇到云安全组不可访问时报告具体阻塞，不关闭整个防火墙。

测试链接计划为 `http://115.190.174.39:8080/`，尚不可宣称可用。变更到域名/HTTPS 后存档 origin 会改变，应提前安排说明/迁移。

## 7. 决策记录

| 决策 | 理由 | 状态 |
| --- | --- | --- |
| SDD，先规格后实现 | 用户最新要求 | 已确认 |
| 玩法/摆件优先 | 用户选择 1 和 3，装扮后置 | 已确认 |
| 手机 H5、普通链接 | 用户要求微信发链接即可玩 | 已确认 |
| 4 只管理、2 只同场 | 覆盖多人诉求，同时控制首版交互复杂度 | 默认方案 |
| 先本地编剧，再接模型 | 可离线生成反馈、无需供应商先决条件 | 默认方案 |
| 原生前端分模块 | 在现有可构建代码上增量开发 | 默认方案 |
| 8080 + Docker 静态服务 | 当前服务器有 Docker，端口检查为空 | 默认方案，未部署 |
