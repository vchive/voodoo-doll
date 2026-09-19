// AR-03 · 只在玩家确认后提交世界。草稿永不写入 SQLite。
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { CAST_IDS, RENAMEABLE_IDS, ROOM_IDS, ROOM_SPOT_KEYS, STAGE_IDS, WEATHERS, LIGHTS, emptyStage } from '../../shared/cast.js';
import { isDangerous, validateScript, LIMITS } from '../../shared/script-contract.js';
import { WORLD_REGISTRY_VERSION } from '../../shared/world-registry.js';
import { defaultPolicy, normalizePolicy } from '../policy/content-policy.js';
import { gateInput, gateScript } from '../policy/gate.js';
import { localScript } from '../local-station.js';

const MEMORY_IDS = ['doll', ...CAST_IDS, 'ENV'];
const MEMORY_LIMIT = 24;
const FACT_LIMIT = 24;
const POLICY_AUDIT_LIMIT = 96;
const MAX_JSON_BYTES = 64 * 1024;
const clone = (value) => structuredClone(value);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);

export class StoreError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
    this.status = status;
    this.statusCode = status;
  }
}

function fail(code, message, status) { throw new StoreError(code, message, status); }
function boundedJson(value) {
  let encoded;
  try { encoded = JSON.stringify(value); } catch { fail('INVALID_INPUT', '内容格式不正确。'); }
  if (!encoded || Buffer.byteLength(encoded) > MAX_JSON_BYTES) fail('INPUT_TOO_LARGE', '内容太长了。');
  return encoded;
}
function text(value, max, { optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || isDangerous(value)) {
    fail('INVALID_TEXT', '文字为空、过长或含不支持的标记。');
  }
  return value.trim();
}
function safeLegacyText(value, max) {
  return typeof value === 'string' && value.trim() && !isDangerous(value) ? value.trim().slice(0, max) : null;
}
function namesOf(value) {
  if (!object(value)) fail('INVALID_NAMES', '人物名字格式不正确。');
  const names = {};
  for (const id of RENAMEABLE_IDS) {
    if (value[id] !== undefined && value[id] !== '') names[id] = text(value[id], LIMITS.name);
  }
  return names;
}
function stageOf(raw, prior = emptyStage()) {
  if (!object(raw)) fail('INVALID_STAGE', '舞台格式不正确。');
  const stage = clone(prior);
  if (raw.roomId !== undefined) {
    if (!ROOM_IDS.includes(raw.roomId)) fail('INVALID_ROOM', '没有这个房间。');
    if (stage.roomId !== raw.roomId) stage.poses = {};
    stage.roomId = raw.roomId;
  }
  if (raw.present !== undefined) {
    if (!Array.isArray(raw.present) || raw.present.length > STAGE_IDS.length || raw.present.some((id) => !STAGE_IDS.includes(id))) {
      fail('INVALID_CAST', '在场人物不正确。');
    }
    stage.present = [...new Set(['YOU', ...raw.present])];
    if (stage.present.length > STAGE_IDS.length) fail('INVALID_CAST', '在场人物过多。');
  }
  if (raw.poses !== undefined) {
    if (!object(raw.poses)) fail('INVALID_POSES', '站位格式不正确。');
    stage.poses = {};
    for (const [id, spot] of Object.entries(raw.poses)) {
      if (!stage.present.includes(id) || !ROOM_SPOT_KEYS[stage.roomId].includes(spot)) fail('INVALID_POSES', '人物站位不正确。');
      stage.poses[id] = spot;
    }
  }
  stage.poses = Object.fromEntries(Object.entries(stage.poses).filter(([id, spot]) => stage.present.includes(id) && ROOM_SPOT_KEYS[stage.roomId].includes(spot)));
  if (raw.ambient !== undefined) {
    if (!object(raw.ambient)) fail('INVALID_AMBIENT', '环境格式不正确。');
    for (const [key, options] of [['weather', WEATHERS], ['light', LIGHTS]]) {
      if (raw.ambient[key] !== undefined) {
        if (!options.includes(raw.ambient[key])) fail('INVALID_AMBIENT', '环境状态不正确。');
        stage.ambient[key] = raw.ambient[key];
      }
    }
  }
  return stage;
}
function factsOf(raw) {
  if (typeof raw === 'string') raw = raw.trim() ? [raw] : [];
  if (!Array.isArray(raw) || raw.length > FACT_LIMIT) fail('INVALID_FACTS', '故事记录格式不正确。');
  return [...new Set(raw.map((fact) => text(object(fact) ? fact.text : fact, 600)))];
}
function appendMemory(world, id, line) {
  if (!MEMORY_IDS.includes(id)) return;
  world.memories[id] = [...(world.memories[id] || []), line].slice(-MEMORY_LIMIT);
}
function policyAudit(world, result, phase, at) {
  const entry = {
    phase,
    at,
    policyVersion: result.policyVersion,
    reasonCode: result.reasonCode || null,
    inputHash: result.inputHash || null,
    decision: result.allowed ? 'allowed' : 'fallback',
  };
  world.policyAudit = [...(world.policyAudit || []), entry].slice(-POLICY_AUDIT_LIMIT);
}
function upgradedWorld(raw) {
  const world = object(raw) ? raw : emptyWorld();
  world.worldVersion = Number.isSafeInteger(world.worldVersion) ? world.worldVersion : WORLD_REGISTRY_VERSION;
  world.policy = normalizePolicy(world.policy || {});
  world.targetSets = Array.isArray(world.targetSets) ? world.targetSets : [];
  world.relations = Array.isArray(world.relations) ? world.relations : [];
  world.relationEvents = Array.isArray(world.relationEvents) ? world.relationEvents : [];
  world.policyAudit = Array.isArray(world.policyAudit) ? world.policyAudit.slice(-POLICY_AUDIT_LIMIT) : [];
  return world;
}
function policyFallbackScript(input) {
  const script = localScript({ ...input, text: '让他难受' });
  if (!script || script.ask) fail('POLICY_FALLBACK_FAILED', '安全剧本不可用。', 500);
  return { ...script, source: 'policy-fallback' };
}
function emptyWorld() {
  return {
    state: { stage: emptyStage(), names: {}, nights: 0, doubt: 0, dollName: '', lastNight: null, onboardingPhase: null },
    confirmedFacts: [], memories: {}, log: [], environmentEvents: [],
    worldVersion: WORLD_REGISTRY_VERSION,
    policy: defaultPolicy(),
    targetSets: [], relations: [], relationEvents: [], policyAudit: [],
  };
}
function legacyWorld(raw) {
  boundedJson(raw);
  if (!object(raw) || raw.schemaVersion !== 5) fail('INVALID_LEGACY', '只接受明确的 v5 夜场存档。');
  const world = emptyWorld();
  world.state.dollName = safeLegacyText(raw.dollName, 12) || '';
  world.state.names = {};
  for (const id of RENAMEABLE_IDS) {
    const name = safeLegacyText(raw.names?.[id], 12);
    if (name) world.state.names[id] = name;
  }
  // 旧数据的畸形舞台不导致已有浏览器档被改写；只采用有效部分。
  try { world.state.stage = stageOf(raw.stage || {}); } catch { /* keep safe defaults */ }
  world.state.nights = Number.isFinite(raw.nights) ? Math.min(999, Math.max(0, Math.floor(raw.nights))) : 0;
  world.state.doubt = Number.isFinite(raw.doubt) ? Math.min(10, Math.max(0, raw.doubt)) : 0;
  world.state.onboardingPhase = ['story-told', 'names-confirmed'].includes(raw.onboardingPhase) ? raw.onboardingPhase : null;
  // 未确认的 onboarding 故事不是事实，不借迁移替玩家确认。
  if (raw.onboardingPhase === 'names-confirmed') {
    if (Array.isArray(raw.confirmedFacts)) world.confirmedFacts = factsOf(raw.confirmedFacts);
    else {
      const story = safeLegacyText(raw.story, 600);
      if (story) world.confirmedFacts = [story];
    }
  }
  for (const id of CAST_IDS) {
    if (Array.isArray(raw.memories?.[id])) world.memories[id] = raw.memories[id].map((m) => safeLegacyText(m, 200)).filter(Boolean).slice(-8);
  }
  if (Array.isArray(raw.log)) {
    world.log = raw.log.filter((entry) => entry && (MEMORY_IDS.includes(entry.who) || entry.who === 'you'))
      .map((entry) => ({ who: entry.who, text: safeLegacyText(entry.text, 240), at: Number.isFinite(entry.at) ? entry.at : 0 }))
      .filter((entry) => entry.text).slice(-160);
  }
  const lastText = safeLegacyText(raw.lastNight?.text, 100);
  if (lastText) world.state.lastNight = { night: world.state.nights, text: lastText };
  return world;
}

/**
 * 单机 SQLite 世界存储。token 是 256-bit bearer secret，DB 仅存 SHA-256；
 * worldId/turnId 都不是授权凭证。HTTP 层只用 Authorization/cookie 传 token。
 * filename 必须放在静态服务目录之外；同一 DB 由一个应用进程持有。
 */
export class GameStore {
  constructor({ filename = ':memory:', now = Date.now, draftTtlMs = 5 * 60_000 } = {}) {
    if (!Number.isFinite(draftTtlMs) || draftTtlMs <= 0) fail('INVALID_TTL', '草稿有效期不正确。');
    this.now = now;
    this.draftTtlMs = draftTtlMs;
    this.drafts = new Map();
    if (filename !== ':memory:') {
      filename = resolve(filename);
      mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
    }
    this.db = new DatabaseSync(filename);
    if (filename !== ':memory:') chmodSync(filename, 0o600);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS game_worlds (
        id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, version INTEGER NOT NULL,
        data TEXT NOT NULL, initialized INTEGER NOT NULL DEFAULT 0,
        current_turn TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS game_turns (
        id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES game_worlds(id),
        request_id TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL,
        expires_at INTEGER NOT NULL, UNIQUE(world_id, request_id)
      );
      CREATE INDEX IF NOT EXISTS game_turns_world ON game_turns(world_id);
    `);
    // 没有把输入/剧本草稿写盘。进程重启只恢复确认事实，旧生成全部失效。
    this.transaction(() => {
      this.db.exec("UPDATE game_turns SET status = 'interrupted' WHERE status IN ('generating', 'proposed');");
      this.db.exec('UPDATE game_worlds SET current_turn = NULL, version = version + 1 WHERE current_turn IS NOT NULL;');
    });
  }

  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  authorize(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) fail('UNAUTHORIZED', '存档凭证无效。', 401);
    const row = this.db.prepare('SELECT * FROM game_worlds WHERE token_hash = ?').get(hash(token));
    if (!row) fail('UNAUTHORIZED', '存档凭证无效。', 401);
    return row;
  }

  snapshot(row) {
    const world = upgradedWorld(JSON.parse(row.data));
    return { worldId: row.id, version: row.version, ...clone(world) };
  }

  openSession(token, { legacy } = {}) {
    if (token !== undefined && token !== null && token !== '') return { token, snapshot: this.get(token) };
    const credential = randomBytes(32).toString('base64url');
    const world = legacy === undefined ? emptyWorld() : legacyWorld(legacy);
    const id = randomUUID();
    const at = this.now();
    this.db.prepare('INSERT INTO game_worlds(id, token_hash, version, data, initialized, created_at, updated_at) VALUES(?, ?, 0, ?, ?, ?, ?)')
      .run(id, hash(credential), JSON.stringify(world), legacy === undefined ? 0 : 1, at, at);
    return { token: credential, snapshot: this.get(credential) };
  }

  get(token) { return this.snapshot(this.authorize(token)); }

  checkVersion(row, expectedVersion) {
    if (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || expectedVersion !== row.version)) {
      fail('STALE_VERSION', '舞台已经变化，请使用最新存档。', 409);
    }
  }

  invalidate(row, status = 'superseded') {
    if (!row.current_turn) return;
    this.db.prepare('UPDATE game_turns SET status = ? WHERE id = ? AND world_id = ? AND status IN (\'generating\', \'proposed\')')
      .run(status, row.current_turn, row.id);
  }

  importLegacy(token, legacyState, expectedVersion) {
    const world = legacyWorld(legacyState);
    return this.transaction(() => {
      const row = this.authorize(token);
      this.checkVersion(row, expectedVersion);
      if (row.initialized || row.current_turn) fail('WORLD_EXISTS', '已有存档不会被旧档覆盖。', 409);
      this.db.prepare('UPDATE game_worlds SET data = ?, initialized = 1, version = version + 1, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(world), this.now(), row.id);
      return this.get(token);
    });
  }

  configure(token, patch, expectedVersion = patch?.version) {
    boundedJson(patch);
    if (!object(patch)) fail('INVALID_PROFILE', '资料格式不正确。');
    const result = this.transaction(() => {
      const row = this.authorize(token);
      this.checkVersion(row, expectedVersion);
      const world = upgradedWorld(JSON.parse(row.data));
      if (patch.dollName !== undefined) world.state.dollName = text(patch.dollName, 12, { optional: true });
      if (patch.names !== undefined) world.state.names = namesOf(patch.names);
      if (patch.stage !== undefined) world.state.stage = stageOf(patch.stage, world.state.stage);
      if (patch.confirmedFacts !== undefined || patch.story !== undefined) {
        const facts = factsOf(patch.confirmedFacts ?? patch.story);
        if (JSON.stringify(facts) !== JSON.stringify(world.confirmedFacts)) {
          world.confirmedFacts = facts;
          // 明确纠正故事时清空旧模型记忆，避免旧摘要/转述把错误事实带回。
          // UI 历史保留为历史记录，但从来不重新作为角色 prompt 注入。
          world.memories = {};
          world.state.lastNight = null;
        }
        world.state.onboardingPhase = 'names-confirmed';
      }
      this.invalidate(row);
      this.db.prepare('UPDATE game_worlds SET data = ?, initialized = 1, current_turn = NULL, version = version + 1, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(world), this.now(), row.id);
      return { snapshot: this.get(token), oldTurn: row.current_turn };
    });
    if (result.oldTurn) this.drafts.delete(result.oldTurn);
    return result.snapshot;
  }

  begin(token, { requestId = randomUUID(), input } = {}) {
    boundedJson(input);
    if (!object(input)) fail('INVALID_INPUT', '缺少本幕输入。');
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(requestId)) fail('INVALID_REQUEST_ID', '请求编号不正确。');
    const fingerprint = hash(boundedJson(input));
    let draft;
    let oldTurn;
    this.transaction(() => {
      const row = this.authorize(token);
      const prior = this.db.prepare('SELECT * FROM game_turns WHERE world_id = ? AND request_id = ?').get(row.id, requestId);
      if (prior) {
        const live = this.drafts.get(prior.id);
        if (live && row.current_turn === prior.id && prior.expires_at > this.now() && live.fingerprint === fingerprint) { draft = live; return; }
        fail('REQUEST_REUSED', '这次请求已结束，请重新发起。', 409);
      }
      this.checkVersion(row, input.version ?? input.stateVersion);
      const world = upgradedWorld(JSON.parse(row.data));
      const requestedText = input.text ?? input.playerText;
      const inputPolicy = gateInput(requestedText, { policy: world.policy });
      const privateText = inputPolicy.allowed
        ? text(requestedText, LIMITS.input)
        : inputPolicy.fallbackText;
      let stage = clone(world.state.stage);
      if (input.stage !== undefined) stage = stageOf(input.stage, stage);
      else {
        const scene = {};
        for (const key of ['roomId', 'present', 'ambient']) if (input[key] !== undefined) scene[key] = input[key];
        stage = stageOf(scene, stage);
      }
      const names = input.names === undefined ? world.state.names : namesOf(input.names);
      const memories = clone(world.memories);
      const generationInput = {
        text: privateText, roomId: stage.roomId, present: stage.present, names, ambient: stage.ambient,
        nights: world.state.nights, doubt: world.state.doubt, recentNight: world.state.lastNight?.text ?? null,
        memories, dollMemory: memories.doll || [], confirmedFacts: clone(world.confirmedFacts),
        environmentEvents: clone(world.environmentEvents.filter((event) => event.roomId === stage.roomId).slice(-12)),
        // 此字段只供娃娃。浏览器 log/任意传入 memories 不获得服务端信任。
        history: (memories.doll || []).slice(-12).map((entry) => ({ who: 'doll', text: entry })),
      };
      const turnId = randomUUID();
      const version = row.version + 1;
      const expiresAt = this.now() + this.draftTtlMs;
      draft = {
        turnId, worldId: row.id, version, input: generationInput, stage, names, expiresAt, fingerprint,
        policy: world.policy, inputPolicy, script: null, scriptPolicy: null,
      };
      oldTurn = row.current_turn;
      this.invalidate(row);
      this.db.prepare('INSERT INTO game_turns(id, world_id, request_id, version, status, expires_at) VALUES(?, ?, ?, ?, ?, ?)')
        .run(turnId, row.id, requestId, version, 'generating', expiresAt);
      policyAudit(world, inputPolicy, 'input', this.now());
      this.db.prepare('UPDATE game_worlds SET data = ?, current_turn = ?, version = ?, initialized = 1, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(world), turnId, version, this.now(), row.id);
    });
    if (oldTurn) this.drafts.delete(oldTurn);
    this.drafts.set(draft.turnId, draft);
    return clone({
      turnId: draft.turnId, version: draft.version, input: draft.input, expiresAt: draft.expiresAt,
      policy: { level: draft.inputPolicy.level, fallback: draft.inputPolicy.fallback, reasonCode: draft.inputPolicy.reasonCode, policyVersion: draft.inputPolicy.policyVersion },
    });
  }

  active(token, turnId) {
    const row = this.authorize(token);
    const draft = this.drafts.get(turnId);
    if (!draft || draft.worldId !== row.id || row.current_turn !== turnId || row.version !== draft.version) {
      fail('STALE_TURN', '这一幕已经取消或变化，请重新生成。', 409);
    }
    if (draft.expiresAt <= this.now()) {
      this.transaction(() => {
        this.invalidate(row, 'expired');
        this.db.prepare('UPDATE game_worlds SET current_turn = NULL, version = version + 1 WHERE id = ?').run(row.id);
      });
      this.drafts.delete(turnId);
      fail('TURN_EXPIRED', '这一幕已过期，请重新生成。', 410);
    }
    return { row, draft };
  }

  propose(token, turnId, rawScript) {
    boundedJson(rawScript);
    const { row, draft } = this.active(token, turnId);
    const outputPolicy = gateScript(rawScript, { policy: draft.policy });
    // 共享契约外加在场/本房间约束。模型不能让不在场角色突然行动。
    const raw = outputPolicy.allowed
      ? (object(rawScript) ? clone(rawScript) : {})
      : policyFallbackScript(draft.input);
    if (Array.isArray(raw.beats)) raw.beats = raw.beats.filter((beat) => {
      if (!object(beat)) return false;
      if (beat.action === 'ambient') return beat.role === 'ENV';
      if (!['doll', 'ENV', 'Z', ...draft.stage.present].includes(beat.role)) return false;
      return beat.action !== 'move' || ROOM_SPOT_KEYS[draft.stage.roomId].includes(beat.spot);
    });
    const script = validateScript(raw, { roomId: draft.stage.roomId });
    if (!script) fail('INVALID_SCRIPT', '这一幕的动作不完整，请重试。');
    script.source = safeLegacyText(script.source, 40) || 'unknown';
    if (draft.script && JSON.stringify(draft.script) !== JSON.stringify(script)) fail('DRAFT_EXISTS', '这一幕已生成，请重新开始以修改。', 409);
    this.transaction(() => {
      const current = this.authorize(token);
      if (current.current_turn !== turnId || current.version !== draft.version) fail('STALE_TURN', '舞台已经变化。', 409);
      const world = upgradedWorld(JSON.parse(current.data));
      policyAudit(world, outputPolicy, 'draft', this.now());
      this.db.prepare('UPDATE game_worlds SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(world), this.now(), current.id);
      this.db.prepare('UPDATE game_turns SET status = ? WHERE id = ? AND world_id = ?').run('proposed', turnId, current.id);
    });
    draft.script = script;
    draft.scriptPolicy = outputPolicy;
    return clone({
      turnId, version: draft.version, script, expiresAt: draft.expiresAt,
      policy: { level: outputPolicy.level, fallback: outputPolicy.fallback, reasonCode: outputPolicy.reasonCode, policyVersion: outputPolicy.policyVersion },
    });
  }

  confirm(token, turnId) {
    const authorized = this.authorize(token);
    const settled = this.db.prepare('SELECT status FROM game_turns WHERE id = ? AND world_id = ?').get(turnId, authorized.id);
    if (settled?.status === 'confirmed') return this.get(token);
    const { draft } = this.active(token, turnId);
    if (!draft.script || draft.script.ask) fail('NOT_CONFIRMABLE', '请先生成可以演出的一幕。', 409);
    const finalPolicy = gateScript(draft.script, { policy: draft.policy });
    if (!finalPolicy.allowed) {
      this.transaction(() => {
        const row = this.authorize(token);
        if (row.current_turn !== turnId || row.version !== draft.version) fail('STALE_TURN', '舞台已经变化。', 409);
        const world = upgradedWorld(JSON.parse(row.data));
        policyAudit(world, finalPolicy, 'confirm', this.now());
        this.invalidate(row, 'policy-rejected');
        this.db.prepare('UPDATE game_worlds SET data = ?, current_turn = NULL, version = version + 1, updated_at = ? WHERE id = ?')
          .run(JSON.stringify(world), this.now(), row.id);
      });
      this.drafts.delete(turnId);
      fail('POLICY_REJECTED', '这幕不能确认，已回到安全版本。', 409);
    }
    const snapshot = this.transaction(() => {
      const row = this.authorize(token);
      if (row.current_turn !== turnId || row.version !== draft.version) fail('STALE_TURN', '舞台已经变化。', 409);
      const world = upgradedWorld(JSON.parse(row.data));
      const script = draft.script;
      const at = this.now();
      policyAudit(world, finalPolicy, 'confirm', at);
      world.state.stage = clone(draft.stage);
      world.state.names = clone(draft.names);
      world.state.nights = Math.min(999, world.state.nights + 1);
      if (world.state.nights % 2 === 0) world.state.doubt = Math.min(10, world.state.doubt + 1);
      const night = world.state.nights;
      appendMemory(world, 'doll', `玩家第${night}夜私下说：${draft.input.text}`);
      world.log.push({ who: 'you', text: draft.input.text, at });
      for (const beat of script.beats) {
        if (beat.action === 'move') world.state.stage.poses[beat.role] = beat.spot;
        if (beat.action === 'ambient') {
          for (const key of ['weather', 'light']) if (beat[key]) world.state.stage.ambient[key] = beat[key];
        }
        const event = { ...beat, roomId: draft.stage.roomId, night };
        if (beat.action === 'use' || beat.action === 'ambient') {
          world.environmentEvents.push(event);
          appendMemory(world, 'ENV', JSON.stringify(event));
        }
        // 娃娃语音是玩家的私人交流，不把秘密/建议扩散给舞台人物。
        if (beat.action === 'speak' && beat.role === 'doll') {
          appendMemory(world, 'doll', `娃娃第${night}夜说：${beat.text}`);
        } else if (['speak', 'use', 'move', 'ambient', 'burst', 'shake'].includes(beat.action)) {
          const visible = beat.action === 'speak' ? `第${night}夜虚构舞台，${beat.role}说：${beat.text}` : `第${night}夜舞台动作：${JSON.stringify(beat)}`;
          for (const id of ['doll', ...draft.stage.present]) appendMemory(world, id, visible);
        }
        if (beat.action === 'speak') world.log.push({ who: beat.role, text: beat.text, at: at + beat.at });
      }
      world.environmentEvents = world.environmentEvents.slice(-64);
      world.log = world.log.slice(-160);
      const summary = script.aftermath || [...script.beats].reverse().find((beat) => beat.action === 'speak' && beat.role !== 'doll')?.text || script.ack;
      world.state.lastNight = { night, text: summary };
      this.db.prepare('UPDATE game_worlds SET data = ?, version = version + 1, current_turn = NULL, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(world), at, row.id);
      this.db.prepare('UPDATE game_turns SET status = ? WHERE id = ? AND world_id = ?').run('confirmed', turnId, row.id);
      return this.get(token);
    });
    this.drafts.delete(turnId);
    return snapshot;
  }

  cancel(token, turnId) {
    const result = this.transaction(() => {
      const row = this.authorize(token);
      const turn = this.db.prepare('SELECT status FROM game_turns WHERE id = ? AND world_id = ?').get(turnId, row.id);
      if (!turn) fail('STALE_TURN', '没有这一幕。', 409);
      if (turn.status === 'confirmed') return this.get(token);
      if (row.current_turn === turnId) {
        this.invalidate(row, 'cancelled');
        this.db.prepare('UPDATE game_worlds SET current_turn = NULL, version = version + 1, updated_at = ? WHERE id = ?').run(this.now(), row.id);
      }
      return this.get(token);
    });
    // 只能删除本人草稿；其他玩家的 turnId 不能经过上面的归属检查。
    this.drafts.delete(turnId);
    return result;
  }

  close() { this.drafts.clear(); this.db.close(); }
}
