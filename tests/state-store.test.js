import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GameStore, StoreError } from '../server/state/game-store.js';

function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'voodoo-state-'));
  const filename = join(directory, 'world.sqlite');
  let store = new GameStore({ filename, ...options });
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  return {
    get store() { return store; }, filename,
    restart() { store.close(); store = new GameStore({ filename, ...options }); return store; },
  };
}
const script = () => ({
  version: 3, source: 'test', ack: '这是一场虚构的小戏。',
  beats: [
    { at: 0, action: 'speak', role: 'doll', text: '只有你知道的暗号。' },
    { at: 100, action: 'move', role: 'A', spot: 'door' },
    { at: 200, action: 'speak', role: 'A', text: '我先解释。' },
    { at: 300, action: 'speak', role: 'B', text: '我听见你的解释了。' },
    { at: 400, action: 'use', role: 'YOU', target: 'lamp', verb: 'off' },
    { at: 500, action: 'speak', role: 'ENV', text: '台灯熄灭了。', target: 'lamp' },
    { at: 600, action: 'ambient', role: 'ENV', light: 'off' },
  ], aftermath: '这出戏演完了。',
});
const input = (text = '这是我只告诉娃娃的秘密。') => ({ text });
const errorCode = (code) => (error) => error instanceof StoreError && error.code === code;

test('凭证是随机 bearer secret；worldId/turnId/他人凭证不能访问或确认', (t) => {
  const { store } = fixture(t);
  const a = store.openSession();
  const b = store.openSession();
  assert.match(a.token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a.token, b.token);
  assert.throws(() => store.get(a.snapshot.worldId), errorCode('UNAUTHORIZED'));
  assert.throws(() => store.openSession('z'.repeat(43)), errorCode('UNAUTHORIZED'));
  const turn = store.begin(a.token, { input: input() });
  store.propose(a.token, turn.turnId, script());
  assert.throws(() => store.confirm(b.token, turn.turnId), errorCode('STALE_TURN'));
  assert.throws(() => store.cancel(b.token, turn.turnId), errorCode('STALE_TURN'));
  assert.equal(store.confirm(a.token, turn.turnId).state.nights, 1);
  assert.equal(store.get(b.token).state.nights, 0);
});

test('生成与预演不改变世界，确认一次性提交，返回副本不能篡改存储', (t) => {
  const { store } = fixture(t);
  const { token } = store.openSession();
  store.configure(token, { names: { A: '同名', B: '另一个' }, stage: { present: ['YOU', 'A', 'B'] }, confirmedFacts: ['我们一起生活了三年。'] });
  const before = store.get(token);
  const turn = store.begin(token, { input: { ...input(), version: before.version } });
  assert.deepEqual(store.get(token).state, before.state);
  const proposal = store.propose(token, turn.turnId, script());
  proposal.script.beats[2].text = '篡改';
  assert.deepEqual(store.get(token).memories, {});
  assert.equal(store.get(token).state.nights, 0);
  const committed = store.confirm(token, turn.turnId);
  assert.equal(committed.state.nights, 1);
  assert.equal(committed.state.stage.poses.A, 'door');
  assert.equal(committed.state.stage.ambient.light, 'off');
  assert.ok(committed.memories.A.some((line) => line.includes('我先解释。')));
  assert.ok(!JSON.stringify(committed).includes('篡改'));
  const again = store.confirm(token, turn.turnId);
  assert.equal(again.version, committed.version);
  assert.equal(again.state.nights, 1);
  committed.state.nights = 99;
  assert.equal(store.get(token).state.nights, 1);
});

test('公开台词仅在场者记住；玩家故事/娃娃私语不进入NPC或ENV', (t) => {
  const { store } = fixture(t);
  const { token } = store.openSession();
  store.configure(token, { stage: { present: ['YOU', 'A', 'B'] }, confirmedFacts: ['我自己的早年经历。'] });
  const turn = store.begin(token, { input: input('隐秘计划只说给娃娃。') });
  store.propose(token, turn.turnId, script());
  const result = store.confirm(token, turn.turnId);
  assert.ok(result.memories.doll.some((line) => line.includes('隐秘计划')));
  assert.ok(result.memories.A.some((line) => line.includes('我听见你的解释了')));
  assert.ok(result.memories.B.some((line) => line.includes('我先解释')));
  assert.equal(result.memories.C, undefined);
  for (const id of ['A', 'B', 'ENV']) {
    const visible = JSON.stringify(result.memories[id]);
    assert.ok(!visible.includes('隐秘计划'));
    assert.ok(!visible.includes('早年经历'));
    assert.ok(!visible.includes('暗号'));
  }
  assert.ok(!JSON.stringify(result.memories.ENV).includes('解释'));
  const next = store.begin(token, { input: input('继续。') });
  assert.deepEqual(next.input.confirmedFacts, ['我自己的早年经历。']);
  assert.ok(next.input.dollMemory.some((line) => line.includes('隐秘计划')));
  assert.ok(next.input.environmentEvents.every((event) => ['use', 'ambient'].includes(event.action)));
});

test('新turn与取消拒绝迟到剧本，旧取消也不能取消新turn', (t) => {
  const { store } = fixture(t);
  const { token } = store.openSession();
  const old = store.begin(token, { input: input('旧输入') });
  const current = store.begin(token, { input: input('新输入') });
  assert.throws(() => store.propose(token, old.turnId, script()), errorCode('STALE_TURN'));
  store.cancel(token, old.turnId);
  store.propose(token, current.turnId, script());
  store.cancel(token, current.turnId);
  assert.throws(() => store.confirm(token, current.turnId), errorCode('STALE_TURN'));
  assert.deepEqual(store.get(token).memories, {});
  assert.equal(store.get(token).state.nights, 0);
});

test('过期草稿不结算，服务端version拒绝旧客户端提交', (t) => {
  let now = 10_000;
  const { store } = fixture(t, { now: () => now, draftTtlMs: 100 });
  const { token, snapshot } = store.openSession();
  const turn = store.begin(token, { input: input() });
  store.propose(token, turn.turnId, script());
  now += 100;
  assert.throws(() => store.confirm(token, turn.turnId), errorCode('TURN_EXPIRED'));
  assert.equal(store.get(token).state.nights, 0);
  assert.throws(() => store.configure(token, { dollName: '旧更新' }, snapshot.version), errorCode('STALE_VERSION'));
  assert.throws(() => store.begin(token, { input: { ...input(), version: snapshot.version } }), errorCode('STALE_VERSION'));
});

test('重启恢复已确认事实与记忆，未确认输入从未写入DB并失效', (t) => {
  const context = fixture(t);
  const { token } = context.store.openSession();
  context.store.configure(token, { dollName: '小夜', confirmedFacts: ['三年的约定。'] });
  const first = context.store.begin(token, { input: input('第一幕已确认。') });
  context.store.propose(token, first.turnId, script());
  context.store.confirm(token, first.turnId);
  const pending = context.store.begin(token, { input: input('NEVER_PERSIST_PRIVATE_DRAFT') });
  context.store.propose(token, pending.turnId, script());
  const store = context.restart();
  const result = store.get(token);
  assert.equal(result.state.nights, 1);
  assert.deepEqual(result.confirmedFacts, ['三年的约定。']);
  assert.ok(result.memories.doll.some((line) => line.includes('第一幕已确认')));
  assert.throws(() => store.confirm(token, pending.turnId), errorCode('STALE_TURN'));
  assert.ok(!readFileSync(context.filename).toString().includes('NEVER_PERSIST_PRIVATE_DRAFT'));
  assert.equal(store.confirm(token, first.turnId).state.nights, 1);
});

test('显式事实更正替换旧事实并清除旧模型摘要，不让log作为prompt回流', (t) => {
  const { store } = fixture(t);
  const { token } = store.openSession();
  store.configure(token, { confirmedFacts: ['约定了三年。'] });
  const first = store.begin(token, { input: input('约定了三年。') });
  store.propose(token, first.turnId, script());
  store.confirm(token, first.turnId);
  const pending = store.begin(token, { input: input() });
  const corrected = store.configure(token, { confirmedFacts: ['我说错了，是两年。'] }, store.get(token).version);
  assert.deepEqual(corrected.confirmedFacts, ['我说错了，是两年。']);
  assert.deepEqual(corrected.memories, {});
  assert.ok(corrected.log.some((entry) => entry.text.includes('三年'))); // UI历史可看，模型不再接收
  assert.throws(() => store.propose(token, pending.turnId, script()), errorCode('STALE_TURN'));
  const next = store.begin(token, { input: input('继续。') });
  assert.ok(!JSON.stringify(next.input).includes('三年'));
});

test('同名角色按玩家隔离，伪造浏览器memory/facts/nights不覆盖权威数据', (t) => {
  const { store } = fixture(t);
  const a = store.openSession();
  const b = store.openSession();
  store.configure(a.token, { names: { A: '同名' }, confirmedFacts: ['A玩家的私事。'] });
  store.configure(b.token, { names: { A: '同名' }, confirmedFacts: ['B玩家的私事。'] });
  const first = store.begin(a.token, { input: input('A私信。') });
  store.propose(a.token, first.turnId, script());
  store.confirm(a.token, first.turnId);
  const second = store.begin(b.token, { input: { ...input('B私信。'), memories: { A: ['伪造摘要'] }, confirmedFacts: ['伪造事实'], nights: 999, history: [{ who: 'you', text: '伪造日志' }] } });
  const encoded = JSON.stringify(second.input);
  assert.ok(encoded.includes('B玩家的私事'));
  assert.ok(!encoded.includes('A玩家的私事'));
  assert.ok(!encoded.includes('A私信'));
  assert.ok(!encoded.includes('伪造'));
  assert.equal(second.input.nights, 0);
});

test('v5只允许一次显式迁移，旧角色摘要保持归属，不能覆盖已有世界', (t) => {
  const { store } = fixture(t);
  const legacy = {
    schemaVersion: 5, dollName: '旧娃娃', onboardingPhase: 'names-confirmed', nights: 3, doubt: 2,
    stage: { roomId: 'bar', present: ['YOU', 'A', 'B'], poses: { A: 'bar' } },
    names: { A: '旧名' }, memories: { A: ['A自己的旧记忆'], B: ['B自己的旧记忆'] },
    lastNight: { night: 3, text: '旧的一幕' }, story: '',
  };
  const immutableCopy = structuredClone(legacy);
  const { token } = store.openSession();
  const migrated = store.importLegacy(token, legacy, 0);
  assert.deepEqual(legacy, immutableCopy);
  assert.equal(migrated.state.nights, 3);
  assert.equal(migrated.state.stage.roomId, 'bar');
  assert.deepEqual(migrated.memories.B, ['B自己的旧记忆']);
  assert.deepEqual(migrated.confirmedFacts, []);
  assert.throws(() => store.importLegacy(token, legacy), errorCode('WORLD_EXISTS'));
  assert.throws(() => store.openSession(undefined, { legacy: { ...legacy, schemaVersion: 4 } }), errorCode('INVALID_LEGACY'));
});

test('requestId幂等且不重复结算，资料非法变更不破坏有效草稿', (t) => {
  const { store } = fixture(t);
  const { token } = store.openSession();
  const args = { requestId: 'request-1', input: input() };
  const first = store.begin(token, args);
  assert.deepEqual(store.begin(token, args), first);
  assert.throws(() => store.begin(token, { ...args, input: input('不是同一个输入') }), errorCode('REQUEST_REUSED'));
  assert.throws(() => store.configure(token, { stage: { roomId: 'not-a-room' } }), errorCode('INVALID_ROOM'));
  store.propose(token, first.turnId, script());
  assert.equal(store.confirm(token, first.turnId).state.nights, 1);
  assert.throws(() => store.begin(token, args), errorCode('REQUEST_REUSED'));
});

test('契约过滤离场角色、错误站位、伪装环境；反问不能直接确认结算', (t) => {
  const { store } = fixture(t);
  const { token } = store.openSession();
  const turn = store.begin(token, { input: input() });
  const malicious = script();
  malicious.beats.push({ at: 700, action: 'speak', role: 'C', text: '我没有入场。' });
  malicious.beats.push({ at: 800, action: 'move', role: 'A', spot: 'bar' });
  malicious.beats.push({ at: 900, action: 'ambient', role: 'A', weather: 'snow' });
  const proposal = store.propose(token, turn.turnId, malicious);
  assert.ok(!proposal.script.beats.some((beat) => beat.role === 'C' || beat.role === 'B' || beat.spot === 'bar' || beat.weather === 'snow'));
  store.cancel(token, turn.turnId);
  const question = store.begin(token, { input: input() });
  store.propose(token, question.turnId, { version: 3, ask: '想先怎么演？', options: ['先解释', '先关灯'] });
  assert.throws(() => store.confirm(token, question.turnId), errorCode('NOT_CONFIRMABLE'));
  assert.equal(store.get(token).state.nights, 0);
});
