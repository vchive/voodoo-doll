import type { PlayProfile, PlaySnapshot, StoryDraftResponse } from './play-api';

export const PLAY_STORAGE_KEY = 'voodoo-single-player-v1';
export const PLAY_SAVE_SOURCE = 'voodoo-single-v1';

export type LocalState = {
  profile: PlayProfile;
  snapshot: PlaySnapshot;
  log: Array<{ who: string; text: string }>;
  pending?: {
    kind: 'story' | 'intent';
    id: string;
    text?: string;
    preview?: StoryDraftResponse['preview'] | Record<string, unknown>;
    worldVersion?: number;
  };
  offline: boolean;
};

export type LocalSaveEnvelope = {
  schemaVersion: 1;
  sourceKey: typeof PLAY_SAVE_SOURCE;
  payload: Pick<LocalState, 'profile' | 'snapshot'>;
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
    clock: { day: 1, minute: 0 },
  };
}

export function emptyLocalState(): LocalState {
  return { profile: { dollName: '', names: {} }, snapshot: initialPlaySnapshot(), log: [], offline: true };
}

export function createLocalSaveEnvelope(state: LocalState): LocalSaveEnvelope {
  return {
    schemaVersion: 1,
    sourceKey: PLAY_SAVE_SOURCE,
    payload: { profile: state.profile, snapshot: state.snapshot },
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

  const log = Array.isArray(source.log)
    ? source.log.flatMap((item) => {
        const line = record(item);
        if (!line || typeof line.who !== 'string' || typeof line.text !== 'string' || !line.text.trim()) return [];
        return [{ who: line.who.slice(0, 32), text: line.text.slice(0, 2000) }];
      }).slice(-100)
    : [];

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

  return {
    profile,
    snapshot,
    log,
    ...(pending ? { pending } : {}),
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
