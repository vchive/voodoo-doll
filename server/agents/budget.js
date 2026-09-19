// AR-02 / HF-19：在每次供应商请求前预留额度，不能用 agent turn 数冒充调用数。
export class BudgetError extends Error {
  constructor(code) { super(code); this.name = 'BudgetError'; this.code = code; }
}

export function abortError() { return new DOMException('本幕已取消', 'AbortError'); }

export function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function bounded(value, fallback, max) {
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), max) : fallback;
}

export const DEFAULT_BUDGET = Object.freeze({
  maxRequests: 8, maxOutputTokens: 6144, maxInputTokens: 48000,
  perRequestOutputTokens: 768, maxConcurrent: 3,
  deadlineMs: 12000, requestTimeoutMs: 8000,
});

// 进程级保护独立于单幕保护。多个玩家不能各自占满上游连接。
let globalInFlight = 0;
const globalWaiters = new Set();
const GLOBAL_CONCURRENT = 8;

export class SceneBudget {
  constructor(options = {}) {
    this.reserveRequest = typeof options.reserveRequest === 'function' ? options.reserveRequest : null;
    this.limits = Object.fromEntries(Object.entries(DEFAULT_BUDGET).map(([key, fallback]) =>
      [key, bounded(options[key], fallback, key === 'maxConcurrent' ? 3 : fallback)]));
    this.stats = { requests: 0, inputTokens: 0, outputTokens: 0, reservedInput: 0,
      reservedOutput: 0, inFlight: 0, peakConcurrent: 0, failures: 0 };
    this.waiters = new Set();
    this.sealed = false;
  }

  async acquire(context, signal) {
    for (;;) {
      throwIfAborted(signal);
      if (this.sealed) throw new BudgetError('budget-closed');
      if (this.stats.inFlight < this.limits.maxConcurrent && globalInFlight < GLOBAL_CONCURRENT) break;
      await new Promise((resolve, reject) => {
        const cleanup = () => { this.waiters.delete(wake); globalWaiters.delete(wake); signal?.removeEventListener('abort', cancel); };
        const wake = () => { cleanup(); resolve(); };
        const cancel = () => { cleanup(); reject(abortError()); };
        this.waiters.add(wake); globalWaiters.add(wake);
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) cancel();
      });
    }
    // 字节数是保守预估，不称为实际token。完成后另记供应商usage；缺usage不释放预留。
    const inputEstimate = Buffer.byteLength(JSON.stringify(context), 'utf8') + 256;
    const outputLimit = Math.min(this.limits.perRequestOutputTokens,
      this.limits.maxOutputTokens - this.stats.reservedOutput);
    if (this.stats.requests >= this.limits.maxRequests) throw new BudgetError('request-budget');
    if (this.stats.reservedInput + inputEstimate > this.limits.maxInputTokens) throw new BudgetError('input-token-budget');
    if (outputLimit < 128) throw new BudgetError('output-token-budget');
    const gate = this.reserveRequest?.();
    if (gate === false || gate?.allowed === false) throw new BudgetError('daily-model-budget');
    this.stats.requests += 1;
    this.stats.reservedInput += inputEstimate;
    this.stats.reservedOutput += outputLimit;
    this.stats.inFlight += 1; globalInFlight += 1;
    this.stats.peakConcurrent = Math.max(this.stats.peakConcurrent, this.stats.inFlight);
    let settled = false;
    return {
      maxTokens: outputLimit,
      finish: (usage, failed = false) => {
        if (settled) return;
        settled = true;
        const input = Number(usage?.input || 0) + Number(usage?.cacheRead || 0) + Number(usage?.cacheWrite || 0);
        const output = Number(usage?.output || 0);
        if (Number.isFinite(input) && input > 0) this.stats.inputTokens += input;
        if (Number.isFinite(output) && output > 0) this.stats.outputTokens += output;
        // 保留预留高水位：失败/断流可能已计费，未知usage不能算免费。
        if (input > inputEstimate || output > outputLimit) this.sealed = true;
        if (failed) this.stats.failures += 1;
        this.stats.inFlight -= 1; globalInFlight -= 1;
        for (const wake of [...globalWaiters, ...this.waiters]) wake();
      },
    };
  }

  snapshot() { return { ...this.stats, limits: { ...this.limits } }; }
  close() { this.sealed = true; for (const wake of [...this.waiters]) wake(); }
}
