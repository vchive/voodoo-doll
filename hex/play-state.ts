import type { PlayProfile, PlaySnapshot, StoryDraftResponse } from './play-api';
import { normalizeDialogueLines, normalizeDialoguePlayback, type DialoguePlayback } from './play-dialogue.ts';

export const PLAY_STORAGE_KEY = 'voodoo-single-player-v1';
export const PLAY_SAVE_SOURCE = 'voodoo-single-v1';
export const TUTORIAL_TEMPLATE_ID = 'rainy-office-v1';

export type TutorialStep = 'story' | 'observe' | 'move' | 'talk' | 'choice' | 'complete';
export type TutorialState = {
  templateId: typeof TUTORIAL_TEMPLATE_ID;
  step: TutorialStep;
  worldId?: string;
  choice?: 'trust' | 'question';
  dismissed?: boolean;
};

export type LocalLogStatus = 'accepted' | 'rejected' | 'notice';
export type LocalLogKind = 'action' | 'feedback' | 'error';
export type LocalLogClock = { day: number; minute: number };
export type LocalLogEntry = {
  who: string;
  text: string;
  /** Stable identity for an authoritative event or turn. Old logs may omit it. */
  eventId?: string;
  status?: LocalLogStatus;
  kind?: LocalLogKind;
  /** Optional context for new entries; old saves intentionally remain sparse. */
  roomId?: string;
  clock?: LocalLogClock;
  worldVersion?: number;
};

/**
 * Append a local log entry once. Authoritative events can be replayed after a
 * retry or reconnect, so entries carrying an eventId must remain idempotent.
 * Older entries without an id keep their historical behavior.
 */
export function appendLocalLogEntry(state: LocalState, entry: LocalLogEntry): boolean {
  if (!entry.text.trim()) return false;
  if (entry.eventId && state.log.some((item) => item.eventId === entry.eventId)) return false;
  state.log = [...state.log, entry].slice(-100);
  return true;
}

export type LocalState = {
  profile: PlayProfile;
  snapshot: PlaySnapshot;
  log: LocalLogEntry[];
  pending?: {
    kind: 'story' | 'intent';
    id: string;
    text?: string;
    preview?: StoryDraftResponse['preview'] | Record<string, unknown>;
    worldVersion?: number;
  };
  tutorial?: TutorialState;
  dialogue?: DialoguePlayback;
  offline: boolean;
};

export type LocalSaveEnvelope = {
  schemaVersion: 1;
  sourceKey: typeof PLAY_SAVE_SOURCE;
  payload: Pick<LocalState, 'profile' | 'snapshot'> & { narrative?: unknown };
};

const ROOM_IDS = new Set(['parlor', 'bedroom', 'hall', 'garden', 'attic', 'office', 'home', 'kitchen', 'street', 'station', 'bar']);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown, fallback = '', limit = 600): string {
  return typeof value === 'string' ? value.slice(0, limit) : fallback;
}

function objectValue(value: unknown): Record<string, unknown> {
  return record(value) || {};
}

function nestedRecords(value: unknown): Record<string, Record<string, unknown>> {
  return Object.fromEntries(Object.entries(objectValue(value)).flatMap(([key, item]) => {
    const nested = record(item);
    return nested ? [[key, nested]] : [];
  }));
}

export function initialPlaySnapshot(): PlaySnapshot {
  return {
    worldVersion: 0,
    roomId: 'parlor',
    present: ['YOU'],
    agents: {},
    relationships: {},
    environment: { light: 'warm', weather: 'clear' },
    clock: { day: 1, minute: 540 },
  };
}

export function emptyLocalState(): LocalState {
  return { profile: { dollName: '', names: {} }, snapshot: initialPlaySnapshot(), log: [], offline: true };
}

export function createTutorialState(step: TutorialStep = 'story'): TutorialState {
  return { templateId: TUTORIAL_TEMPLATE_ID, step };
}

export function nextTutorialStep(tutorial: TutorialState | undefined, preview: Record<string, unknown>): TutorialState | undefined {
  if (!tutorial || tutorial.dismissed || tutorial.step === 'story' || tutorial.step === 'complete') return tutorial;
  const action = typeof preview.action === 'string' ? preview.action : '';
  const payload = record(preview.payload) || {};
  if (tutorial.step === 'observe' && action === 'observe') return { ...tutorial, step: 'move' };
  if (tutorial.step === 'move' && action === 'move' && payload.roomId === 'office') return { ...tutorial, step: 'talk' };
  if (tutorial.step === 'talk' && action === 'ask') return { ...tutorial, step: 'choice' };
  if (tutorial.step === 'choice' && action === 'ask') {
    const text = typeof preview.text === 'string' ? preview.text : '';
    return { ...tutorial, step: 'complete', choice: text.includes('相信') ? 'trust' : 'question' };
  }
  return tutorial;
}

export function createLocalSaveEnvelope(state: LocalState): LocalSaveEnvelope {
  return {
    schemaVersion: 1,
    sourceKey: PLAY_SAVE_SOURCE,
    payload: { profile: state.profile, snapshot: state.snapshot, ...(state.snapshot.narrative ? { narrative: state.snapshot.narrative } : {}) },
  };
}

export function hasCompletedLocalWorld(state: LocalState | null): boolean {
  return Boolean(state?.profile.dollName?.trim() && state.profile.story?.trim());
}

export function restorePendingStoryDraft(state: LocalState): StoryDraftResponse | null {
  const pending = state.pending;
  const preview = record(pending?.preview);
  if (pending?.kind !== 'story' || !preview) return null;
  const dollName = stringValue(preview.dollName, '', 32).trim();
  const story = stringValue(preview.story, '', 2000).trim();
  if (!dollName || !story) return null;
  const names = Object.fromEntries(
    Object.entries(objectValue(preview.names))
      .filter(([key, name]) => /^[A-Z]$/.test(key) && typeof name === 'string' && name.trim())
      .slice(0, 26)
      .map(([key, name]) => [key, String(name).trim().slice(0, 32)]),
  );
  return {
    draftId: pending.id,
    preview: {
      ...preview,
      dollName,
      story,
      names,
    },
    worldVersion: Number.isInteger(pending.worldVersion)
      ? Math.max(0, Number(pending.worldVersion))
      : state.snapshot.worldVersion,
  };
}

export function normalizeLocalState(value: unknown): LocalState | null {
  const source = record(value);
  if (!source) return null;

  const rawProfile = record(source.profile) || source;
  const rawNames = objectValue(rawProfile.names);
  const names = Object.fromEntries(
    Object.entries(rawNames)
      .filter(([key, name]) => /^[A-Z]$/.test(key) && typeof name === 'string' && name.trim())
      .slice(0, 26)
      .map(([key, name]) => [key, String(name).trim().slice(0, 32)]),
  );
  const profile: PlayProfile = {
    ...rawProfile,
    dollName: stringValue(rawProfile.dollName, '', 32).trim(),
    names,
  } as PlayProfile;
  if (typeof rawProfile.story === 'string') profile.story = rawProfile.story.slice(0, 2000);
  if (typeof rawProfile.modelEnabled === 'boolean') profile.modelEnabled = rawProfile.modelEnabled;

  const defaults = initialPlaySnapshot();
  const rawSnapshot = record(source.snapshot) || {};
  const roomId = typeof rawSnapshot.roomId === 'string' && ROOM_IDS.has(rawSnapshot.roomId)
    ? rawSnapshot.roomId
    : defaults.roomId;
  const present = Array.isArray(rawSnapshot.present)
    ? [...new Set(['YOU', ...rawSnapshot.present.filter((item): item is string => typeof item === 'string' && /^[A-Z_]{1,32}$/.test(item))])].slice(0, 64)
    : defaults.present;
  const rawClock = record(rawSnapshot.clock);
  const day = rawClock && Number.isInteger(rawClock.day) ? Math.max(1, Math.min(100000, Number(rawClock.day))) : 1;
  const minute = rawClock && Number.isFinite(rawClock.minute) ? Math.max(0, Math.min(1439, Math.trunc(Number(rawClock.minute)))) : 0;
  const snapshot: PlaySnapshot = {
    ...rawSnapshot,
    worldVersion: Number.isInteger(rawSnapshot.worldVersion) ? Math.max(0, Number(rawSnapshot.worldVersion)) : 0,
    roomId,
    present,
    agents: nestedRecords(rawSnapshot.agents) as PlaySnapshot['agents'],
    relationships: nestedRecords(rawSnapshot.relationships),
    environment: objectValue(rawSnapshot.environment),
    clock: { ...rawClock, day, minute },
  };

  const guide = record(rawSnapshot.guidance);
  if (guide && typeof guide.title === 'string' && typeof guide.chapter === 'string') {
    snapshot.guidance = {
      title: stringValue(guide.title), chapter: stringValue(guide.chapter),
      objective: stringValue(guide.objective), passage: stringValue(guide.passage, '', 8000),
      dialogueId: stringValue(guide.dialogueId), dialogue: normalizeDialogueLines(guide.dialogue),
      completed: guide.completed === true,
      ending: stringValue(guide.ending), playerRoutine: stringValue(guide.playerRoutine), scheduleHint: stringValue(guide.scheduleHint),
      actions: Array.isArray(guide.actions) ? guide.actions.flatMap((item) => {
        const action = record(item);
        if (!action || typeof action.id !== 'string' || typeof action.label !== 'string' || typeof action.intent !== 'string') return [];
        return [{ id: action.id, label: action.label, intent: action.intent, ...(typeof action.minutes === 'number' ? { minutes: action.minutes } : {}), reason: stringValue(action.reason) }];
      }).slice(0, 12) : [],
    };
  } else delete snapshot.guidance;

  const parsedLog = Array.isArray(source.log)
    ? source.log.flatMap((item) => {
        const line = record(item);
        if (!line || typeof line.who !== 'string' || typeof line.text !== 'string' || !line.text.trim()) return [];
        const status: LocalLogStatus | undefined = line.status === 'accepted' || line.status === 'rejected' || line.status === 'notice' ? line.status : undefined;
        const kind: LocalLogKind | undefined = line.kind === 'action' || line.kind === 'feedback' || line.kind === 'error' ? line.kind : undefined;
        const eventId = typeof line.eventId === 'string' && line.eventId.trim() ? line.eventId.slice(0, 240) : undefined;
        const roomId = typeof line.roomId === 'string' && ROOM_IDS.has(line.roomId) ? line.roomId : undefined;
        const rawClock = record(line.clock);
        const clock = rawClock && Number.isInteger(rawClock.day) && Number.isFinite(rawClock.minute)
          ? { day: Math.max(1, Math.min(100000, Number(rawClock.day))), minute: Math.max(0, Math.min(1439, Math.trunc(Number(rawClock.minute)))) }
          : undefined;
        const worldVersion = Number.isInteger(line.worldVersion) ? Math.max(0, Number(line.worldVersion)) : undefined;
        const entry: LocalLogEntry = {
          who: line.who.slice(0, 32),
          text: line.text.slice(0, 2000),
          ...(eventId ? { eventId } : {}),
          ...(status ? { status } : {}),
          ...(kind ? { kind } : {}),
          ...(roomId ? { roomId } : {}),
          ...(clock ? { clock } : {}),
          ...(worldVersion !== undefined ? { worldVersion } : {}),
        };
        return [entry];
      })
    : [];
  // A response can be replayed after a lost network response. Keep one local
  // copy of authoritative events while preserving old entries without IDs.
  const log = parsedLog.filter((entry, index, entries) => (
    !entry.eventId || entries.findIndex((candidate) => candidate.eventId === entry.eventId) === index
  )).slice(-100);

  const rawPending = record(source.pending);
  const kind = rawPending?.kind;
  const id = rawPending?.id;
  let pending: LocalState['pending'];
  if (rawPending && (kind === 'story' || kind === 'intent') && typeof id === 'string' && id.trim()) {
    pending = {
      kind,
      id: id.slice(0, 160),
      ...(typeof rawPending.text === 'string' ? { text: rawPending.text.slice(0, 240) } : {}),
      ...(record(rawPending.preview) ? { preview: rawPending.preview as Record<string, unknown> } : {}),
      ...(Number.isInteger(rawPending.worldVersion) ? { worldVersion: Math.max(0, Number(rawPending.worldVersion)) } : {}),
    };
  }

  const rawTutorial = record(source.tutorial);
  const tutorialSteps = new Set<TutorialStep>(['story', 'observe', 'move', 'talk', 'choice', 'complete']);
  let tutorial: TutorialState | undefined;
  if (rawTutorial?.templateId === TUTORIAL_TEMPLATE_ID && tutorialSteps.has(rawTutorial.step as TutorialStep)) {
    tutorial = {
      templateId: TUTORIAL_TEMPLATE_ID,
      step: rawTutorial.step as TutorialStep,
      ...(typeof rawTutorial.worldId === 'string' ? { worldId: rawTutorial.worldId.slice(0, 160) } : {}),
      ...(rawTutorial.choice === 'trust' || rawTutorial.choice === 'question' ? { choice: rawTutorial.choice } : {}),
      ...(typeof rawTutorial.dismissed === 'boolean' ? { dismissed: rawTutorial.dismissed } : {}),
    };
  }

  return {
    profile,
    snapshot,
    log,
    ...(pending ? { pending } : {}),
    ...(tutorial ? { tutorial } : {}),
    ...(normalizeDialoguePlayback(source.dialogue) ? { dialogue: normalizeDialoguePlayback(source.dialogue) } : {}),
    offline: typeof source.offline === 'boolean' ? source.offline : true,
  };
}

export function parseLocalState(raw: string | null): LocalState | null {
  if (!raw) return null;
  try {
    return normalizeLocalState(JSON.parse(raw));
  } catch {
    return null;
  }
}
