import type { DialogueLine, PlayEvent, PlaySnapshot } from './play-api';

// Presentation state only. Advancing a line never submits a world action.
export type DialoguePlayback = {
  contextKey: string;
  lines: DialogueLine[];
  index: number;
  choicesOpen: boolean;
};

export function normalizeDialogueLines(value: unknown): DialogueLine[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): DialogueLine[] => {
    if (!item || typeof item !== 'object' || typeof item.text !== 'string' || !item.text.trim()) return [];
    if (!['speech', 'thought', 'narration'].includes(item.kind) || typeof item.speakerId !== 'string') return [];
    if (!/^(YOU|PLAYER_DOLL|ENV|[A-Z])$/.test(item.speakerId)) return [];
    // NPC private thoughts are never a public dialogue presentation source.
    if (item.kind === 'thought' && item.speakerId !== 'YOU') return [];
    // Narration is the doll's account of observable events, including cached
    // lines written before the doll took over the ENV presentation role.
    return [{ speakerId: item.kind === 'narration' ? 'PLAYER_DOLL' : item.speakerId,
      kind: item.kind, text: item.text.slice(0, 2000) }];
  }).slice(0, 80);
}

export function normalizeDialoguePlayback(value: unknown): DialoguePlayback | undefined {
  if (!value || typeof value !== 'object') return;
  const raw = value as Partial<DialoguePlayback>;
  const lines = normalizeDialogueLines(raw.lines);
  if (typeof raw.contextKey !== 'string' || !lines.length) return;
  return { contextKey: raw.contextKey.slice(0, 10000), lines,
    index: Number.isInteger(raw.index) ? Math.max(0, Math.min(lines.length - 1, raw.index!)) : 0,
    choicesOpen: raw.choicesOpen === true };
}

export function dialogueContext(snapshot: PlaySnapshot): string {
  const guide = snapshot.guidance;
  return JSON.stringify([snapshot.worldId || 'local', snapshot.roomId,
    guide?.dialogueId || [guide?.chapter, guide?.passage]]);
}

export function guideDialogue(snapshot: PlaySnapshot): DialogueLine[] {
  const lines = normalizeDialogueLines(snapshot.guidance?.dialogue);
  return lines.length ? lines : [{ speakerId: 'PLAYER_DOLL', kind: 'narration',
    text: snapshot.guidance?.passage || '你和巫毒娃娃站在一起。观察四周，去别处走走，或向在场的人问好。' }];
}

export function restoreDialogue(snapshot: PlaySnapshot, saved?: DialoguePlayback): DialoguePlayback {
  const restored = normalizeDialoguePlayback(saved);
  if (restored?.contextKey === dialogueContext(snapshot)) return restored;
  return { contextKey: dialogueContext(snapshot), lines: guideDialogue(snapshot), index: 0, choicesOpen: false };
}

export function dialogueAfterAction(snapshot: PlaySnapshot, events: PlayEvent[], previous?: DialoguePlayback, includeGuide = true): DialoguePlayback {
  const changed = previous?.contextKey !== dialogueContext(snapshot);
  const authored = normalizeDialogueLines(snapshot.guidance?.dialogue);
  const hasNewScene = changed && includeGuide && authored.length > 0;
  const responses = events.flatMap((event): DialogueLine[] => {
    if (event.actor === 'YOU' || typeof event.payload?.text !== 'string') return [];
    const actor = event.actor || 'ENV';
    // A new authored scene already tells the player what changed. Keep actual
    // character replies, but avoid stacking generic environment echoes in
    // front of it. Same-scene and offline actions still need their own result.
    if (actor === 'ENV' && (event.payload.chapterTransition || hasNewScene)) return [];
    return normalizeDialogueLines([{ speakerId: actor, kind: actor === 'ENV' || event.action === 'silence' ? 'narration' : 'speech', text: event.payload.text }]);
  });
  const lines = [...responses, ...(changed && includeGuide ? (authored.length ? authored : guideDialogue(snapshot)) : [])];
  return { contextKey: dialogueContext(snapshot), lines: lines.length ? lines : guideDialogue(snapshot), index: 0, choicesOpen: false };
}

export function advanceDialogue(playback: DialoguePlayback): DialoguePlayback {
  if (playback.index < playback.lines.length - 1) return { ...playback, index: playback.index + 1 };
  return { ...playback, choicesOpen: true };
}
