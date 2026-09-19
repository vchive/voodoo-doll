// 003 · 角色能力与控制边界（前后端共用）
//
// 这里描述“谁能提出什么意图”，不描述某个存档当前发生了什么。
// 权威状态仍由服务端确认层保存。尤其要注意：YOU 与 doll 共用一个执行
// agent；玩家可以让 YOU 发起交互，但不能替 A/B/C/Z 提交台词或决定。

import { CAST, isCastId, isSpeakerId } from './cast.js';

export const CAPABILITIES_VERSION = 1;
export const DOLL_AGENT_ID = 'doll';
export const ENV_AGENT_ID = 'ENV';

export const REQUEST_ACTIONS = Object.freeze([
  'ask',
  'tell',
  'invite',
  'move',
  'use',
  'observe',
]);

export const RESPONSE_ACTIONS = Object.freeze([
  'answer',
  'deny',
  'lie',
  'counter',
  'silence',
  'leave',
  'accept',
  'refuse',
]);

export const DOLL_ACTIONS = Object.freeze([
  'suggest',
  'move',
  'use',
  'observe',
]);

export const ENVIRONMENT_ACTIONS = Object.freeze(['feedback', 'ambient']);

// `agentId` is the execution identity. `owner` is the only principal allowed
// to submit an action for that identity. NPCs submit responses for themselves.
export const CHARACTER_CAPABILITIES = Object.freeze({
  YOU: Object.freeze({
    id: 'YOU', kind: 'player-body', agentId: DOLL_AGENT_ID, owner: DOLL_AGENT_ID,
    canInitiate: REQUEST_ACTIONS,
    canRespond: [],
    canControl: ['YOU'],
    canReceive: ['ask', 'tell', 'invite'],
  }),
  doll: Object.freeze({
    id: DOLL_AGENT_ID, kind: 'doll', agentId: DOLL_AGENT_ID, owner: DOLL_AGENT_ID,
    canInitiate: DOLL_ACTIONS,
    canRespond: [],
    canControl: ['YOU'],
    canReceive: ['player-intent', 'public-event', 'private-event'],
  }),
  A: Object.freeze({
    id: 'A', kind: 'named', agentId: 'A', owner: 'A',
    canInitiate: ['ask', 'tell', 'move', 'use'],
    canRespond: RESPONSE_ACTIONS,
    canControl: ['A'],
    canReceive: ['ask', 'tell', 'invite', 'public-event', 'private-event'],
  }),
  B: Object.freeze({
    id: 'B', kind: 'named', agentId: 'B', owner: 'B',
    canInitiate: ['ask', 'tell', 'move', 'use'],
    canRespond: RESPONSE_ACTIONS,
    canControl: ['B'],
    canReceive: ['ask', 'tell', 'invite', 'public-event', 'private-event'],
  }),
  C: Object.freeze({
    id: 'C', kind: 'named', agentId: 'C', owner: 'C',
    canInitiate: ['ask', 'tell', 'move', 'use'],
    canRespond: RESPONSE_ACTIONS,
    canControl: ['C'],
    canReceive: ['ask', 'tell', 'invite', 'public-event', 'private-event'],
  }),
  Z: Object.freeze({
    id: 'Z', kind: 'extra', agentId: null, owner: null,
    canInitiate: ['ask', 'tell', 'move', 'use'],
    canRespond: RESPONSE_ACTIONS,
    canControl: ['Z'],
    canReceive: ['ask', 'tell', 'invite', 'public-event'],
  }),
  ENV: Object.freeze({
    id: ENV_AGENT_ID, kind: 'environment', agentId: ENV_AGENT_ID, owner: ENV_AGENT_ID,
    canInitiate: ENVIRONMENT_ACTIONS,
    canRespond: [],
    canControl: ['ENV'],
    canReceive: ['environment-event'],
  }),
});

const ALIASES = Object.freeze({ DOLL: DOLL_AGENT_ID, doll: DOLL_AGENT_ID });

export function canonicalActorId(id) {
  return typeof id === 'string' ? ALIASES[id] || id : id;
}

export function capabilityFor(id) {
  return CHARACTER_CAPABILITIES[canonicalActorId(id)] || null;
}

export function agentForActor(id) {
  return capabilityFor(id)?.agentId || null;
}

export function isCharacterId(id) {
  return Boolean(capabilityFor(id));
}

export function isNpcId(id) {
  const capability = capabilityFor(id);
  return Boolean(capability && ['named', 'extra'].includes(capability.kind));
}

export function isIndependentAgentId(id) {
  const capability = capabilityFor(id);
  return Boolean(capability?.agentId && capability.agentId !== DOLL_AGENT_ID || capability?.agentId === DOLL_AGENT_ID);
}

export function canInitiate(actor, action) {
  return Boolean(capabilityFor(actor)?.canInitiate.includes(action));
}

export function canRespond(actor, action) {
  return Boolean(capabilityFor(actor)?.canRespond.includes(action));
}

export function canControl(owner, target) {
  const targetCapability = capabilityFor(target);
  if (!targetCapability) return false;
  return targetCapability.owner === canonicalActorId(owner) || targetCapability.id === canonicalActorId(owner);
}

/**
 * Player-originated commands always become actions by YOU. A/B/C/Z are
 * independent agents and cannot be selected as the command actor.
 */
export function canPlayerControl(target) {
  return canonicalActorId(target) === 'YOU' || canonicalActorId(target) === DOLL_AGENT_ID;
}

export function isKnownSpeaker(id) {
  return isSpeakerId(id) || isCharacterId(id);
}

// Keep these imports observable to callers that previously used CAST helpers;
// they also make it explicit that capability ids are constrained by the cast.
export { CAST, isCastId };
