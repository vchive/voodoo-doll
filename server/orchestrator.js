// AR-01/02/04 · Pi Agent + 有界 Team 调度。世界状态由 API 确认层负责提交。
import { CAST } from '../shared/cast.js';
import { CONTRACT_VERSION, validateScript } from '../shared/script-contract.js';
import { localScript, localEnvReactions } from './local-station.js';
import { passerbyFor } from './extras.js';
import { SceneBudget, abortError, throwIfAborted } from './agents/budget.js';
import { createGatewayProvider } from './agents/provider.js';
import { GameRoleAgent } from './agents/role-agent.js';
import { TeamRuntime } from './agents/vendor/pi-team/runtime.js';

export const SCENE_LIMITS = { MAX_AGENT_CALLS: 3, MAX_CONCURRENT: 3, MAX_ROUNDS: 2 };

function fallbackFor(role) {
  if (role === 'doll') return { you: { line: '这次，我想把话说清楚。' }, nudge: null, advice: null };
  return { line: role === 'C' ? '我先听听你们怎么说。' : '我一时不知道该怎么接。' };
}

function actorBeats(role, proposal, at) {
  const beats = [];
  // use 自带走向物件，避免同时给两个互相打架的移动目标。
  if (proposal.spot && !proposal.use) beats.push({ at, action: 'move', role, spot: proposal.spot });
  if (proposal.use) beats.push({ at: at + 200, action: 'use', role, ...proposal.use });
  if (proposal.action) beats.push({ at: at + 300, action: proposal.action, role });
  if (proposal.line) beats.push({ at: at + 600, action: 'speak', role, text: proposal.line, ...(proposal.to ? { to: proposal.to } : {}) });
  return beats;
}

function normalizedInput(input) {
  return { ...input, roomId: input.roomId || 'bedroom',
    present: [...new Set(['YOU', ...(input.present || []).filter((id) => CAST[id]?.agent)])],
    names: input.names || {}, ambient: input.ambient || { weather: 'clear', light: 'on' },
    nights: input.nights || 0, doubt: input.doubt || 0 };
}

/**
 * @param input 由 API 授权后的世界/角色可见记忆。只有娃娃读取 text/confirmedFacts/dollMemory。
 * @param options.signal 玩家取消/连接断开。取消必须抛 AbortError，不能自动提交 fallback。
 * @param options.budget 单幕请求/token/并发/时限；reserveRequest 可接进程每日实际请求门禁。
 * @param options.runtime 仅服务端测试注入 {provider, providerForRole}；不接收浏览器字段。
 * @param options.onMetrics 只输出数字与状态，无消息正文。
 */
export async function composeScene(rawInput, { signal, budget: limits = {}, runtime = {}, onMetrics } = {}) {
  throwIfAborted(signal);
  const input = normalizedInput(rawInput);
  const provider = runtime.provider || createGatewayProvider();
  if (!provider && !runtime.providerForRole) return localScript(input);
  const budget = new SceneBudget(limits);
  const deadline = new AbortController();
  const deadlineTimer = setTimeout(() => deadline.abort(), budget.limits.deadlineMs);
  const activeSignal = AbortSignal.any([signal, deadline.signal].filter(Boolean));
  const proposals = [];
  const failed = new Set();
  const modelRoles = new Set();
  const localRoles = new Set();
  const agents = new Map();
  let directedMessages = 0;
  let team;
  let envAgent;
  let teamSettlement = 'not-started';
  const onProposal = (role, value) => { proposals.push({ role, value }); modelRoles.add(role); };
  const mode = String(runtime.mode || process.env.AGENT_MODE || 'parallel').toLowerCase() === 'sequential' ? 'sequential' : 'parallel';
  const makeAgent = (role, roleInput = input) => new GameRoleAgent({
    role, input: roleInput, provider: runtime.providerForRole?.(role) || provider, budget,
    signal: activeSignal, onProposal, onDirected: () => { directedMessages += 1; },
  });
  try {
    const doll = makeAgent('doll'); agents.set('doll', doll);
    for (const id of input.present.filter((id) => CAST[id]?.agent)) agents.set(id, makeAgent(id));
    if (agents.size > 1) {
      team = new TeamRuntime('在虚构房间里回应自己能观察到的事情。每人最多回应两次。', agents, {
        maxTurns: agents.size * 3, waveConcurrency: mode === 'sequential' ? 1 : 3,
        actionTimeoutMs: budget.limits.deadlineMs, maxCommandsPerTurn: 6,
      });
      try {
        const result = await team.run({ channel: { kind: 'direct', memberId: 'doll' }, body: '{"kind":"player-turn"}' }, activeSignal);
        teamSettlement = result.settlement.kind;
        for (const member of result.members) if (member.state === 'errored') failed.add(member.id);
      } catch (error) {
        if (signal?.aborted) throw abortError();
        if (!activeSignal.aborted) throw error;
        teamSettlement = 'deadline';
      }
    } else {
      try { await doll.act({ observations: [] }, activeSignal); }
      catch { if (signal?.aborted) throw abortError(); failed.add('doll'); }
    }
    throwIfAborted(signal);

    // 失败只补这一角色；已成功的台词和动作不因另一角色失败被丢弃。
    for (const id of agents.keys()) if (!proposals.some((p) => p.role === id)) {
      failed.add(id); localRoles.add(id); proposals.push({ role: id, value: fallbackFor(id), local: true });
    }
    const dollProposal = proposals.find((p) => p.role === 'doll').value;
    const actors = [];
    let cursor = 0;
    if (dollProposal.you) { actors.push(...actorBeats('YOU', dollProposal.you, cursor)); cursor += 1800; }
    if (dollProposal.nudge) { actors.push({ at: cursor, action: 'use', role: 'doll', ...dollProposal.nudge }); cursor += 500; }
    for (const { role, value } of proposals.filter((p) => CAST[p.role]?.agent)) {
      actors.push(...actorBeats(role, value, cursor)); cursor += 1600;
    }
    // 为环境反馈预留契约容量；先去多余移动，保留人物的话与被碰物件。
    while (actors.length > 11) {
      let index = actors.findIndex((b) => b.action === 'move');
      if (index < 0) index = actors.findIndex((b) => b.action === 'burst' || b.action === 'shake');
      if (index < 0) index = 0;
      actors.splice(index, 1);
    }
    const uses = actors.filter((b) => b.action === 'use');
    let environment = null;
    if (!activeSignal.aborted) {
      envAgent = makeAgent('ENV', { ...input, environmentEvents: [
        ...(input.environmentEvents || []).slice(-6),
        ...uses.map(({ role, target, verb }) => ({ action: 'use', role, target, verb })),
      ] });
      try {
        await envAgent.act({ observations: [] }, activeSignal);
        environment = proposals.findLast((p) => p.role === 'ENV')?.value;
      } catch { if (signal?.aborted) throw abortError(); failed.add('ENV'); }
    } else failed.add('ENV');
    throwIfAborted(signal);
    const envBeats = [];
    if (environment?.ambient) envBeats.push({ at: cursor, action: 'ambient', role: 'ENV', ...environment.ambient });
    for (const reaction of environment?.reactions || []) {
      envBeats.push({ at: cursor + 300 + envBeats.length * 1000, action: 'speak', role: 'ENV', ...reaction });
    }
    if (!envBeats.some((b) => b.action === 'speak')) {
      localRoles.add('ENV');
      envBeats.push(...localEnvReactions(input.roomId, uses, cursor + 500));
    }
    const beats = [...actors, ...envBeats].slice(0, 14);
    const passerby = passerbyFor(input.roomId, ''); // 私人讲述不传给路人选择器。
    if (beats.length < 14 && passerby) beats.push({ at: cursor + 3200, action: 'speak', role: 'Z', text: passerby.line });
    const last = actors.filter((b) => b.action === 'speak').at(-1);
    const script = validateScript({ version: CONTRACT_VERSION,
      source: modelRoles.size ? (localRoles.size ? 'mixed' : 'model') : 'local',
      ack: '我把这一幕排好了。先看看，是你想让我演的吗？', advice: dollProposal.advice,
      beats, aftermath: last ? `这一幕停在这句话：${last.text}` : '这一幕安静下来。',
    }, { roomId: input.roomId });
    return script || localScript(input);
  } finally {
    clearTimeout(deadlineTimer);
    deadline.abort();
    budget.close();
    if (team) await team.close();
    else await Promise.allSettled([...agents.values()].map((a) => a.close()));
    await envAgent?.close();
    onMetrics?.({ ...budget.snapshot(), runtime: 'pi', mode, directedMessages,
      modelRoles: [...modelRoles], localRoles: [...localRoles],
      allRolesModel: modelRoles.size > 0 && localRoles.size === 0 && failed.size === 0,
      failedRoles: [...failed], settlement: teamSettlement });
    throwIfAborted(signal);
  }
}
