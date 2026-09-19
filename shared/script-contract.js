// 002 · 编剧契约（前后端共用）
//
// 这个文件是服务端与前端之间的唯一约定。两边都校验，任何一边不合格就丢弃。
//
// 设计原则：模型只能改变「谁说什么」「谁走到哪」「谁对什么东西做了什么」，
// 不能改变动作的种类、不能发明角色、不能发明物件、不能换房间。
// 所以这里是一张白名单，不是一段提示词。

import { CAST, CAST_IDS, ROOM_IDS, ROOM_SPOT_KEYS, STAGE_IDS, RENAMEABLE_IDS, isSpeakerId, WEATHERS, LIGHTS } from './cast.js';
import { canUse, findObject, AMBIENT_FIELDS } from './environment.js';

export const CONTRACT_VERSION = 3;

// 动作白名单。
//   move    人物走到某个站位
//   speak   某个声音说一句话（人物 / 娃娃 / 环境）
//   burst   情绪崩了的特效
//   shake   发抖的特效
//   focus   把镜头给某个人
//   use     人物（或娃娃的暗手）对房间里的某个物件做了什么
//   ambient 环境改变自己的状态（天气 / 灯光），只有 ENV 能发
export const ACTION_KINDS = ['move', 'speak', 'burst', 'shake', 'focus', 'use', 'ambient'];

// 站位白名单（每个房间自己定义，这里是并集）
export const SPOT_KEYS = [
  'door', 'window', 'bed', 'middle',
  'stove', 'table',
  'far', 'near', 'side',
  'desk', 'away',
  'bar', 'corner',
];

export const EFFECTS = ['wave', 'split', 'knot', 'mend', 'tilt', 'clock', 'flicker', 'knock', 'ring'];

export const LIMITS = {
  title: 24,
  ack: 60,
  ask: 80,
  lineText: 60,
  aftermath: 100,
  beats: 14,
  options: 3,
  optionLabel: 14,
  input: 200,
  // 单场戏最多几个人物开口，防止五个 agent 轮流刷屏
  speakers: 4,
  // 环境一场戏最多插几句，多了它就成了旁白
  envLines: 2,
  // 娃娃的建议。要短，否则每一夜都在读一段劝导。
  advice: 40,
  name: 12,
};

// 危险的返回内容：可执行标记与外部链接。命中即整条丢弃。
const DANGEROUS = [
  /<\s*script/i,
  /<\s*iframe/i,
  /<\s*img/i,
  /<\s*svg/i,
  /javascript:/i,
  /on\w+\s*=/i,
  /https?:\/\//i,
  /data:text\/html/i,
  /\$\{/,
  /`/,
  /\{\{/,
];

export function isDangerous(text) {
  if (typeof text !== 'string') return true;
  return DANGEROUS.some((re) => re.test(text));
}

function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (!t || t.length > max) return null;
  if (isDangerous(t)) return null;
  return t;
}

/** 身份：人物查 CAST，娃娃是 'doll'，其他一律 null */
function roleOf(speakerId) {
  if (speakerId === 'doll') return 'doll';
  return CAST[speakerId] ? CAST[speakerId].role : null;
}

/**
 * 校验一份剧本。
 *
 * @param raw   服务端或本地站返回的原始对象
 * @param ctx   { roomId } —— use 动作要靠它判断物件是否在这间房里
 *
 * 两种形态：
 *   - 反问型：只有 ask + options，不动手
 *   - 演出型：ack + beats（多角色轮流说话与动作），可选 aftermath / advice
 */
export function validateScript(raw, ctx = {}) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.version !== CONTRACT_VERSION) return null;

  const roomId = ROOM_IDS.includes(ctx.roomId) ? ctx.roomId : 'bedroom';

  const ask = raw.ask === undefined || raw.ask === null ? null : cleanText(raw.ask, LIMITS.ask);
  const ack = raw.ack === undefined || raw.ack === null ? null : cleanText(raw.ack, LIMITS.ack);

  // 娃娃的建议：可选。没有建议是常态，不能因此判定整份剧本无效。
  const advice = (() => {
    if (!raw.advice || typeof raw.advice !== 'object') return null;
    const text = cleanText(raw.advice.text, LIMITS.advice);
    if (!text) return null;
    const tone = ['warn', 'note', 'object'].includes(raw.advice.tone) ? raw.advice.tone : 'note';
    return { text, tone };
  })();

  // ---- 反问型 ----
  if (ask && !ack) {
    const options = Array.isArray(raw.options)
      ? raw.options
          .slice(0, LIMITS.options)
          .map((o) => cleanText(o, LIMITS.optionLabel))
          .filter(Boolean)
      : [];
    if (!options.length) return null;
    return {
      version: CONTRACT_VERSION,
      source: typeof raw.source === 'string' ? raw.source : 'unknown',
      ack: null,
      ask,
      advice,
      options,
      beats: [],
      aftermath: null,
      roster: [],
    };
  }

  // ---- 演出型 ----
  if (!ack) return null;

  const beats = [];
  const speakers = new Set();
  let envLines = 0;

  if (Array.isArray(raw.beats)) {
    for (const b of raw.beats.slice(0, LIMITS.beats)) {
      if (!b || typeof b !== 'object') continue;
      if (!ACTION_KINDS.includes(b.action)) continue;
      if (Array.isArray(ctx.present) && CAST_IDS.includes(b.role) && b.role !== 'Z' && !ctx.present.includes(b.role)) continue;

      const at = Number(b.at);
      const time = Number.isFinite(at) ? Math.max(0, Math.min(30000, at)) : 0;

      if (b.action === 'speak') {
        if (!isSpeakerId(b.role)) continue;
        const text = cleanText(b.text, LIMITS.lineText);
        if (!text) continue;
        if (b.role === 'ENV') {
          // 环境一场戏最多插两句。它是反馈，不是旁白。
          envLines += 1;
          if (envLines > LIMITS.envLines) continue;
        } else if (b.role !== 'doll') {
          // 人物说话者数量设上限
          if (!speakers.has(b.role) && speakers.size >= LIMITS.speakers) continue;
          speakers.add(b.role);
        }
        const step = { at: time, action: 'speak', role: b.role, text };
        if (isSpeakerId(b.to) && b.to !== b.role) step.to = b.to;
        // 环境的话可以挂在某个物件上，前端据此在物件位置放特效
        if (b.role === 'ENV' && typeof b.target === 'string' && findObject(roomId, b.target)) step.target = b.target;
        if (EFFECTS.includes(b.effect)) step.effect = b.effect;
        beats.push(step);
      } else if (b.action === 'move') {
        // 只有舞台人物能走；娃娃与环境没有身体
        if (!CAST_IDS.includes(b.role)) continue;
        if (!ROOM_SPOT_KEYS[roomId].includes(b.spot)) continue;
        beats.push({ at: time, action: 'move', role: b.role, spot: b.spot });
      } else if (b.action === 'use') {
        // 谁（人物或娃娃的暗手）对哪个物件做了什么。三重白名单：
        // 物件在这间房、动作是物件承受得起的、这个身份被允许这么做。
        const role = roleOf(b.role);
        if (!role) continue;
        if (typeof b.target !== 'string' || typeof b.verb !== 'string') continue;
        if (!canUse(roomId, role, b.target, b.verb)) continue;
        beats.push({ at: time, action: 'use', role: b.role, target: b.target, verb: b.verb });
      } else if (b.action === 'ambient') {
        // 只有环境能改天气与灯光
        if (b.role !== 'ENV') continue;
        const step = { at: time, action: 'ambient', role: 'ENV' };
        let any = false;
        if (AMBIENT_FIELDS.weather.includes(b.weather) && WEATHERS.includes(b.weather)) {
          step.weather = b.weather;
          any = true;
        }
        if (AMBIENT_FIELDS.light.includes(b.light) && LIGHTS.includes(b.light)) {
          step.light = b.light;
          any = true;
        }
        if (!any) continue;
        beats.push(step);
      } else if (b.action === 'burst' || b.action === 'shake') {
        if (!isSpeakerId(b.role) || b.role === 'ENV') continue;
        const step = { at: time, action: b.action, role: b.role };
        if (EFFECTS.includes(b.effect)) step.effect = b.effect;
        beats.push(step);
      } else if (b.action === 'focus') {
        if (!CAST_IDS.includes(b.role)) continue;
        beats.push({ at: time, action: 'focus', role: b.role });
      }
    }
  }

  // 演出型必须真的有事发生
  if (!beats.length) return null;
  beats.sort((a, b) => a.at - b.at);

  const aftermath =
    raw.aftermath === undefined || raw.aftermath === null ? null : cleanText(raw.aftermath, LIMITS.aftermath);

  // 硬限制：一场戏最多保留一个身体动作（burst/shake）。
  // 实测模型倾向于给每个角色都加，结果所有人都抖一下，等于谁都没抖。
  const physical = beats.filter((b) => b.action === 'burst' || b.action === 'shake');
  if (physical.length > 1) {
    const keep = physical[0];
    for (let i = beats.length - 1; i >= 0; i -= 1) {
      const b = beats[i];
      if ((b.action === 'burst' || b.action === 'shake') && b !== keep) beats.splice(i, 1);
    }
  }

  return {
    version: CONTRACT_VERSION,
    source: typeof raw.source === 'string' ? raw.source : 'unknown',
    ack,
    ask: null,
    advice,
    options: [],
    beats,
    aftermath,
    // 本场实际开口的人物，供界面显示（不含娃娃与环境）
    roster: [...speakers],
  };
}

/** 校验请求体。来自浏览器的数据一律不可信。 */
export function validateRequest(body) {
  if (!body || typeof body !== 'object') return null;

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > LIMITS.input) return null;
  if (isDangerous(text)) return null;

  const roomId = ROOM_IDS.includes(body.roomId) ? body.roomId : 'bedroom';

  // 在场人物：只认舞台人物，玩家角色永远在
  let present = Array.isArray(body.present)
    ? [...new Set(body.present.filter((id) => STAGE_IDS.includes(id)))]
    : [];
  if (!present.includes('YOU')) present.unshift('YOU');
  present = present.slice(0, STAGE_IDS.length);

  // 玩家给人物起的名字：只有可改名的位收，逐个清洗
  const names = {};
  if (body.names && typeof body.names === 'object') {
    for (const [id, v] of Object.entries(body.names)) {
      if (!RENAMEABLE_IDS.includes(id)) continue;
      const n = cleanText(v, LIMITS.name);
      if (n) names[id] = n;
    }
  }

  // 各角色自己的记忆摘要，逐条清洗
  const memories = {};
  if (body.memories && typeof body.memories === 'object') {
    for (const [id, list] of Object.entries(body.memories)) {
      if (!CAST_IDS.includes(id) || !Array.isArray(list)) continue;
      memories[id] = list
        .filter((m) => typeof m === 'string' && m.trim() && !isDangerous(m))
        .slice(-6)
        .map((m) => m.slice(0, 120));
    }
  }

  const history = Array.isArray(body.history)
    ? body.history
        .filter((h) => h && typeof h.text === 'string' && (h.who === 'you' || isSpeakerId(h.who)))
        .slice(-12)
        .map((h) => ({ who: h.who, text: h.text.slice(0, 200) }))
    : [];

  // 环境状态：给 ENV agent 作为"现在是什么样"的起点
  const ambient = { weather: 'clear', light: 'on' };
  if (body.ambient && typeof body.ambient === 'object') {
    if (WEATHERS.includes(body.ambient.weather)) ambient.weather = body.ambient.weather;
    if (LIGHTS.includes(body.ambient.light)) ambient.light = body.ambient.light;
  }

  const nights = Number(body.nights);
  const doubtRaw = Number(body.doubt);
  const recentNight =
    typeof body.recentNight === 'string' && body.recentNight.trim() && !isDangerous(body.recentNight)
      ? body.recentNight.trim().slice(0, LIMITS.aftermath)
      : null;

  return {
    text,
    roomId,
    present,
    names,
    memories,
    history,
    ambient,
    nights: Number.isFinite(nights) ? Math.max(0, Math.min(999, nights)) : 0,
    doubt: Number.isFinite(doubtRaw) ? Math.max(0, Math.min(10, doubtRaw)) : 0,
    recentNight,
  };
}
