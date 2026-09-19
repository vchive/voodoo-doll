#!/usr/bin/env node
// 002 · 模型批量对比
//
// 用同一段 prompt 并发打网关，比速度与台词质量。
//
//   node --env-file=.env scripts/bench-models.mjs                       # 测默认候选集
//   node --env-file=.env scripts/bench-models.mjs deepseek-v4-pro gpt-6-astra
//
// 只读环境变量，不打印密钥。

const baseUrl = String(process.env.MODEL_BASE_URL || '').replace(/\/+$/, '');
const apiKey = process.env.MODEL_API_KEY;

if (!baseUrl || !apiKey) {
  console.error('需要 MODEL_BASE_URL 与 MODEL_API_KEY。用 node --env-file=.env 运行。');
  process.exit(1);
}

// 默认候选：新模型 + 各家的中端档 + 之前测过的基准
const DEFAULT_CANDIDATES = [
  // DeepSeek 系列（用户点名）
  'deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v3.2', 'deepseek-chat',
  // 最新旗舰
  'gpt-6-astra', 'claude-fable-5-1', 'claude-opus-5', 'gemini-3.7-flash',
  'qwen3.8-max', 'qwen3.6-max-preview', 'glm-5.3', 'kimi-k3',
  // 快档
  'gpt-5.6-luna', 'gemini-3.6-flash', 'doubao-seed-2-1-turbo-260628', 'MiniMax-M2.5-highspeed',
  // 基准
  'claude-opus-4-8', 'qwen3-max',
];

const candidates = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_CANDIDATES;

// 一场戏的真实输入：三个角色在场，各带记忆
const SYSTEM = `你在一场戏里扮演一个具体的人。你不是助手，不要解释，不要总结。

你的身份：${'他'}（他）
你的性格与立场：你是那个伤害过对方的人。你会辩解、会淡化、会反过来指责，但你不会真的认错。你说话短、不耐烦，被戳中时会停顿。

只输出一个 JSON 对象，不要任何解释或代码块标记：
{ "line": "你的台词", "to": "可选，对谁说" }

规则：
- 台词不超过 60 字，要短、口语、有潜台词。不要写诗，不要一次说三句话。
- 只说你自己的话。绝不替别人说话，也不要描写动作。
- 大部分时候只需要 line，不要加多余字段。
- 绝不要提自己是 AI、模型或程序。`;

const USER = `现在的场景：office
这是第 2 夜

你记得的事：
  - 他知道自己对不起我
  - 他在国外有家庭

刚刚发生的事：
  玩家说：她也在这。我要你让他当着我的面把话说清楚
  （你是第一个开口的人）

现在轮到你。只输出 JSON。`;

async function probe(model) {
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        // 给足预算：deepseek-v4 这类推理模型会先烧掉一串 reasoning_tokens，
        // 预算太小会导致 content 为空（实测 256 时空、2048 时正常）。
        max_tokens: 2048,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: USER },
        ],
      }),
      signal: controller.signal,
    });
    const ms = Date.now() - t0;
    if (!res.ok) return { model, ok: false, ms, err: `HTTP ${res.status}` };
    const data = await res.json();
    const msg = (data.choices && data.choices[0] && data.choices[0].message) || {};
    const text = msg.content || '';
    const reasoning = msg.reasoning_content || msg.reasoning || '';
    const m = String(text).match(/\{[\s\S]*\}/);
    let line = '';
    if (m) {
      try {
        line = JSON.parse(m[0]).line || '';
      } catch {
        line = '';
      }
    }
    return {
      model,
      ok: true,
      ms,
      line: line || String(text).trim().slice(0, 40),
      // 标出推理型：它们的实际延迟包含思考时间，游戏里更明显
      reasoning: reasoning.length,
    };
  } catch (e) {
    return { model, ok: false, ms: Date.now() - t0, err: e.name === 'AbortError' ? '超时(90s)' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

console.log(`\n对比 ${candidates.length} 个模型（并发，同一段 prompt，max_tokens=2048）\n`);

const results = await Promise.all(candidates.map(probe));

results.sort((a, b) => {
  if (a.ok !== b.ok) return a.ok ? -1 : 1;
  return a.ms - b.ms;
});

console.log('模型'.padEnd(32) + '耗时'.padEnd(9) + '思考'.padEnd(8) + '台词');
console.log('─'.repeat(120));
for (const r of results) {
  const name = r.model.padEnd(30);
  const ms = r.ok ? `${(r.ms / 1000).toFixed(1)}s` : '失败';
  const think = r.ok ? (r.reasoning ? `${r.reasoning}字` : '—') : '';
  const text = r.ok ? r.line : `  ❌ ${r.err}`;
  console.log(`${name}${ms.padEnd(9)}${think.padEnd(8)}${text}`);
}

const okCount = results.filter((r) => r.ok).length;
const fastest = results.filter((r) => r.ok).slice(0, 3).map((r) => r.model);
console.log(`\n可用 ${okCount}/${candidates.length}`);
if (fastest.length) console.log(`最快：${fastest.join(', ')}`);
console.log();
