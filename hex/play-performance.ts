import type { DialogueLine, PlayEvent, PlaySnapshot } from './play-api';

export type PerformanceExpression = 'neutral' | 'concerned' | 'smile' | 'thinking' | 'angry' | 'surprised';
export type PerformanceProjection = {
  castIds: string[];
  speakerId: string | null;
  mode: 'speech' | 'thought' | 'narration';
  expression: PerformanceExpression;
};
export type ActionPerformanceCue = {
  kind: 'move' | 'open' | 'close' | 'inspect' | 'work' | 'wait' | 'speak';
  label: string;
  eventId: string;
};

// Expressions are a light reading treatment of public words, not inferred
// feelings, relationship changes or story facts. Never inspect agent memory.
function publicExpression(text: string): PerformanceExpression {
  if (/^(?:嗯[，,]?\s*)?(?:谢谢|多谢|很高兴|太好了)/.test(text.trim())) return 'smile';
  if (/^(?:嗯[，,]?\s*)?(?:对不起|抱歉)/.test(text.trim())) return 'concerned';
  if (/^(?:怎么会|什么[？！?！]|你说什么)/.test(text.trim())) return 'surprised';
  if (/^(?:别再|够了|不许)/.test(text.trim())) return 'angry';
  if (/^(?:我不知道|我担心|我害怕|其实我|别担心)/.test(text.trim())) return 'concerned';
  return 'neutral';
}

/** Read-only stage projection. Missing old-save room fields retain the public
 * presence list; an explicit contradictory room always removes that actor.
 * YOU is never an opposing portrait and the doll is rendered separately. */
export function projectPerformance(snapshot: PlaySnapshot, line?: DialogueLine | null): PerformanceProjection {
  const castIds = [...new Set((snapshot.present || []).filter((id) => {
    if (!/^[A-Z]$/.test(id)) return false;
    const room = snapshot.agents?.[id]?.roomId;
    return !room || room === snapshot.roomId;
  }))];
  const base: PerformanceProjection = { castIds, speakerId: 'PLAYER_DOLL', mode: 'narration', expression: 'neutral' };
  if (!line || line.kind === 'narration') return base;
  if (line.kind === 'thought') {
    // A malformed or old cached NPC thought is not a portrait/pose source.
    return line.speakerId === 'YOU'
      ? { ...base, speakerId: 'YOU', mode: 'thought', expression: 'thinking' }
      : { ...base, speakerId: null };
  }
  if (line.kind !== 'speech') return base;
  const speakerId = line.speakerId === 'YOU' || line.speakerId === 'PLAYER_DOLL' || castIds.includes(line.speakerId)
    ? line.speakerId : null;
  return { ...base, speakerId, mode: 'speech', expression: speakerId ? publicExpression(line.text) : 'neutral' };
}

function actionCue(event: PlayEvent): Omit<ActionPerformanceCue, 'eventId'> | null {
  const payload = event.payload || {};
  switch (event.action) {
    case 'move': return { kind: 'move', label: '走向目的地' };
    case 'ask':
    case 'tell': return { kind: 'speak', label: '开口交谈' };
    case 'wait': return { kind: 'wait', label: '时间流逝' };
    case 'look': return { kind: 'inspect', label: '仔细查看' };
    case 'observe': {
      if (payload.sleepUntil === 'next-day') return { kind: 'wait', label: '休息到次日' };
      if (typeof payload.waitMinutes === 'number' && Number.isFinite(payload.waitMinutes) && payload.waitMinutes > 0) {
        return { kind: 'wait', label: '时间流逝' };
      }
      return { kind: 'inspect', label: '环顾四周' };
    }
    case 'use':
    case 'use_object': {
      if (payload.verb === 'open') return { kind: 'open', label: '轻轻打开' };
      if (payload.verb === 'close') return { kind: 'close', label: '轻轻关上' };
      if (payload.verb === 'look') return { kind: 'inspect', label: '仔细查看' };
      // Only the authored desk action represents work. Using a kettle or any
      // future object must not be narrated as completing a work assignment.
      if (payload.verb === 'use' && (payload.objectId || payload.object) === 'desk') {
        return { kind: 'work', label: '处理手头的工作' };
      }
      return null;
    }
    default: return null;
  }
}

/** Accept the latest confirmed turn's events only, never intent drafts or
 * dialogue pages. A cue does not submit actions, spend time or mutate saves.
 * The renderer deduplicates eventId and honors prefers-reduced-motion; this
 * module deliberately owns neither animation timers nor playback history. */
export function performanceFromEvents(events: readonly PlayEvent[]): ActionPerformanceCue | null {
  for (const event of events) {
    const status = (event as PlayEvent & { proposalStatus?: string }).proposalStatus;
    if (event.actor !== 'YOU' || !event.eventId || (status !== undefined && status !== 'accepted')) continue;
    const cue = actionCue(event);
    if (cue) return { ...cue, eventId: event.eventId };
  }
  return null;
}
