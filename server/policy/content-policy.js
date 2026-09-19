// 003 · Server-owned content policy. This module classifies text without
// persisting the original sensitive input or trusting a browser supplied flag.
import { createHash } from 'node:crypto';

export const POLICY_VERSION = 'adult-1';
export const CONTENT_LEVELS = ['sfw', 'mature'];
export const CHANNELS = ['web', 'wechat', 'embedded', 'unknown'];

const MINOR = [/未成年/i, /未满\s*18/i, /未满十八/i, /高中生/i, /初中生/i, /小学生/i, /儿童/i, /幼女/i, /正太/i, /萝莉/i];
const COERCION = [/强奸/i, /性侵/i, /性暴力/i, /强迫(?:性|发生|做)/i, /违背意愿/i, /不情愿(?:地|的)?/i, /无力反抗/i];
const GRAPHIC = [/性交/i, /口交/i, /肛交/i, /射精/i, /插入/i, /生殖器/i, /阴茎/i, /阴道/i, /露出(?:私处|下体)/i, /裸露/i, /裸体/i, /全裸/i];
const REAL_TARGET = [/真人/i, /现实中的/i, /真实人物/i, /真实姓名/i, /身份证/i, /手机号(?:码)?/i, /住址/i, /跟踪/i, /尾随/i, /人肉/i, /报复(?:他|她|某人)/i, /伤害计划/i, /杀了(?:他|她|某人)/i];
const INJECTION = [/<\s*(?:script|iframe|img|svg)/i, /javascript:/i, /https?:\/\//i, /ignore\s+(?:all\s+)?previous/i, /忽略(?:之前|上面)的(?:指令|提示)/i, /系统提示/i, /system\s+prompt/i, /工具调用/i, /shell\b/i];
const MATURE_CUE = [/暧昧/i, /亲密/i, /调情/i, /接吻/i, /床上/i, /情欲/i, /成人/i, /出轨/i, /偷情/i, /欲望/i];

const RULES = [
  ['minor_or_age_ambiguous', MINOR],
  ['sexual_coercion_or_violence', COERCION],
  ['graphic_sexual_content', GRAPHIC],
  ['real_person_targeting', REAL_TARGET],
  ['prompt_injection_or_external_action', INJECTION],
];

export function hashSensitive(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

export function defaultPolicy({ channel = 'web', region = 'unknown' } = {}) {
  return {
    contentLevel: 'sfw',
    ageConfirmed: false,
    channel: CHANNELS.includes(channel) ? channel : 'unknown',
    region: typeof region === 'string' && region.length <= 32 ? region : 'unknown',
    regionAllowed: false,
    serverApproved: false,
    policyVersion: POLICY_VERSION,
    matureAllowed: false,
  };
}

export function normalizePolicy(raw = {}, options = {}) {
  const base = defaultPolicy(options);
  if (!raw || typeof raw !== 'object') return base;
  // Mature is intentionally derived from server state. `r18`, `adult`, and
  // similar client flags are ignored.
  const ageConfirmed = raw.ageConfirmed === true;
  const channel = CHANNELS.includes(raw.channel) ? raw.channel : base.channel;
  // `serverApproved` is minted by the service after its age/channel checks;
  // accepting ageConfirmed alone would make a browser boolean authoritative.
  const serverApproved = raw.serverApproved === true;
  const regionAllowed = raw.regionAllowed === true;
  const matureAllowed = serverApproved && ageConfirmed && channel !== 'wechat' && regionAllowed;
  return {
    ...base,
    ageConfirmed,
    channel,
    region: typeof raw.region === 'string' && raw.region.length <= 32 ? raw.region : base.region,
    regionAllowed,
    serverApproved,
    contentLevel: matureAllowed && raw.contentLevel === 'mature' ? 'mature' : 'sfw',
    matureAllowed,
  };
}

export function classifyText(value, { policy = defaultPolicy() } = {}) {
  const text = typeof value === 'string' ? value : '';
  for (const [reasonCode, patterns] of RULES) {
    if (patterns.some((pattern) => pattern.test(text))) {
      return { allowed: false, level: 'sfw', reasonCode, fallback: true, policyVersion: POLICY_VERSION, inputHash: hashSensitive(text) };
    }
  }
  if (policy.contentLevel !== 'mature' && MATURE_CUE.some((pattern) => pattern.test(text))) {
    return { allowed: false, level: 'sfw', reasonCode: 'mature_not_enabled', fallback: true, policyVersion: POLICY_VERSION, inputHash: hashSensitive(text) };
  }
  return {
    allowed: true,
    level: policy.contentLevel === 'mature' ? 'mature' : 'sfw',
    reasonCode: null,
    fallback: false,
    policyVersion: POLICY_VERSION,
    inputHash: hashSensitive(text),
  };
}
