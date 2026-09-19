// 固定 Pi AI 0.85.1 的通用协议层，不加载 coding/TUI，不读取本机 Pi 登录配置。
import { AssistantMessageEventStream } from '@earendil-works/pi-ai';
import { stream as openaiStream } from '@earendil-works/pi-ai/api/openai-completions';
import { stream as anthropicStream } from '@earendil-works/pi-ai/api/anthropic-messages';
import { abortError, throwIfAborted } from './budget.js';

export function createGatewayProvider(env = process.env) {
  if (!env.MODEL_BASE_URL || !env.MODEL_API_KEY || !env.MODEL_NAME) return null;
  const anthropic = env.MODEL_API_STYLE === 'anthropic';
  const base = env.MODEL_BASE_URL.replace(/\/+$/, '').replace(/\/v1$/, '');
  const model = {
    id: env.MODEL_NAME, name: env.MODEL_NAME, provider: 'voodoo-gateway',
    api: anthropic ? 'anthropic-messages' : 'openai-completions',
    baseUrl: anthropic ? base : `${base}/v1`, reasoning: false, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 768,
    ...(anthropic ? {} : { compat: {
      supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: false,
      supportsReasoningEffort: false, maxTokensField: 'max_tokens',
    } }),
  };
  return {
    model,
    stream: (m, context, options) => (anthropic ? anthropicStream : openaiStream)(m, context, {
      ...options, apiKey: env.MODEL_API_KEY, maxRetries: 0, cacheRetention: 'none',
      ...(anthropic ? { headers: { authorization: `Bearer ${env.MODEL_API_KEY}` } } : {}),
    }),
  };
}

function failedMessage(model, aborted) {
  return { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
    timestamp: Date.now(), stopReason: aborted ? 'aborted' : 'error',
    errorMessage: aborted ? 'scene-cancelled' : 'role-generation-failed',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}

// StreamFn 必须返回流，失败编码成 error 事件，符合 Pi Agent 的正式协议。
export function boundedStream(provider, budget, sceneSignal) {
  return (model, context, options = {}) => {
    const output = new AssistantMessageEventStream();
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), budget.limits.requestTimeoutMs);
    const signals = [sceneSignal, options.signal, timeout.signal].filter(Boolean);
    const signal = AbortSignal.any(signals);
    let ticket;
    let completed = false;
    const finishError = () => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      const message = failedMessage(model, signal.aborted);
      ticket?.finish(null, true);
      output.push({ type: 'error', reason: message.stopReason, error: message });
      output.end(message);
    };
    const onAbort = () => finishError();
    signal.addEventListener('abort', onAbort, { once: true });
    void (async () => {
      try {
        throwIfAborted(signal);
        ticket = await budget.acquire(context, signal);
        // acquire resolves in a microtask: recheck cancellation before any HTTP.
        if (completed) { ticket.finish(null, true); return; }
        throwIfAborted(signal);
        const upstream = await provider.stream(model, context, { ...options, signal,
          maxTokens: ticket.maxTokens, maxRetries: 0, timeoutMs: budget.limits.requestTimeoutMs });
        for await (const event of upstream) {
          if (completed) break;
          if (signal.aborted) throw abortError();
          if (event.type === 'done' || event.type === 'error') {
            const message = event.type === 'done' ? event.message : event.error;
            ticket.finish(message.usage, event.type === 'error');
            completed = true;
            clearTimeout(timer);
            signal.removeEventListener('abort', onAbort);
            // 上游错误可能包含请求信息，禁止透传错误正文。
            if (event.type === 'error') {
              const safe = failedMessage(model, message.stopReason === 'aborted');
              output.push({ type: 'error', reason: safe.stopReason, error: safe });
              output.end(safe);
            } else { output.push(event); output.end(message); }
            break;
          }
          output.push(event);
        }
        if (!completed) finishError();
      } catch { finishError(); }
      finally {
        clearTimeout(timer); signal.removeEventListener('abort', onAbort);
        if (!completed) finishError();
      }
    })();
    return output;
  };
}
