// 003 · 角色交互微回合
//
// 这是一个与 Pi provider 无关的编排层。它把一次玩家意图拆成：
//   1. YOU 发起请求（由 doll agent 控制）
//   2. 目标角色自主回应
//   3. ENV 对公开动作给出反馈
//   4. 将公开事件和各角色记忆增量返回给确认层
//
// Agents 只返回提案，runtime 不直接写 GameStore。这样取消、超时、重复确认
// 可以在上层保持原子性；没有模型时也可以注入本地 responder。

import { CAST } from '../shared/cast.js';
import {
  DOLL_AGENT_ID,
  ENV_AGENT_ID,
  canonicalActorId,
  isNpcId,
} from '../shared/capabilities.js';
import {
  createInteractionRequest,
  createResponseEvent,
  eventsVisibleTo,
  normalizeInteractionEvent,
  validateInteractionRequest,
  validateInteractionEvent,
} from '../shared/interaction.js';

export class SceneRuntimeError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'SceneRuntimeError';
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, status) {
  throw new SceneRuntimeError(code, message, status);
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function memoryLine(event) {
  if (event.action === 'silence') return `${event.actor}保持沉默。`;
  if (event.action === 'leave') return `${event.actor}离开了现场。`;
  if (event.text) return `${event.actor}：${event.text}`;
  return `${event.actor}执行了${event.action}。`;
}

function responseFor(response, request, stage) {
  if (!response || typeof response !== 'object') return null;
  return createResponseEvent({ ...response, actor: response.actor || request.target, request, source: 'agent' }, { stage });
}

function localResponse(request) {
  // Offline behavior preserves character agency: refusal is a response, not a
  // player-authored line for the target.
  return { actor: request.target, action: 'refuse', text: '我现在不想谈这个。' };
}

export class SceneRuntime {
  constructor({ stage, agents = new Map(), responder, environment, maxResponses = 1, now = Date.now } = {}) {
    this.stage = clone(stage || { roomId: 'bedroom', present: ['YOU'] });
    this.agents = agents instanceof Map ? agents : new Map(Object.entries(agents || {}));
    this.responder = responder;
    this.environment = environment;
    this.maxResponses = Math.max(1, Math.min(4, maxResponses));
    this.now = now;
  }

  async run(rawRequest, { signal } = {}) {
    if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
    const requestValidation = validateInteractionRequest(rawRequest, this.stage);
    if (!requestValidation.valid) fail('INVALID_INTERACTION_REQUEST', requestValidation.errors.join(','));
    const request = createInteractionRequest(rawRequest, this.stage);
    request.id = request.requestId || `interaction-${this.now()}`;
    request.turnId = rawRequest.turnId || request.id;
    request.at = 0;

    const events = [normalizeInteractionEvent({ ...request, source: 'player', id: request.id, turnId: request.turnId }, { stage: this.stage, source: 'player' })];
    const target = canonicalActorId(request.target);
    const agent = this.agents.get(target);
    let response;
    if (agent?.respond) response = await agent.respond({ request: clone(request), visibleEvents: eventsVisibleTo(events, target, this.stage) }, { signal });
    else if (typeof this.responder === 'function') response = await this.responder({ target, request: clone(request), agent }, { signal });
    else response = localResponse(request);
    if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');

    const responseEvent = responseFor(response, request, this.stage);
    if (!responseEvent) fail('INVALID_AGENT_RESPONSE', '目标角色没有提交合法回应。', 422);
    events.push({ ...responseEvent, id: responseEvent.id || `${request.id}:response`, turnId: request.turnId, at: 500 });

    const envActions = events.filter((event) => event.actor === 'YOU' && ['use', 'move'].includes(event.action));
    if (envActions.length) {
      const envRaw = this.environment?.respond
        ? await this.environment.respond({ events: clone(envActions), stage: clone(this.stage) }, { signal })
        : null;
      for (const raw of (Array.isArray(envRaw) ? envRaw : envRaw ? [envRaw] : [])) {
        const environmentEvent = normalizeInteractionEvent({ ...raw, actor: ENV_AGENT_ID, source: 'environment', channel: 'public', roomId: request.roomId, version: 1 }, { stage: this.stage, source: 'environment' });
        if (environmentEvent) events.push({ ...environmentEvent, id: environmentEvent.id || `${request.id}:environment:${events.length}`, turnId: request.turnId, at: 900 });
      }
    }

    const memories = {};
    for (const event of events) {
      const recipients = event.channel === 'private' ? [...new Set([event.actor, event.target].filter(Boolean))] : this.stage.present || [];
      for (const id of recipients) {
        const key = canonicalActorId(id);
        if (!memories[key]) memories[key] = [];
        memories[key].push({ eventId: event.id, text: memoryLine(event), visibility: event.channel });
      }
    }
    return { request, events, memories, stage: clone(this.stage), settlement: 'proposed' };
  }
}

export async function runInteractionTurn(options, request, runtimeOptions) {
  return new SceneRuntime(options).run(request, runtimeOptions);
}
