/**
 * TypeScript boundary for the Python World Kernel.
 *
 * The legacy night-theater client remains available by default. Passing
 * `?kernel=1` switches only the turn transport to this typed, event-based
 * client so migration can be verified without moving authority into the
 * browser.
 */

export type WorldEvent = {
  eventId: string;
  worldVersion: number;
  turnId: string;
  actor: string;
  action: string;
  target?: string | null;
  channel: string;
  payload: Record<string, unknown>;
  audience: string[];
  source: string;
  proposalStatus?: string;
  schemaVersion?: number;
  resolverVersion?: string;
  createdAt?: number;
};

export type WorldSnapshot = {
  schemaVersion: number;
  worldId: string;
  worldVersion: number;
  roomId: string;
  present: string[];
  environment: Record<string, unknown>;
  objects?: Record<string, Record<string, unknown>>;
  agents: Record<string, {
    id: string;
    kind: string;
    controller: string;
    roomId: string;
    memory: unknown[];
    capabilities: string[];
  }>;
  relationships: Record<string, Record<string, unknown>>;
  eventHead?: string | null;
};

export type TurnResult = {
  turnId: string;
  worldVersion: number;
  events: WorldEvent[];
  snapshot: WorldSnapshot;
  source: string;
  status?: string;
};

export type EventPage = {
  events: WorldEvent[];
  worldVersion: number;
};

export class WorldApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, code: string | undefined, message: string) {
    super(message);
    this.name = 'WorldApiError';
    this.status = status;
    this.code = code;
  }
}

function requestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `turn-${Date.now().toString(36)}`;
}

function positiveVersion(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

function normalizeEvent(value: unknown): WorldEvent | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.eventId !== 'string' || !raw.eventId) return null;
  if (typeof raw.turnId !== 'string' || !raw.turnId) return null;
  if (typeof raw.actor !== 'string' || !raw.actor) return null;
  if (typeof raw.action !== 'string' || !raw.action) return null;
  if (typeof raw.channel !== 'string' || !raw.channel) return null;
  if (typeof raw.source !== 'string' || !raw.source) return null;
  const payload = raw.payload && typeof raw.payload === 'object'
    ? raw.payload as Record<string, unknown>
    : {};
  const audience = Array.isArray(raw.audience)
    ? raw.audience.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    eventId: raw.eventId,
    worldVersion: positiveVersion(raw.worldVersion),
    turnId: raw.turnId,
    actor: raw.actor,
    action: raw.action,
    target: typeof raw.target === 'string' ? raw.target : null,
    channel: raw.channel,
    payload,
    audience,
    source: raw.source,
    ...(typeof raw.proposalStatus === 'string' ? { proposalStatus: raw.proposalStatus } : {}),
    ...(typeof raw.schemaVersion === 'number' ? { schemaVersion: raw.schemaVersion } : {}),
    ...(typeof raw.resolverVersion === 'string' ? { resolverVersion: raw.resolverVersion } : {}),
    ...(typeof raw.createdAt === 'number' ? { createdAt: raw.createdAt } : {}),
  };
}

function cloneSnapshot(snapshot: WorldSnapshot): WorldSnapshot {
  // The snapshot is JSON data from the server. structuredClone is not
  // available in a few embedded webviews, so use a JSON clone here.
  return JSON.parse(JSON.stringify(snapshot)) as WorldSnapshot;
}

/**
 * Applies server events to the short-lived rendering view.
 *
 * The reducer never invents relationships, memories, or outcomes. It only
 * advances the cursor and derives the few projection fields needed to keep
 * the stage responsive between snapshot refreshes. The next authoritative
 * snapshot always replaces this projection.
 */
export class WorldEventReducer {
  private current: WorldSnapshot | null;
  private readonly seen = new Set<string>();
  private readonly accepted: WorldEvent[] = [];

  constructor(snapshot?: WorldSnapshot | null) {
    this.current = snapshot ? cloneSnapshot(snapshot) : null;
  }

  get snapshot(): WorldSnapshot | null {
    return this.current ? cloneSnapshot(this.current) : null;
  }

  get lastVersion(): number {
    return this.current?.worldVersion ?? this.accepted.reduce(
      (version, event) => Math.max(version, event.worldVersion), 0,
    );
  }

  get eventCount(): number {
    return this.accepted.length;
  }

  /** Replace the projection only when the snapshot is not stale. */
  applySnapshot(snapshot: WorldSnapshot): boolean {
    if (!snapshot || typeof snapshot.worldId !== 'string') return false;
    if (this.current && snapshot.worldId !== this.current.worldId) return false;
    if (this.current && snapshot.worldVersion < this.current.worldVersion) return false;
    this.current = cloneSnapshot(snapshot);
    return true;
  }

  /**
   * Add one event, returning false for an already seen eventId.
   * Duplicate delivery is expected after SSE reconnect and is harmless.
   */
  applyEvent(value: WorldEvent): boolean {
    const event = normalizeEvent(value);
    if (!event || this.seen.has(event.eventId)) return false;
    this.seen.add(event.eventId);
    this.accepted.push(event);

    if (this.current) {
      const next = cloneSnapshot(this.current);
      next.worldVersion = Math.max(next.worldVersion, event.worldVersion);
      // eventHead is a display cursor, not a source of authority. The server
      // snapshot will provide the definitive head on the next refresh.
      next.eventHead = event.eventId;
      this.applyProjection(next, event);
      this.current = next;
    }
    return true;
  }

  applyEvents(events: Iterable<WorldEvent>): WorldEvent[] {
    const added: WorldEvent[] = [];
    for (const event of events) if (this.applyEvent(event)) added.push(event);
    return added;
  }

  applyTurn(result: TurnResult): WorldEvent[] {
    this.applySnapshot(result.snapshot);
    return this.applyEvents(result.events || []);
  }

  /** Clear event history when switching to a different world/session. */
  reset(snapshot?: WorldSnapshot | null): void {
    this.seen.clear();
    this.accepted.length = 0;
    this.current = snapshot ? cloneSnapshot(snapshot) : null;
  }

  events(): WorldEvent[] {
    return this.accepted.slice();
  }

  private applyProjection(snapshot: WorldSnapshot, event: WorldEvent): void {
    const payload = event.payload || {};
    if (event.actor === 'YOU' && event.action === 'move') {
      const roomId = payload.roomId ?? payload.room;
      if (typeof roomId === 'string' && roomId) {
        snapshot.roomId = roomId;
        if (snapshot.agents.YOU) snapshot.agents.YOU.roomId = roomId;
      }
    }
    if (event.actor === 'YOU' && event.action === 'use') {
      const objectId = payload.object ?? payload.objectId;
      const verb = payload.verb;
      if (typeof objectId === 'string' && snapshot.objects?.[objectId]) {
        snapshot.objects[objectId].lastAction = verb;
      }
    }
    if (event.actor && snapshot.agents[event.actor]) {
      if (event.action === 'leave') {
        snapshot.present = snapshot.present.filter((id) => id !== event.actor);
      } else if (event.action === 'accept' && !snapshot.present.includes(event.actor)) {
        snapshot.present = [...snapshot.present, event.actor];
      }
    }
  }
}

export type EventStreamOptions = {
  viewer?: string;
  afterVersion?: number;
  signal?: AbortSignal;
  minReconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  fetchImpl?: typeof fetch;
  onEvent: (event: WorldEvent) => void;
  onError?: (error: unknown) => void;
};

export type EventSubscription = {
  close: () => void;
  done: Promise<void>;
};

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

function normalizeSseEscapes(value: string): string {
  // The first Python stream adapter emitted literal "\\n" separators. Accept
  // those frames while retaining escaped newlines inside JSON payload strings.
  return value.replace(/\\n(?=(?:id:|event:|data:|retry:|\\n|$))/g, '\n');
}

function parseSseFrame(frame: string): WorldEvent | null {
  let data = '';
  for (const line of frame.replace(/\r/g, '').split('\n')) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('data:')) data += `${line.slice(5).trimStart()}\n`;
  }
  if (!data) return null;
  try {
    return normalizeEvent(JSON.parse(data.trim()));
  } catch {
    return null;
  }
}

class SseParser {
  private buffer = '';

  feed(chunk: string, flush = false): WorldEvent[] {
    this.buffer = normalizeSseEscapes(this.buffer + chunk).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const parts = this.buffer.split('\n\n');
    this.buffer = parts.pop() ?? '';
    const events = parts.map(parseSseFrame).filter((event): event is WorldEvent => Boolean(event));
    if (flush && this.buffer.trim()) {
      const event = parseSseFrame(this.buffer);
      if (event) events.push(event);
      this.buffer = '';
    }
    return events;
  }
}

export class WorldApiClient {
  private readonly baseUrl: string;

  constructor(baseUrl = '/api/v4') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async getWorld(viewer = 'YOU'): Promise<WorldSnapshot> {
    const response = await fetch(`${this.baseUrl}/world?viewer=${encodeURIComponent(viewer)}`);
    return this.parse<WorldSnapshot>(response);
  }

  async submitAsk(text: string, targets: string[], expectedVersion: number): Promise<TurnResult> {
    const response = await fetch(`${this.baseUrl}/turns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        actor: 'PLAYER_DOLL',
        action: 'ask',
        targets,
        text: text.slice(0, 240),
        expectedVersion,
        idempotencyKey: requestId(),
      }),
    });
    return this.parse<TurnResult>(response);
  }

  async readEvents(afterVersion = 0, viewer = 'YOU'): Promise<WorldEvent[]> {
    const page = await this.readEventPage(afterVersion, viewer);
    return page.events;
  }

  async readEventPage(afterVersion = 0, viewer = 'YOU'): Promise<EventPage> {
    const response = await fetch(`${this.baseUrl}/events?after=${positiveVersion(afterVersion)}&viewer=${encodeURIComponent(viewer)}`);
    const body = await this.parse<{ events?: unknown; worldVersion?: unknown }>(response);
    const events = Array.isArray(body.events)
      ? body.events.map(normalizeEvent).filter((event): event is WorldEvent => Boolean(event))
      : [];
    return { events, worldVersion: positiveVersion(body.worldVersion, events.reduce((v, event) => Math.max(v, event.worldVersion), 0)) };
  }

  /**
   * Subscribe to the poll-backed SSE endpoint. On close, error, or a mobile
   * network handoff the client first backfills `/events?after=...`, then
   * reconnects. Event ids are deduped for the lifetime of the subscription.
   */
  subscribeEvents(options: EventStreamOptions): EventSubscription {
    const controller = new AbortController();
    const external = options.signal;
    const abort = () => controller.abort();
    if (external) {
      if (external.aborted) controller.abort();
      else external.addEventListener('abort', abort, { once: true });
    }
    const fetchImpl = options.fetchImpl || fetch;
    const viewer = options.viewer || 'YOU';
    const minDelay = Math.max(100, options.minReconnectDelayMs ?? 500);
    const maxDelay = Math.max(minDelay, options.maxReconnectDelayMs ?? 8000);
    const seen = new Set<string>();
    let cursor = positiveVersion(options.afterVersion);
    let stopped = false;

    const emit = (event: WorldEvent): void => {
      if (seen.has(event.eventId)) return;
      seen.add(event.eventId);
      options.onEvent(event);
    };

    const catchUp = async (): Promise<void> => {
      const response = await fetchImpl(`${this.baseUrl}/events?after=${cursor}&viewer=${encodeURIComponent(viewer)}`, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      const body = await this.parse<{ events?: unknown; worldVersion?: unknown }>(response);
      const events = Array.isArray(body.events)
        ? body.events.map(normalizeEvent).filter((event): event is WorldEvent => Boolean(event))
        : [];
      for (const event of events) emit(event);
      // Advance only after a complete backfill. All events in one turn share a
      // worldVersion, so advancing per SSE frame could skip late siblings.
      cursor = Math.max(cursor, positiveVersion(body.worldVersion, events.reduce((v, event) => Math.max(v, event.worldVersion), cursor)));
    };

    const consume = async (): Promise<void> => {
      const response = await fetchImpl(`${this.baseUrl}/events/stream?after=${cursor}&viewer=${encodeURIComponent(viewer)}`, {
        headers: { accept: 'text/event-stream' },
        signal: controller.signal,
      });
      if (!response.ok) throw await this.errorFromResponse(response);
      if (!response.body) throw new Error('event stream has no body');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = new SseParser();
      try {
        while (!controller.signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) {
            for (const event of parser.feed(decoder.decode(), true)) emit(event);
            break;
          }
          for (const event of parser.feed(decoder.decode(chunk.value, { stream: true }))) emit(event);
        }
      } finally {
        reader.releaseLock();
      }
    };

    const done = (async (): Promise<void> => {
      let delay = minDelay;
      while (!controller.signal.aborted && !stopped) {
        try {
          await consume();
          if (controller.signal.aborted || stopped) break;
          await catchUp();
          delay = minDelay;
        } catch (error) {
          if (controller.signal.aborted || stopped) break;
          options.onError?.(error);
          try { await catchUp(); } catch (backfillError) {
            if (!controller.signal.aborted && !stopped) options.onError?.(backfillError);
          }
          delay = Math.min(maxDelay, delay * 2);
        }
        await sleep(delay, controller.signal);
      }
    })().finally(() => {
      stopped = true;
      if (external) external.removeEventListener('abort', abort);
    });

    return {
      close: () => {
        stopped = true;
        controller.abort();
      },
      done,
    };
  }

  private async parse<T>(response: Response): Promise<T> {
    if (!response.ok) throw await this.errorFromResponse(response);
    const body = await response.json() as unknown;
    return body as T;
  }

  private async errorFromResponse(response: Response): Promise<WorldApiError> {
    let body: unknown = null;
    try { body = await response.clone().json(); } catch {
      try { body = await response.clone().text(); } catch { /* empty response */ }
    }
    const detail = typeof body === 'object' && body !== null && 'detail' in body
      ? (body as { detail?: { code?: string; message?: string } }).detail
      : undefined;
    const message = detail?.message || (typeof body === 'string' && body) || 'world request failed';
    return new WorldApiError(response.status, detail?.code, message);
  }
}

export function createWorldApiClient(baseUrl?: string): WorldApiClient {
  return new WorldApiClient(baseUrl);
}
