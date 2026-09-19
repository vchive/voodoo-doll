// 003 · Three-stage policy gate helpers. The caller may use the result for
// fallback rendering; it must never write the rejected input to ordinary logs.
import { classifyText, defaultPolicy, hashSensitive, normalizePolicy, POLICY_VERSION } from './content-policy.js';

const safeFallback = '娃娃把这股过火的念头收进针线盒，先演一场安全小戏。';

export function gateText(value, { policy = defaultPolicy() } = {}) {
  const normalized = normalizePolicy(policy);
  const result = classifyText(value, { policy: normalized });
  if (result.allowed) return result;
  return { ...result, policyVersion: POLICY_VERSION, fallbackText: safeFallback };
}

export function gateInput(input, options = {}) {
  const policy = normalizePolicy(options.policy ?? input?.policy ?? {});
  const value = typeof input === 'string' ? input : input?.text ?? input?.playerText ?? '';
  const result = gateText(value, { policy });
  return { ...result, level: result.allowed ? result.level : 'sfw' };
}

export function gateScript(script, options = {}) {
  const policy = normalizePolicy(options.policy ?? {});
  const beats = Array.isArray(script?.beats) ? script.beats : [];
  const texts = [
    script?.ack,
    script?.ask,
    script?.aftermath,
    script?.advice?.text,
    ...(Array.isArray(script?.options) ? script.options : []),
    ...beats.map((beat) => beat?.text),
  ];
  for (const value of texts) {
    if (typeof value !== 'string') continue;
    const result = gateText(value, { policy });
    if (!result.allowed) return { ...result, fallbackText: safeFallback };
  }
  return {
    allowed: true,
    level: policy.contentLevel,
    reasonCode: null,
    fallback: false,
    policyVersion: POLICY_VERSION,
    inputHash: hashSensitive(JSON.stringify(texts)),
  };
}

export { safeFallback };
