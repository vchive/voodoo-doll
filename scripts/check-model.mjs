#!/usr/bin/env node
// 002 · 模型配置自检
//
// 填完 .env 之后跑这个，确认网关能不能调通，不用先把服务端跑起来。
//
//   node --env-file=.env scripts/check-model.mjs
//
// 只读 .env，不打印密钥。

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  bold: '\x1b[1m',
};

const ok = (s) => console.log(`${C.green}✓${C.reset} ${s}`);
const bad = (s) => console.log(`${C.red}✗${C.reset} ${s}`);
const warn = (s) => console.log(`${C.yellow}!${C.reset} ${s}`);
const info = (s) => console.log(`${C.dim}  ${s}${C.reset}`);

const baseUrl = process.env.MODEL_BASE_URL;
const apiKey = process.env.MODEL_API_KEY;
const model = process.env.MODEL_NAME;
const style = String(process.env.MODEL_API_STYLE || 'openai').toLowerCase() === 'anthropic' ? 'anthropic' : 'openai';
const timeout = Number(process.env.MODEL_TIMEOUT_MS) || 8000;

console.log(`\n${C.bold}模型配置自检${C.reset}\n`);

let missing = false;
if (!baseUrl) {
  bad('MODEL_BASE_URL 未设置');
  missing = true;
} else {
  ok(`MODEL_BASE_URL = ${baseUrl}`);
}
if (!apiKey) {
  bad('MODEL_API_KEY 未设置（这是必需的，填进 .env）');
  missing = true;
} else {
  // 只显示长度与前后各 4 位，绝不打印完整密钥
  const masked = apiKey.length > 10 ? `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}` : '…';
  ok(`MODEL_API_KEY 已设置（${apiKey.length} 字符，${masked}）`);
}
if (!model) {
  bad('MODEL_NAME 未设置');
  missing = true;
} else {
  ok(`MODEL_NAME = ${model}`);
}
ok(`MODEL_API_STYLE = ${style}`);
ok(`MODEL_TIMEOUT_MS = ${timeout}`);

if (missing) {
  console.log(`\n${C.yellow}配置不完整。${C.reset}补齐 .env 里的三项后重跑。`);
  console.log(`${C.dim}注意：配置不全时服务端仍可正常启动，只是会回退到本地剧本。${C.reset}\n`);
  process.exit(1);
}

const url = style === 'anthropic' ? `${baseUrl.replace(/\/+$/, '')}/v1/messages` : `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;

const headers = { 'content-type': 'application/json' };
if (style === 'anthropic') {
  headers['x-api-key'] = apiKey;
  headers['authorization'] = `Bearer ${apiKey}`;
  headers['anthropic-version'] = '2023-06-01';
} else {
  headers['authorization'] = `Bearer ${apiKey}`;
}

const body =
  style === 'anthropic'
    ? { model, max_tokens: 512, messages: [{ role: 'user', content: '只回复两个字：在的' }] }
    : {
        model,
        max_tokens: 512,
        messages: [{ role: 'user', content: '只回复两个字：在的' }],
      };

console.log(`\n${C.bold}正在呼叫${C.reset} ${C.dim}${url}${C.reset}`);

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeout);
const started = Date.now();

try {
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
  const elapsed = Date.now() - started;

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    bad(`HTTP ${res.status}（${elapsed}ms）`);
    if (res.status === 401 || res.status === 403) {
      info('密钥无效或没有权限。检查 MODEL_API_KEY 是否完整复制。');
    } else if (res.status === 404) {
      info(`模型名可能不存在：${model}。也可能是端点风格不对，试试 MODEL_API_STYLE=anthropic。`);
    } else if (res.status === 429) {
      info('被限流了，稍后再试。');
    }
    if (text) info(`上游返回：${text.slice(0, 200)}`);
    process.exit(1);
  }

  const data = await res.json();
  const text =
    style === 'anthropic'
      ? (data.content || []).filter((c) => c && c.type === 'text').map((c) => c.text).join('')
      : (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';

  ok(`调用成功（${elapsed}ms）`);
  info(`模型回复：${String(text).trim().slice(0, 80) || '(空)'}`);

  if (elapsed > 5000) {
    warn(`响应 ${elapsed}ms，偏慢。游戏里超过 ${timeout}ms 就会回退本地剧本。`);
  }

  console.log(`\n${C.green}可以用了。${C.reset}启动服务：\n`);
  console.log(`  ${C.bold}node --env-file=.env server/index.js${C.reset}\n`);
} catch (err) {
  const elapsed = Date.now() - started;
  if (err.name === 'AbortError') {
    bad(`超时（${elapsed}ms > ${timeout}ms）`);
    info('网关不可达或模型响应太慢。检查网络，或调大 MODEL_TIMEOUT_MS。');
  } else {
    bad(`请求失败：${err.message}`);
    info('检查 MODEL_BASE_URL 是否正确、网关是否可达。');
  }
  process.exit(1);
} finally {
  clearTimeout(timer);
}
