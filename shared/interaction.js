// 003 · 角色间交互事件契约（前后端共用）
//
// 交互是一件“提案中的事实”：先由服务端校验和编排，再由确认层写入世界。
// 玩家只能以 YOU 发起请求；目标角色决定是否回答、拒绝、撒谎、反问、沉默
// 或离开。私密事件只投递给明确的收件人，不把玩家私话广播给其他角色。

import { CAST, STAGE_IDS, ROOM_IDS, isSpeakerId } from './cast.js';
import { isDangerous } from './script-contract.js';
import {
  CAPABILITIES_VERSION,
  DOLL_AGENT_ID,
  ENV_AGENT_ID,
  RESPONSE_ACTIONS,
  REQUEST_ACTIONS,
  canonicalActorId,
  canInitiate,
  canPlayerControl,
  canRespond,
  capabilityFor,
  isCharacterId,
  isNpcId,
} from './capabilities.js';

export const INTERACTION_VERSION = 1;
export const INTERACTION_CHANNELS = Object.freeze(['public', 'private', 'system']);
export const INTERACTION_SOURCES = Object.freeze(['player', 'agent', 'environment']);
export const EVENT_LIMITS = Object.freeze({ text: 240, id: 100, turnId: 100, audience: 8 });

const object = (value) => value && typeof value === 'object' && !Array.isArray(value);

function safeText(value, max = EVENT_LIMITS.text) {
  if (typeof value !== 'string') return null;
  const result = value.trim();
  if (!result || result.length > max || isDangerous(result)) return null;
  return result;
}

function safeId(value, max) {
  return typeof value === 'string' && /^[A-Za-z0-9_:-]{1,}$/.test(value) && value.length <= max ? value : null;
}

function stageIds(stage) {
  const present = Array.isArray(stage?.present) ? stage.present : STAGE_IDS;
  return [...new Set(present.filter((id) => STAGE_IDS.includes(id)))];
}

function errorsForRequest(raw, stage = {}) {
  const errors = [];
  if (!object(raw)) return ['invalid-request'];
  if (raw.version !== undefined && raw.version !== INTERACTION_VERSION) errors.push('unsupported-version');
  if (canonicalActorId(raw.actor || 'YOU') !== 'YOU') errors.push('player-must-act-as-you');
  const target = canonicalActorId(raw.target);
  if (!isNpcId(target)) errors.push('target-must-be-independent-character');
  if (target && !stageIds(stage).includes(target)) errors.push('target-not-present');
  if (!REQUEST_ACTIONS.includes(raw.action)) errors.push('unsupported-request-action');
  if (['ask', 'tell', 'invite'].includes(raw.action) && !safeText(raw.text)) errors.push('text-required');
  if (raw.action === 'invite' && target === 'Z') errors.push('extra-cannot-be-invited-as-persistent-target');
  if (raw.channel !== undefined && !INTERACTION_CHANNELS.includes(raw.channel)) errors.push('unsupported-channel');
  if (raw.channel === 'private' && target === undefined) errors.push('private-target-required');
  if (raw.audience !== undefined && (!Array.isArray(raw.audience) || raw.audience.length > EVENT_LIMITS.audience)) errors.push('invalid-audience');
  return errors;
}

/** Validate a player intent without allowing direct NPC control. */
export function validateInteractionRequest(raw, stage = {}) {
  const errors = errorsForRequest(raw, stage);
  if (!errors.length && !canPlayerControl(raw.actor || 'YOU')) errors.push('player-control-denied');
  return { valid: errors.length === 0, errors };
}

export function normalizeInteractionRequest(raw, stage = {}) {
  const result = validateInteractionRequest(raw, stage);
  if (!result.valid) return null;
  const target = canonicalActorId(raw.target);
  const value = {
    version: INTERACTION_VERSION,
    actor: 'YOU',
    action: raw.action,
    target,
    channel: raw.channel || 'public',
    text: safeText(raw.text) || null,
    roomId: ROOM_IDS.includes(raw.roomId) ? raw.roomId : (stage.roomId || 'bedroom'),
  };
  if (Array.isArray(raw.audience)) value.audience = [...new Set(raw.audience.filter(isCharacterId))].slice(0, EVENT_LIMITS.audience);
  if (safeId(raw.requestId, EVENT_LIMITS.id)) value.requestId = raw.requestId;
  return value;
}

function actorEventErrors(raw, { stage = {}, source = 'agent' } = {}) {
  const errors = [];
  if (!object(raw)) return ['invalid-event'];
  const actor = canonicalActorId(raw.actor);
  const target = raw.target === undefined ? undefined : canonicalActorId(raw.target);
  const actorCapability = capabilityFor(actor);
  if (!actorCapability) errors.push('unknown-actor');
  if (raw.version !== INTERACTION_VERSION) errors.push('unsupported-version');
  if (!INTERACTION_CHANNELS.includes(raw.channel || 'public')) errors.push('unsupported-channel');
  if (source === 'player' && actor !== 'YOU') errors.push('player-cannot-submit-npc-event');
  if (source === 'agent' && actor === 'YOU') {
    // YOU is a projected body. The doll agent submits its output as `doll`
    // and the resolver materializes it as YOU; external NPC agents cannot.
    if (raw.owner !== DOLL_AGENT_ID) errors.push('you-owned-by-doll-agent');
  }
  if (actor === ENV_AGENT_ID && source !== 'environment') errors.push('environment-event-source-required');
  if (actor !== ENV_AGENT_ID && target && !isCharacterId(target)) errors.push('unknown-target');
  if (target && stageIds(stage).length && !stageIds(stage).includes(target) && target !== 'YOU') errors.push('target-not-present');

  const action = raw.action;
  if (actorCapability && source === 'agent' && actor !== ENV_AGENT_ID && actor !== DOLL_AGENT_ID && !canRespond(actor, action) && !canInitiate(actor, action)) {
    errors.push('actor-cannot-perform-action');
  }
  if (actor === DOLL_AGENT_ID && !['suggest', 'move', 'use', 'observe', 'speak'].includes(action)) errors.push('doll-action-not-allowed');
  if (actor === ENV_AGENT_ID && !['feedback', 'ambient', 'speak'].includes(action)) errors.push('environment-action-not-allowed');
  if (source === 'agent' && isNpcId(actor) && ![...RESPONSE_ACTIONS, ...['ask', 'tell', 'move', 'use']].includes(action)) errors.push('npc-action-not-allowed');
  if (['answer', 'deny', 'lie', 'counter', 'tell', 'ask'].includes(action) && !safeText(raw.text)) errors.push('text-required');
  if (raw.text !== undefined && raw.text !== null && !safeText(raw.text)) errors.push('invalid-text');
  if (raw.audience !== undefined && (!Array.isArray(raw.audience) || raw.audience.length > EVENT_LIMITS.audience || raw.audience.some((id) => !isCharacterId(id)))) errors.push('invalid-audience');
  if (raw.inReplyTo !== undefined && !safeId(raw.inReplyTo, EVENT_LIMITS.id)) errors.push('invalid-reply-reference');
  if (raw.roomId !== undefined && !ROOM_IDS.includes(raw.roomId)) errors.push('unknown-room');
  return errors;
}

/** Validate an agent/environment response or public event. */
export function validateInteractionEvent(raw, options = {}) {
  const errors = actorEventErrors(raw, options);
  return { valid: errors.length === 0, errors };
}

export function normalizeInteractionEvent(raw, options = {}) {
  const result = validateInteractionEvent(raw, options);
  if (!result.valid) return null;
  const actor = canonicalActorId(raw.actor);
  const channel = raw.channel || 'public';
  const event = {
    version: INTERACTION_VERSION,
    id: safeId(raw.id, EVENT_LIMITS.id) || null,
    actor,
    action: raw.action,
    target: raw.target === undefined ? null : canonicalActorId(raw.target),
    channel,
    text: safeText(raw.text) || null,
    roomId: raw.roomId || options.stage?.roomId || 'bedroom',
  };
  if (safeId(raw.turnId, EVENT_LIMITS.turnId)) event.turnId = raw.turnId;
  if (safeId(raw.inReplyTo, EVENT_LIMITS.id)) event.inReplyTo = raw.inReplyTo;
  if (Array.isArray(raw.audience)) event.audience = [...new Set(raw.audience.filter(isCharacterId))].slice(0, EVENT_LIMITS.audience);
  if (raw.source && INTERACTION_SOURCES.includes(raw.source)) event.source = raw.source;
  if (Number.isFinite(raw.at)) event.at = Math.max(0, Math.trunc(raw.at));
  return event;
}

export function createInteractionRequest(raw, stage = {}) {
  return normalizeInteractionRequest({ ...raw, actor: 'YOU' }, stage);
}

export function createResponseEvent({ actor, request, action, text, source = 'agent', ...rest }, options = {}) {
  return normalizeInteractionEvent({
    ...rest,
    version: INTERACTION_VERSION,
    actor,
    action,
    text,
    target: request?.actor || 'YOU',
    channel: request?.channel || 'public',
    inReplyTo: request?.id || request?.requestId,
    source,
    roomId: request?.roomId,
  }, options);
}

/** A private event is visible only to explicit recipients; public events are
 * visible to everyone currently in the room. The doll always sees public
 * events because it owns the projected YOU body. */
export function isInteractionVisible(event, viewerId, stage = {}) {
  const normalized = normalizeInteractionEvent(event, { stage, source: event?.source || 'agent' });
  if (!normalized || !viewerId) return false;
  const viewer = canonicalActorId(viewerId);
  if (normalized.channel === 'public' || normalized.channel === 'system') return stageIds(stage).includes(viewer) || viewer === DOLL_AGENT_ID || viewer === ENV_AGENT_ID;
  const audience = new Set(normalized.audience || [normalized.actor, normalized.target].filter(Boolean));
  return audience.has(viewer) || viewer === DOLL_AGENT_ID;
}

export function eventsVisibleTo(events, viewerId, stage = {}) {
  return (Array.isArray(events) ? events : []).filter((event) => isInteractionVisible(event, viewerId, stage));
}

export function responseActionsFor(actor) {
  return capabilityFor(actor)?.canRespond ? [...capabilityFor(actor).canRespond] : [];
}

// Used by server-side callers to avoid importing capability internals.
export { CAPABILITIES_VERSION, CAST, isSpeakerId };
