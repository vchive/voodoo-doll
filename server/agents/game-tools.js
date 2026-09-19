import { Type } from '@earendil-works/pi-ai';
import { CAST, ROOM_SPOT_KEYS } from '../../shared/cast.js';
import { AMBIENT_FIELDS, canUse, objectsOf, ROLE_AFFORDANCES, DOLL_NUDGES } from '../../shared/environment.js';
import { isDangerous, LIMITS } from '../../shared/script-contract.js';
import { throwIfAborted } from './budget.js';

const optionalText = (max) => Type.Optional(Type.String({ maxLength: max }));
const object = (fields) => Type.Object(fields, { additionalProperties: false });
const useSchema = object({ target: Type.String(), verb: Type.String() });
const actorSchema = object({ line: optionalText(60), to: optionalText(12), spot: optionalText(12),
  use: Type.Optional(useSchema), action: Type.Optional(Type.Union([Type.Literal('burst'), Type.Literal('shake')])) });

export function safeText(value, max = 60) {
  return typeof value === 'string' && value.trim() && value.trim().length <= max && !isDangerous(value)
    ? value.trim() : null;
}

export function normalizeActor(raw, role, input) {
  if (!raw || typeof raw !== 'object') return null;
  const actorRole = role === 'YOU' ? 'protagonist' : CAST[role]?.role;
  const result = {};
  const line = safeText(raw.line);
  if (line) result.line = line;
  if (input.present.includes(raw.to) && raw.to !== role) result.to = raw.to;
  if ((ROOM_SPOT_KEYS[input.roomId] || []).includes(raw.spot)) result.spot = raw.spot;
  if (raw.use && canUse(input.roomId, actorRole, raw.use.target, raw.use.verb))
    result.use = { target: raw.use.target, verb: raw.use.verb };
  if (['burst', 'shake'].includes(raw.action)) result.action = raw.action;
  return result.line || result.spot || result.use || result.action ? result : null;
}

export function normalizeProposal(raw, role, input) {
  if (role === 'doll') {
    const you = normalizeActor(raw?.you, 'YOU', input);
    const nudge = raw?.nudge && canUse(input.roomId, 'doll', raw.nudge.target, raw.nudge.verb)
      ? { target: raw.nudge.target, verb: raw.nudge.verb } : null;
    const adviceText = safeText(raw?.advice?.text, LIMITS.advice);
    if (!you && !nudge && !adviceText) return null;
    return { you, nudge, advice: adviceText ? { text: adviceText,
      tone: ['warn', 'note', 'object'].includes(raw.advice.tone) ? raw.advice.tone : 'note' } : null };
  }
  if (role === 'ENV') {
    const reactions = (Array.isArray(raw?.reactions) ? raw.reactions : []).slice(0, 2).flatMap((r) => {
      const text = safeText(r?.text);
      if (!text) return [];
      return [{ text,
        ...(objectsOf(input.roomId).some((o) => o.id === r.target) ? { target: r.target } : {}),
        ...(['flicker', 'knock', 'ring'].includes(r.effect) ? { effect: r.effect } : {}) }];
    });
    const ambient = {};
    for (const key of ['weather', 'light']) if (AMBIENT_FIELDS[key].includes(raw?.ambient?.[key])) ambient[key] = raw.ambient[key];
    return { reactions, ...(Object.keys(ambient).length ? { ambient } : {}) };
  }
  return normalizeActor(raw, role, input);
}

// 全部工具只产生本幕提案/通信；不操作文件、网络、数据库或权威世界。
export function createGameTools({ role, input, signal, setProposal, enqueue }) {
  const parameters = role === 'doll'
    ? object({ you: Type.Optional(actorSchema), nudge: Type.Optional(useSchema),
      advice: Type.Optional(object({ text: Type.String({ maxLength: 40 }), tone: Type.Union(['warn', 'note', 'object'].map((v) => Type.Literal(v))) })) })
    : role === 'ENV'
      ? object({ reactions: Type.Array(object({ text: Type.String({ maxLength: 60 }), target: optionalText(20), effect: optionalText(12) }), { maxItems: 2 }),
        ambient: Type.Optional(object({ weather: optionalText(12), light: optionalText(12) })) })
      : actorSchema;
  let submissions = 0;
  let messages = 0;
  const finishedResult = () => ({ content: [{ type: 'text', text: '本次行动已经提交，不再执行后续工具。' }],
    details: { ignored: true }, terminate: true });
  const tools = [{
    name: 'perform', label: '提出本幕演出',
    description: '把本角色此刻的台词和动作作为草稿提交。只提交一次；提交后本次行动结束。',
    parameters,
    execute: async (_id, args) => {
      throwIfAborted(signal);
      if (submissions) return finishedResult();
      const proposal = normalizeProposal(args, role, input);
      if (!proposal) throw new Error('没有合法的台词或动作');
      submissions += 1;
      setProposal(proposal);
      return { content: [{ type: 'text', text: '已作为演出草稿收下，等待玩家确认。' }], details: { accepted: true }, terminate: true };
    },
  }, {
    name: 'inspect_object', label: '查看物件', description: '查看当前房间一个物件和自己能做的动作。没有外部查询。',
    parameters: object({ target: Type.String({ maxLength: 20 }) }),
    execute: async (_id, { target }) => {
      throwIfAborted(signal);
      if (submissions) return finishedResult();
      const found = objectsOf(input.roomId).find((o) => o.id === target);
      const allowed = role === 'doll' ? [...DOLL_NUDGES, ...ROLE_AFFORDANCES.protagonist] : ROLE_AFFORDANCES[CAST[role]?.role] || [];
      const value = found ? { ...found, verbs: role === 'ENV' ? found.verbs : found.verbs.filter((v) => allowed.includes(v)) } : { error: '物件不在这间房里' };
      return { content: [{ type: 'text', text: JSON.stringify(value) }], details: value };
    },
  }];
  if (CAST[role]?.agent) tools.push({
    name: 'send_message', label: '悄悄接话', description: '向一个在场人物私下说一句话；只会投递给该人物。每次行动最多一次，然后用 perform 提交公开表现。',
    parameters: object({ to: Type.String(), text: Type.String({ maxLength: 60 }) }),
    execute: async (_id, { to, text }) => {
      throwIfAborted(signal);
      if (submissions) return finishedResult();
      if (messages++ || to === role || !input.present.includes(to) || !CAST[to]?.agent || !safeText(text)) throw new Error('私话对象或内容无效');
      enqueue({ type: 'send', to, body: JSON.stringify({ kind: 'private-dialogue', from: role, text }) });
      return { content: [{ type: 'text', text: '已加入本次行动的定向邮箱。现在用 perform 提交你的公开表现。' }], details: { queued: true } };
    },
  });
  return tools;
}
