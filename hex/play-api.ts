export type PlayClock = { day: number; minute: number; clockVersion?: number; timezone?: string };
export type DialogueLine = { speakerId: string; kind: 'speech' | 'thought' | 'narration'; text: string };
export type PlayGuidance = {
  title: string;
  chapter: string;
  objective: string;
  passage: string;
  dialogueId?: string;
  dialogue?: DialogueLine[];
  completed?: boolean;
  ending?: string;
  playerRoutine?: string;
  scheduleHint?: string;
  actions: Array<{ id: string; label: string; intent: string; minutes?: number; reason?: string }>;
};
export type StoryInput = { dollName: string; story: string; names: Record<string, string>; templateId?: string };
export type PlayEvent = {
  eventId: string;
  turnId?: string;
  actor?: string;
  action?: string;
  payload?: Record<string, unknown>;
  createdAt?: number;
};
export type PlaySnapshot = {
  worldId?: string;
  worldVersion: number;
  roomId: string;
  present: string[];
  agents?: Record<string, { id?: string; kind?: string; roomId?: string; memory?: unknown[] }>;
  relationships?: Record<string, Record<string, unknown>>;
  environment?: Record<string, unknown>;
  clock?: PlayClock | null;
  guidance?: PlayGuidance;
  [key: string]: unknown;
};
export type PlayProfile = {
  dollName: string;
  names: Record<string, string>;
  story?: string;
  modelEnabled?: boolean;
  [key: string]: unknown;
};
export type SessionResponse = {
  // The server owns the anonymous session identity in an HttpOnly cookie.
  // Older deployments may still include this field, so keep it optional for
  // response compatibility without ever sending it back from the client.
  sessionId?: string;
  snapshot: PlaySnapshot;
  profile: PlayProfile;
  modelEnabled: boolean;
};
export type StoryDraftPreview = {
  story: string;
  dollName: string;
  names: Record<string, string>;
  roomLabels?: string[] | Record<string, string>;
  schedules?: unknown[];
};
export type StoryDraftResponse = {
  draftId: string;
  preview: StoryDraftPreview;
  worldVersion: number;
};
export type IntentDraftResponse = {
  turnId: string;
  status: 'draft';
  ack: string;
  preview: Record<string, unknown>;
  worldVersion: number;
};
export type IntentCommitResponse = {
  turnId: string;
  worldVersion: number;
  events: PlayEvent[];
  snapshot: PlaySnapshot;
  profile: PlayProfile;
  source?: string;
};

export class PlayApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly body?: unknown;
  constructor(status: number, message: string, code?: string, body?: unknown) {
    super(message);
    this.name = 'PlayApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export type FetchLike = typeof fetch;

export class PlayApiClient {
  private readonly base: string;
  private readonly playBase: string;
  private readonly fetchImpl: FetchLike;
  constructor(base = '/api/v4', fetchImpl: FetchLike = fetch.bind(globalThis)) {
    this.base = base.replace(/\/$/, '');
    this.playBase = `${this.base}/play`;
    this.fetchImpl = fetchImpl;
  }
  private async request<T>(url: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, { credentials: 'include', ...init });
    } catch (error) {
      throw new PlayApiError(0, error instanceof Error ? error.message : '网络暂时不可用');
    }
    let body: unknown = null;
    try { body = await response.json(); } catch { /* empty response */ }
    if (!response.ok) {
      const raw = body && typeof body === 'object' ? body as Record<string, unknown> : {};
      const detail = raw.detail && typeof raw.detail === 'object' ? raw.detail as Record<string, unknown> : raw;
      throw new PlayApiError(response.status, String(detail.message || raw.message || '请求没有完成'), typeof detail.code === 'string' ? detail.code : undefined, body);
    }
    return body as T;
  }
  getSession(): Promise<SessionResponse> {
    return this.request(`${this.base}/session`);
  }
  createStoryDraft(input: StoryInput): Promise<StoryDraftResponse> {
    return this.request(`${this.playBase}/story`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  }
  confirmStoryDraft(draftId: string, expectedVersion: number): Promise<SessionResponse & { snapshot: PlaySnapshot }> {
    return this.request(`${this.playBase}/story/${encodeURIComponent(draftId)}/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion }) });
  }
  cancelStoryDraft(draftId: string): Promise<{ draftId: string; status: string }> {
    return this.request(`${this.playBase}/story/${encodeURIComponent(draftId)}/cancel`, { method: 'POST' });
  }
  createIntent(text: string, requestId: string, expectedVersion: number): Promise<IntentDraftResponse> {
    return this.request(`${this.playBase}/intent`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, requestId, expectedVersion }) });
  }
  confirmIntent(turnId: string): Promise<IntentCommitResponse> {
    return this.request(`${this.playBase}/intent/${encodeURIComponent(turnId)}/confirm`, { method: 'POST' });
  }
  cancelIntent(turnId: string): Promise<{ turnId: string; status: string }> {
    return this.request(`${this.playBase}/intent/${encodeURIComponent(turnId)}/cancel`, { method: 'POST' });
  }
  exportSave(): Promise<unknown> { return this.request(`${this.playBase}/save`); }
  importSave(payload: unknown): Promise<SessionResponse> {
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const wrapped = typeof record.sourceKey === 'string' && record.payload && typeof record.payload === 'object';
    const singleState = record.profile !== null && typeof record.profile === 'object'
      && record.snapshot !== null && typeof record.snapshot === 'object';
    const inferred = record.schemaVersion === 5
      ? 'voodoo-hex-v5'
      : singleState
        ? 'voodoo-single-v1'
        : 'voodoo-cabinet-v1';
    const sourceKey = typeof record.sourceKey === 'string' ? record.sourceKey : inferred;
    return this.request(`${this.playBase}/save/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceKey, payload: wrapped ? record.payload : payload }) });
  }
}
