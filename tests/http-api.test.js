import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameServer } from '../server/index.js';
import { GameStore } from '../server/state/game-store.js';
import { RateLimiter } from '../server/rate-limit.js';

const modelScript = () => ({ version: 3, source: 'model', ack: '给你排好这一幕了。', beats: [
  { at: 0, action: 'speak', role: 'A', text: '我先解释。' },
  { at: 200, action: 'use', role: 'YOU', target: 'lamp', verb: 'off' },
  { at: 500, action: 'speak', role: 'ENV', text: '台灯熄灭了。', target: 'lamp' },
] });

function manualComposer() {
  const calls = [];
  const waiting = new Map();
  return {
    calls,
    compose(input, options) {
      return new Promise((resolve) => {
        const call = { input, options, resolve };
        calls.push(call);
        waiting.get(calls.length)?.(call);
      });
    },
    wait(number) {
      if (calls.length >= number) return Promise.resolve(calls[number - 1]);
      return new Promise((resolve) => waiting.set(number, resolve));
    },
  };
}

async function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'voodoo-http-'));
  const dist = join(directory, 'public');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>巫柜测试页</title>');
  writeFileSync(join(dist, 'assets', 'game-test123.js'), 'globalThis.testAsset=true;');
  writeFileSync(join(directory, 'private.txt'), 'PRIVATE_SENTINEL');
  writeFileSync(join(dist, '.env'), 'HIDDEN_SENTINEL');
  symlinkSync(join(directory, 'private.txt'), join(dist, 'escaped.txt'));
  const filename = join(directory, 'state', 'world.sqlite');
  const limiter = options.limiter || new RateLimiter({ perMinute: 100, dailyLimit: 100 });
  let server;
  let base;
  async function start() {
    server = createGameServer({ store: new GameStore({ filename }), dist, configured: () => false, limiter, ...options });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    if (!server?.listening) return;
    const done = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await done;
  }
  await start();
  t.after(async () => { await stop(); rmSync(directory, { recursive: true, force: true }); });
  return {
    limiter,
    async restart() { await stop(); await start(); },
    async request(method, route, { body, cookie, headers = {} } = {}) {
      const response = await fetch(base + route, {
        method, headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const content = await response.text();
      const type = response.headers.get('content-type') || '';
      return { status: response.status, headers: response.headers, text: content, json: type.includes('application/json') && content ? JSON.parse(content) : null };
    },
  };
}
async function session(app) {
  const response = await app.request('POST', '/api/session', { body: {} });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  return { cookie, snapshot: response.json.snapshot, headers: response.headers };
}
function writeBody(snapshot, requestId, text = '让他难受') {
  return { requestId, text, version: snapshot.version, roomId: snapshot.state.stage.roomId,
    present: snapshot.state.stage.present, ambient: snapshot.state.stage.ambient, names: snapshot.state.names };
}

test('HTTP静态首页/HEAD/hash资源可用，点文件、越界路径和越界软链接不可读', async (t) => {
  const app = await fixture(t);
  const root = await app.request('GET', '/');
  assert.equal(root.status, 200);
  assert.match(root.text, /巫柜测试页/);
  assert.match(root.headers.get('content-type'), /text\/html/);
  assert.equal((await app.request('HEAD', '/')).text, '');
  const asset = await app.request('GET', '/assets/game-test123.js');
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('cache-control'), /immutable/);
  for (const route of ['/.env', '/%2e%2e%2fprivate.txt', '/escaped.txt', '/state/world.sqlite', '/%invalid']) {
    const response = await app.request('GET', route);
    assert.ok(response.status >= 400, route);
    assert.ok(!/PRIVATE_SENTINEL|HIDDEN_SENTINEL/.test(response.text), route);
  }
  assert.equal((await app.request('POST', '/')).status, 405);
});

test('session只发HttpOnly cookie，未知凭证清除；本人世界与两个同名玩家隔离', async (t) => {
  const app = await fixture(t);
  assert.equal((await app.request('GET', '/api/session')).status, 401);
  const a = await session(app);
  const b = await session(app);
  assert.match(a.headers.get('set-cookie'), /HttpOnly/);
  assert.match(a.headers.get('set-cookie'), /SameSite=Lax/);
  assert.notEqual(a.cookie, b.cookie);
  assert.equal(a.snapshot.token, undefined);
  const profile = await app.request('POST', '/api/profile', { cookie: a.cookie, body: {
    version: a.snapshot.version, profile: { names: { A: '同名' }, confirmedFacts: ['甲的私事'] },
  } });
  assert.equal(profile.status, 200);
  const own = await app.request('GET', '/api/session', { cookie: a.cookie });
  const other = await app.request('GET', '/api/session', { cookie: b.cookie });
  assert.deepEqual(own.json.snapshot.confirmedFacts, ['甲的私事']);
  assert.deepEqual(other.json.snapshot.confirmedFacts, []);
  for (const cookie of ['hex_session=' + 'z'.repeat(43), 'hex_session=' + a.snapshot.worldId]) {
    const invalid = await app.request('GET', '/api/session', { cookie });
    assert.equal(invalid.status, 401);
    assert.match(invalid.headers.get('set-cookie'), /Max-Age=0/);
  }
  const unknownCreate = await app.request('POST', '/api/session', { cookie: 'hex_session=' + 'z'.repeat(43), body: {} });
  assert.equal(unknownCreate.status, 401);
});

test('无模型write先草稿后确认，重复确认只结算一次且跨玩家不可确认', async (t) => {
  const app = await fixture(t);
  const a = await session(app);
  const b = await session(app);
  const draft = await app.request('POST', '/api/write', { cookie: a.cookie, body: writeBody(a.snapshot, 'local-scene') });
  assert.equal(draft.status, 200);
  assert.equal(draft.json.script.source, 'local');
  assert.equal(draft.json.reason, 'model-not-configured');
  assert.ok(draft.json.turnId);
  assert.equal((await app.request('GET', '/api/session', { cookie: a.cookie })).json.snapshot.state.nights, 0);
  assert.equal((await app.request('POST', '/api/confirm', { cookie: b.cookie, body: { turnId: draft.json.turnId } })).status, 409);
  const confirmed = await app.request('POST', '/api/confirm', { cookie: a.cookie, body: { turnId: draft.json.turnId } });
  const duplicate = await app.request('POST', '/api/confirm', { cookie: a.cookie, body: { turnId: draft.json.turnId } });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.json.snapshot.state.nights, 1);
  assert.equal(duplicate.json.snapshot.version, confirmed.json.snapshot.version);
  assert.equal(duplicate.json.snapshot.state.nights, 1);
  assert.equal(app.limiter.stats().usedToday, 0);
});

test('澄清ask直接结束草稿，不能伪造确认来推进夜数', async (t) => {
  const app = await fixture(t);
  const player = await session(app);
  const response = await app.request('POST', '/api/write', { cookie: player.cookie, body: writeBody(player.snapshot, 'clarify', '你好') });
  assert.equal(response.status, 200);
  assert.ok(response.json.script.ask);
  assert.equal(response.json.turnId, undefined);
  assert.equal(response.json.snapshot.state.nights, 0);
  const confirm = await app.request('POST', '/api/confirm', { cookie: player.cookie, body: { turnId: 'unissued-turn' } });
  assert.equal(confirm.status, 409);
});

test('HTTP生成中取消会传AbortSignal，忽略信号的迟到模型也不能写入草稿', async (t) => {
  const control = manualComposer();
  const app = await fixture(t, { configured: () => true, compose: control.compose });
  const player = await session(app);
  const pending = app.request('POST', '/api/write', { cookie: player.cookie, body: writeBody(player.snapshot, 'cancel-1') });
  const call = await control.wait(1);
  const cancelled = await app.request('POST', '/api/cancel', { cookie: player.cookie, body: { requestId: 'cancel-1' } });
  assert.equal(cancelled.status, 200);
  assert.equal(call.options.signal.aborted, true);
  call.resolve(modelScript());
  const late = await pending;
  assert.equal(late.status, 409);
  assert.equal(late.json.reason, 'cancelled');
  const snapshot = (await app.request('GET', '/api/session', { cookie: player.cookie })).json.snapshot;
  assert.equal(snapshot.state.nights, 0);
  assert.deepEqual(snapshot.memories, {});
});

test('新请求替换旧生成，旧requestId取消和迟到结果不影响新草稿', async (t) => {
  const control = manualComposer();
  const app = await fixture(t, { configured: () => true, compose: control.compose });
  const player = await session(app);
  const oldPending = app.request('POST', '/api/write', { cookie: player.cookie, body: writeBody(player.snapshot, 'old-1') });
  const old = await control.wait(1);
  const latest = (await app.request('GET', '/api/session', { cookie: player.cookie })).json.snapshot;
  const newPending = app.request('POST', '/api/write', { cookie: player.cookie, body: writeBody(latest, 'new-1') });
  const current = await control.wait(2);
  assert.equal(old.options.signal.aborted, true);
  await app.request('POST', '/api/cancel', { cookie: player.cookie, body: { requestId: 'old-1' } });
  assert.equal(current.options.signal.aborted, false);
  current.resolve(modelScript());
  const newDraft = await newPending;
  old.resolve(modelScript());
  assert.equal((await oldPending).status, 409);
  assert.equal(newDraft.status, 200);
  const confirmed = await app.request('POST', '/api/confirm', { cookie: player.cookie, body: { turnId: newDraft.json.turnId } });
  assert.equal(confirmed.json.snapshot.state.nights, 1);
});

test('重复requestId的网络重试不能中断正在生成的同一幕', async (t) => {
  const control = manualComposer();
  const app = await fixture(t, { configured: () => true, compose: control.compose });
  const player = await session(app);
  const body = writeBody(player.snapshot, 'retry-identical');
  const original = app.request('POST', '/api/write', { cookie: player.cookie, body });
  const first = await control.wait(1);
  // 防止有缺陷的服务器启动第二次模型后让测试永久等待：立即释放错误的第二次调用。
  const composeUnexpected = control.wait(2).then((call) => call.resolve(modelScript()));
  void composeUnexpected;
  const duplicate = await app.request('POST', '/api/write', { cookie: player.cookie, body });
  const wasAborted = first.options.signal.aborted;
  first.resolve(modelScript());
  const response = await original;
  assert.equal(duplicate.status, 409);
  assert.equal(wasAborted, false);
  assert.equal(control.calls.length, 1);
  assert.equal(response.status, 200);
  const confirmed = await app.request('POST', '/api/confirm', { cookie: player.cookie, body: { turnId: response.json.turnId } });
  assert.equal(confirmed.json.snapshot.state.nights, 1);
});

test('服务器重启保留已确认故事/夜数，并拒绝重启前未确认草稿', async (t) => {
  const app = await fixture(t);
  const player = await session(app);
  const setup = await app.request('POST', '/api/profile', { cookie: player.cookie, body: {
    version: player.snapshot.version, profile: { dollName: '小夜', confirmedFacts: ['我们曾约定三年。'] },
  } });
  const first = await app.request('POST', '/api/write', { cookie: player.cookie, body: writeBody(setup.json.snapshot, 'first') });
  const confirmed = await app.request('POST', '/api/confirm', { cookie: player.cookie, body: { turnId: first.json.turnId } });
  const draft = await app.request('POST', '/api/write', { cookie: player.cookie, body: writeBody(confirmed.json.snapshot, 'unconfirmed') });
  await app.restart();
  const restored = await app.request('GET', '/api/session', { cookie: player.cookie });
  assert.equal(restored.status, 200);
  assert.equal(restored.json.snapshot.state.nights, 1);
  assert.deepEqual(restored.json.snapshot.confirmedFacts, ['我们曾约定三年。']);
  assert.equal((await app.request('POST', '/api/confirm', { cookie: player.cookie, body: { turnId: draft.json.turnId } })).status, 409);
  const repeat = await app.request('POST', '/api/confirm', { cookie: player.cookie, body: { turnId: first.json.turnId } });
  assert.equal(repeat.json.snapshot.state.nights, 1);
});

test('真实reserveRequest逐次占额，达到dailyLimit后本地降级；单次HTTP不等于一个模型请求', async (t) => {
  const limiter = new RateLimiter({ perMinute: 100, dailyLimit: 2 });
  let executed = 0;
  const compose = async (_input, { budget }) => {
    for (let index = 0; index < 3; index += 1) {
      const reservation = budget.reserveRequest();
      if (!reservation.allowed) throw new Error(reservation.reason);
      executed += 1;
    }
    return modelScript();
  };
  const app = await fixture(t, { limiter, compose, configured: () => true });
  const player = await session(app);
  const response = await app.request('POST', '/api/write', { cookie: player.cookie, body: writeBody(player.snapshot, 'budget-1') });
  assert.equal(response.status, 200);
  assert.equal(response.json.script.source, 'local');
  assert.equal(response.json.reason, 'model-error');
  assert.equal(executed, 2);
  assert.equal(limiter.stats().usedToday, 2);
  assert.equal(limiter.consumeModelRequest().allowed, false);
});

test('跨站POST拒绝，旧version/缺失version不能覆盖新资料或发起旧舞台', async (t) => {
  const app = await fixture(t);
  const player = await session(app);
  assert.equal((await app.request('POST', '/api/profile', { cookie: player.cookie, headers: { origin: 'https://other.example' }, body: { profile: {} } })).status, 403);
  const configured = await app.request('POST', '/api/profile', { cookie: player.cookie, body: { version: player.snapshot.version, profile: { dollName: '新名字' } } });
  assert.equal(configured.status, 200);
  const stale = await app.request('POST', '/api/profile', { cookie: player.cookie, body: { version: player.snapshot.version, profile: { dollName: '旧名字' } } });
  assert.equal(stale.status, 409);
  const staleWrite = await app.request('POST', '/api/write', { cookie: player.cookie, body: writeBody(player.snapshot, 'stale-write') });
  assert.equal(staleWrite.status, 409);
  const missing = await app.request('POST', '/api/profile', { cookie: player.cookie, body: { profile: { dollName: '无版本' } } });
  assert.ok([400, 409].includes(missing.status));
  const missingBody = writeBody(configured.json.snapshot, 'missing-version');
  delete missingBody.version;
  const missingWrite = await app.request('POST', '/api/write', { cookie: player.cookie, body: missingBody });
  assert.ok([400, 409].includes(missingWrite.status));
});
