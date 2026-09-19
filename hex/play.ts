// These modules are the existing Pixi renderer.  Their public surface is
// deliberately small, but they are plain JavaScript, so keep the boundary
// untyped instead of making the new client depend on generated declarations.
// @ts-ignore -- legacy renderer module
import { createStage } from './stage.js';
// @ts-ignore -- legacy renderer module
import { ROOMS, assignSpots } from './rooms.js';
import { PlayApiClient, PlayApiError, type IntentDraftResponse, type PlayEvent, type PlayProfile, type PlaySnapshot, type SessionResponse, type StoryDraftResponse } from './play-api';
import { createLocalSaveEnvelope, emptyLocalState, hasCompletedLocalWorld, initialPlaySnapshot, normalizeLocalState, PLAY_STORAGE_KEY, restorePendingStoryDraft, type LocalState } from './play-state';

const STORAGE_KEY = PLAY_STORAGE_KEY;
const LEGACY_KEY = 'voodoo-hex-v5';
const ROOM_TO_STAGE: Record<string, string> = { office: 'office', kitchen: 'kitchen', street: 'street', bar: 'bar', parlor: 'bedroom', home: 'bedroom', bedroom: 'bedroom', hall: 'corridor', station: 'corridor', garden: 'street', attic: 'office' };
const ROOM_LABELS: Record<string, string> = { parlor: '会客厅', bedroom: '卧室', hall: '走廊', station: '地铁站', office: '办公室', home: '家里', kitchen: '厨房', street: '街上', garden: '花园', attic: '阁楼', bar: '酒吧' };
const TRAVEL_ROOMS = ['parlor', 'bedroom', 'hall', 'office', 'home', 'bar', 'kitchen', 'street', 'station', 'garden', 'attic'];

type Ui = { root: HTMLElement; state: HTMLElement; content: HTMLElement; log: HTMLElement; stage: HTMLElement; input: HTMLInputElement; send: HTMLButtonElement; onIntent?: (value: string) => void };

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function text(value: unknown, fallback = ''): string { return typeof value === 'string' ? value : fallback; }
function requestId(): string { return globalThis.crypto?.randomUUID?.() ?? `request-${Date.now()}`; }
function saveLocal(value: LocalState): void { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* private browsing */ } }
function backupLocal(raw: string): void { try { const key = `${STORAGE_KEY}-pre-repair-backup`; if (!localStorage.getItem(key)) localStorage.setItem(key, raw); } catch { /* private browsing */ } }
function loadLocal(): LocalState | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const normalized = normalizeLocalState(parsed);
    if (!normalized) { backupLocal(raw); return null; }
    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) { backupLocal(raw); saveLocal(normalized); }
    return normalized;
  } catch {
    if (raw) backupLocal(raw);
    return null;
  }
}
function download(name: string, value: unknown): void { const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 0); }
function roomLabel(room: string): string { return ROOM_LABELS[room] || room || '未知地点'; }
function displayName(id: string, profile: PlayProfile): string { return id === 'YOU' ? '你' : id === 'PLAYER_DOLL' ? profile.dollName || '巫毒娃娃' : id === 'ENV' ? '环境' : text(profile.names?.[id], id); }

function buildUi(): Ui {
  document.body.innerHTML = '<main id="single-player-root" class="single-player"></main>';
  const root = document.querySelector<HTMLElement>('#single-player-root')!;
  root.innerHTML = `<header class="single-top"><div class="single-brand">✶ 巫柜</div><div id="single-state" class="single-state">正在打开房间…</div><div id="single-tools" class="single-tools"></div></header><section id="single-content"></section><section id="single-log" class="single-log" aria-live="polite"></section><div class="single-compose single-hidden" id="single-compose"><input id="single-input" class="single-input" maxlength="240" placeholder="告诉巫毒娃娃你想做什么" autocomplete="off"><button id="single-send" class="single-button primary" type="button">说</button></div>`;
  return { root, state: root.querySelector('#single-state')!, content: root.querySelector('#single-content')!, log: root.querySelector('#single-log')!, stage: root, input: root.querySelector('#single-input')!, send: root.querySelector('#single-send')! };
}

function button(label: string, onClick: () => void, primary = false): HTMLButtonElement { const el = document.createElement('button'); el.className = `single-button${primary ? ' primary' : ''}`; el.textContent = label; el.type = 'button'; el.addEventListener('click', onClick); return el; }
function appendLine(ui: Ui, who: string, value: string, _profile: PlayProfile, system = false): void { const line = document.createElement('div'); line.className = `single-line${system ? ' system' : ''}`; line.innerHTML = `<small></small><span></span>`; line.querySelector('small')!.textContent = who; line.querySelector('span')!.textContent = value; ui.log.appendChild(line); ui.log.scrollTop = ui.log.scrollHeight; }
function updateLog(ui: Ui, state: LocalState): void { ui.log.innerHTML = ''; state.log.slice(-40).forEach((item) => appendLine(ui, item.who, item.text, state.profile)); }
function addLog(ui: Ui, state: LocalState, who: string, value: string): void { if (!value) return; state.log.push({ who, text: value }); updateLog(ui, state); saveLocal(state); }

function applySnapshot(state: LocalState, snapshot: PlaySnapshot, profile?: PlayProfile): void { state.snapshot = clone(snapshot); if (profile) state.profile = { ...state.profile, ...clone(profile), names: { ...state.profile.names, ...(profile.names || {}) } }; }
function renderSnapshot(ui: Ui, state: LocalState): void {
  const snapshot = state.snapshot;
  ui.state.textContent = `${state.offline ? '本地试玩 · ' : ''}${roomLabel(snapshot.roomId)} · ${clockText(snapshot.clock)}`;
  const ids = snapshot.present || ['YOU'];
  const chips = ids.map((id) => `<span class="single-pill">${escapeHtml(displayName(id, state.profile))}</span>`).join('');
  const relationEntries = Object.entries(snapshot.relationships || {}).slice(0, 6).map(([key, rel]) => `${key.split(':').map((id) => displayName(id, state.profile)).join(' · ')}：${text(rel.summary, text(rel.label, '关系在变化'))}`).join('　');
  // `renderSnapshot` can run before or after the Pixi stage is created.  Keep
  // the existing host so a re-render never detaches the canvas from Pixi.
  if (!ui.content.querySelector('#single-stage-host')) {
    const stageHost = document.createElement('div'); stageHost.className = 'single-stage'; stageHost.id = 'single-stage-host'; ui.content.prepend(stageHost);
  }
  const meta = ui.content.querySelector('#single-meta'); if (meta) meta.innerHTML = `<span class="single-pill">地点：${escapeHtml(roomLabel(snapshot.roomId))}</span><span class="single-pill">在场：${ids.map((id) => escapeHtml(displayName(id, state.profile))).join('、')}</span>${snapshot.clock ? `<span class="single-pill">${escapeHtml(clockText(snapshot.clock))}</span>` : ''}`;
  const relations = ui.content.querySelector('#single-relations'); if (relations) relations.textContent = relationEntries || '关系会在你们相处后慢慢改变。';
  if (ui.onIntent && ui.content.querySelector('#single-quick-actions')) renderQuickActions(ui, state, ui.onIntent);
}
function clockText(clock: PlaySnapshot['clock']): string { if (!clock) return '时间未知'; const minute = Math.max(0, Math.min(1439, Number(clock.minute) || 0)); return `第 ${Number(clock.day) || 1} 天 ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`; }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)); }
function isNetworkFailure(error: unknown): boolean { return error instanceof PlayApiError && error.status === 0; }
function errorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof PlayApiError)) return fallback;
  const messages: Record<string, string> = {
    unsupported_intent: '这一步还不能执行。可以先点下方的地点、观察或与在场角色交谈。',
    invalid_text: '请写下 1 到 240 个字的行动。',
    invalid_story: '请补充一段有效的开场故事。',
    invalid_dollName: '请给巫毒娃娃填写一个有效的名字。',
    invalid_name: '角色名字需要在 12 个字以内。',
    stale_version: '世界刚刚发生了变化，请重新选择这一步。',
    version_conflict: '世界刚刚发生了变化，请重新选择这一步。',
    unknown_turn: '这份行动预览已经过期，请重新选择。',
  };
  if (error.code && messages[error.code]) return messages[error.code];
  if (error.status === 0) return '连接暂时不可用，已保留当前进度。';
  if (error.status >= 500) return '世界暂时没有回应，请稍后再试。';
  return fallback;
}

function stageModel(state: LocalState): { room: any; actors: Array<{ castId: string; spot: any }>; ambient: Record<string, unknown> } {
  const stageId = ROOM_TO_STAGE[state.snapshot.roomId] || 'bedroom'; const room = ROOMS[stageId as keyof typeof ROOMS] || ROOMS.bedroom; const ids = (state.snapshot.present || ['YOU']).filter((id) => ['YOU', 'A', 'B', 'C', 'Z'].includes(id)); const spots = assignSpots(stageId, ids); return { room, actors: ids.map((castId) => ({ castId, spot: spots[castId] })), ambient: state.snapshot.environment || {} };
}
async function renderStage(ui: Ui, state: LocalState, stage: any): Promise<void> { stage?.setModel(stageModel(state)); }

function setEntryEnabled(ui: Ui, enabled: boolean): void {
  ui.input.disabled = !enabled;
  ui.send.disabled = !enabled;
  ui.root.querySelectorAll<HTMLButtonElement>('[data-quick-action]').forEach((item) => { item.disabled = !enabled; });
}

function quickButton(label: string, value: string, onIntent: (text: string) => void): HTMLButtonElement {
  const item = button(label, () => onIntent(value));
  item.dataset.quickAction = 'true';
  return item;
}

function renderQuickActions(ui: Ui, state: LocalState, onIntent: (text: string) => void): void {
  const host = ui.content.querySelector<HTMLElement>('#single-quick-actions');
  if (!host) return;
  host.innerHTML = '';
  const immediate = document.createElement('div'); immediate.className = 'single-action-row';
  immediate.append(quickButton('观察周围', '观察周围', onIntent), quickButton('等十分钟', '等待十分钟', onIntent));
  const people = (state.snapshot.present || []).filter((id) => !['YOU', 'PLAYER_DOLL', 'ENV'].includes(id));
  people.forEach((id) => {
    const name = displayName(id, state.profile);
    immediate.append(quickButton(`和${name}聊聊`, `问${name}：你现在在想什么？`, onIntent));
  });
  host.append(immediate);

  const travelTitle = document.createElement('h3'); travelTitle.textContent = '去别处'; host.append(travelTitle);
  const travel = document.createElement('div'); travel.className = 'single-action-row';
  TRAVEL_ROOMS.filter((room) => room !== state.snapshot.roomId).forEach((room) => {
    const occupants = Object.entries(state.snapshot.agents || {})
      .filter(([id, agent]) => !['YOU', 'PLAYER_DOLL', 'ENV'].includes(id) && agent?.roomId === room)
      .map(([id]) => displayName(id, state.profile));
    const suffix = occupants.length ? ` · ${occupants.slice(0, 2).join('、')}` : '';
    travel.append(quickButton(`${roomLabel(room)}${suffix}`, `去${roomLabel(room)}`, onIntent));
  });
  host.append(travel);
}

function setupPlayContent(ui: Ui, state: LocalState, stage: any, onIntent: (text: string) => void): void {
  ui.content.innerHTML = `<section class="single-card"><div id="single-meta" class="single-meta"></div><section class="single-choices" aria-label="可执行动作"><h2>你现在可以</h2><div id="single-quick-actions"></div></section><div id="single-stage-host" class="single-stage"></div><div id="single-relations" class="single-relations">关系会在你们相处后慢慢改变。</div></section>`;
  const canvas = stage?.app?.canvas as HTMLCanvasElement | undefined;
  const stageHost = ui.content.querySelector('#single-stage-host')!;
  if (canvas) stageHost.appendChild(canvas);
  else stageHost.textContent = '舞台暂时打不开，文字玩法仍可继续。';
  ui.onIntent = onIntent;
  renderQuickActions(ui, state, onIntent);
  ui.input.parentElement?.classList.remove('single-hidden');
  ui.send.onclick = () => { const value = ui.input.value.trim(); if (value) { ui.input.value = ''; onIntent(value); } };
  ui.input.onkeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); ui.send.click(); } };
}
function renderOnboarding(ui: Ui, initial: Partial<PlayProfile> & { story?: string }, submit: (data: { dollName: string; story: string; names: Record<string, string> }) => Promise<void> | void, legacyAvailable = false, localRecoveryAvailable = false): void {
  const legacyHint = legacyAvailable ? '<p class="single-notice">发现旧模式的本机记录。它不会被自动覆盖；如需查看，请用地址后面的 <code>?legacy=1</code> 打开旧模式，再导出后从右上角导入。</p>' : '';
  const recoveryHint = localRecoveryAvailable ? '<p class="single-notice">发现这台设备上的试玩进度，但当前浏览器会话是一个新世界。旧进度仍保留；可先从右上角导出，再导入到当前世界，或重新确认下面的故事。</p>' : '';
  ui.content.innerHTML = `<section class="single-card"><h1>先把这个世界交给巫柜</h1><p>你说一个故事，它会先搭出一个可以走进去的地方。确认前，故事不会写进正式世界。</p>${legacyHint}${recoveryHint}<label class="single-label">给娃娃取个名字</label><input id="doll-name" class="single-input" maxlength="12" value="${escapeHtml(initial.dollName || '')}" placeholder="比如：小墨"><label class="single-label">世界从哪里开始</label><textarea id="story" class="single-textarea" maxlength="600" placeholder="比如：我在办公室遇见了一个总在加班的人…">${escapeHtml(initial.story || '')}</textarea><label class="single-label">角色 A 的名字</label><input id="name-a" class="single-input" maxlength="12" value="${escapeHtml(initial.names?.A || '')}" placeholder="林川"><label class="single-label">角色 B 的名字</label><input id="name-b" class="single-input" maxlength="12" value="${escapeHtml(initial.names?.B || '')}" placeholder="沈青"><label class="single-label">角色 C 的名字</label><input id="name-c" class="single-input" maxlength="12" value="${escapeHtml(initial.names?.C || '')}" placeholder="周野"><div class="single-actions" id="onboarding-actions"></div><p class="single-error single-hidden" id="onboarding-error"></p></section>`;
  const actions = ui.content.querySelector('#onboarding-actions')!;
  const submitButton = button('搭一个预览', async () => {
    const dollName = (ui.content.querySelector('#doll-name') as HTMLInputElement).value.trim();
    const story = (ui.content.querySelector('#story') as HTMLTextAreaElement).value.trim();
    const names = { A: (ui.content.querySelector('#name-a') as HTMLInputElement).value.trim() || '角色 A', B: (ui.content.querySelector('#name-b') as HTMLInputElement).value.trim() || '角色 B', C: (ui.content.querySelector('#name-c') as HTMLInputElement).value.trim() || '角色 C' };
    if (!dollName || story.length < 4) { const error = ui.content.querySelector('#onboarding-error')!; error.textContent = '请先写下娃娃名字和一段故事。'; error.classList.remove('single-hidden'); return; }
    submitButton.disabled = true;
    submitButton.textContent = '正在搭建…';
    await submit({ dollName, story, names });
    if (submitButton.isConnected) { submitButton.disabled = false; submitButton.textContent = '搭一个预览'; }
  }, true);
  actions.appendChild(submitButton);
}

function renderStoryPreview(ui: Ui, draft: StoryDraftResponse, confirm: () => Promise<void> | void, cancel: () => Promise<void> | void): void {
  ui.content.innerHTML = `<section class="single-card"><h2>它听成了这样</h2><p>这是预览。你确认后，房间、时间表和角色才会进入正式世界。</p><div class="single-preview"></div><div class="single-actions" id="story-actions"></div></section>`;
  ui.content.querySelector('.single-preview')!.textContent = `娃娃：${draft.preview.dollName}\n故事：${draft.preview.story}\n角色：${Object.values(draft.preview.names || {}).join('、')}\n地点：${Object.values(draft.preview.roomLabels || {}).join('、') || '从卧室开始'}`;
  const actions = ui.content.querySelector('#story-actions')!;
  let busy = false;
  const run = async (task: () => Promise<void> | void, message: string): Promise<void> => {
    if (busy) return;
    busy = true;
    actions.querySelectorAll<HTMLButtonElement>('button').forEach((item) => { item.disabled = true; });
    ui.state.textContent = message;
    await task();
    if (actions.isConnected) actions.querySelectorAll<HTMLButtonElement>('button').forEach((item) => { item.disabled = false; });
    busy = false;
  };
  actions.append(button('确认进入', () => { void run(confirm, '正在进入世界…'); }, true), button('改一改', () => { void run(cancel, '正在撤回预览…'); }));
}
function renderIntentPreview(ui: Ui, draft: IntentDraftResponse, confirm: () => void, cancel: () => void): void { ui.content.querySelector('#intent-preview')?.remove(); const card = document.createElement('div'); card.id = 'intent-preview'; card.className = 'single-card'; card.innerHTML = '<h2>巫毒娃娃准备这样做</h2><div class="single-preview"></div><div class="single-actions"></div>'; card.querySelector('.single-preview')!.textContent = `${draft.ack}\n${text(draft.preview?.text, '它会把这句话带进当前房间。')}`; const actions = card.querySelector('.single-actions')!; actions.append(button('就这样做', confirm, true), button('先不做', cancel)); ui.content.appendChild(card); }

async function localStory(ui: Ui, state: LocalState, input: { dollName: string; story: string; names: Record<string, string> }): Promise<void> { state.profile = { dollName: input.dollName, story: input.story, names: input.names, modelEnabled: false }; state.snapshot = initialPlaySnapshot(); state.pending = undefined; state.offline = true; saveLocal(state); addLog(ui, state, '巫柜', '它先在本机搭好了一个小房间。'); renderSnapshot(ui, state); }
function localIntent(ui: Ui, state: LocalState, value: string): IntentDraftResponse { const turnId = `local-${requestId()}`; state.pending = { kind: 'intent', id: turnId, text: value, preview: { text: value } }; saveLocal(state); return { turnId, status: 'draft', ack: '它听见了，准备把这句话变成动作。', preview: { text: value }, worldVersion: state.snapshot.worldVersion }; }
function applyLocalIntent(ui: Ui, state: LocalState, textValue: string): void { const move = Object.entries(ROOM_LABELS).sort((left, right) => right[1].length - left[1].length).find(([, label]) => textValue.includes(label))?.[0]; if (move) state.snapshot.roomId = move; if (/十分钟|等/.test(textValue) && state.snapshot.clock) state.snapshot.clock.minute = (state.snapshot.clock.minute + 10) % 1440; state.snapshot.worldVersion += 1; addLog(ui, state, '你', textValue); addLog(ui, state, state.profile.dollName || '巫柜', '它把你的话放进了这个世界。'); state.pending = undefined; saveLocal(state); }
function renderIntentEvents(ui: Ui, state: LocalState, events: PlayEvent[]): void { events.forEach((event) => { const value = text(event.payload?.text) || (event.action === 'silence' ? '沉默了一会儿，没有回答。' : ''); if (value) addLog(ui, state, displayName(text(event.actor, '巫柜'), state.profile), value); }); }

async function run(): Promise<void> {
  const ui = buildUi(); const api = new PlayApiClient(); let stage: any = null; const existingLocal = loadLocal(); const legacyAvailable = !existingLocal && (() => { try { return Boolean(localStorage.getItem(LEGACY_KEY)); } catch { return false; } })(); let state: LocalState = existingLocal || emptyLocalState(); let session: SessionResponse | null = null;
  const setState = (message: string) => { ui.state.textContent = message; };
  let serverProfileReady = false;
  let localRecoveryAvailable = false;
  let operationInFlight = false;
  const setToolsEnabled = (enabled: boolean): void => {
    ui.root.querySelectorAll<HTMLButtonElement>('#single-tools button').forEach((item) => { item.disabled = !enabled; });
  };
  function syncControls(): void {
    const pending = state.pending;
    const locked = operationInFlight;
    ui.input.disabled = locked || Boolean(pending);
    ui.send.disabled = locked || Boolean(pending);
    ui.root.querySelectorAll<HTMLButtonElement>('[data-quick-action]').forEach((item) => { item.disabled = locked || Boolean(pending); });
    setToolsEnabled(!locked && !pending);
    ui.content.querySelectorAll<HTMLButtonElement>('button').forEach((item) => { item.disabled = locked; });
    if (!locked && pending?.kind === 'intent') {
      ui.content.querySelectorAll<HTMLButtonElement>('#intent-preview button').forEach((item) => { item.disabled = false; });
    }
    if (!locked && pending?.kind === 'story') {
      ui.content.querySelectorAll<HTMLButtonElement>('#story-actions button').forEach((item) => { item.disabled = false; });
    }
  }
  const setOperationInFlight = (busy: boolean): void => {
    operationInFlight = busy;
    syncControls();
  };
  try {
    session = await api.getSession();
    serverProfileReady = Boolean(session.profile.dollName && (session.profile.story || session.profile.onboardingPhase === 'names-confirmed'));
    if (serverProfileReady && state.pending?.kind === 'story') {
      state.pending = undefined;
      saveLocal(state);
    }
    if (!serverProfileReady && hasCompletedLocalWorld(existingLocal)) {
      localRecoveryAvailable = true;
      state.offline = true;
    } else {
      state.offline = false;
      applySnapshot(state, session.snapshot, serverProfileReady ? session.profile : undefined);
      saveLocal(state);
    }
  } catch { state.offline = true; }
  if (!session && (state.profile.dollName && state.profile.story)) { setState('本地试玩 · 可随时重连'); } else if (!session) { setState('暂时离线 · 先在本机试玩'); }
  const showPlay = async () => {
    if (!stage) {
      try { stage = await createStage(ui.root.querySelector('#single-stage-host') || ui.root); }
      catch { stage = null; setState(`${state.offline ? '本地试玩 · ' : ''}舞台暂时不可用，文字玩法仍可继续`); }
    }
    let busy = false;
    let intentOpen = false;
    const setPreviewButtons = (disabled: boolean): void => {
      ui.content.querySelectorAll<HTMLButtonElement>('#intent-preview button').forEach((item) => { item.disabled = disabled; });
    };
    const showIntentDraft = (draft: IntentDraftResponse, value: string, local = false): void => {
      busy = false;
      setOperationInFlight(false);
      intentOpen = true;
      state.pending = { kind: 'intent', id: draft.turnId, text: value, preview: draft.preview };
      saveLocal(state);
      renderIntentPreview(ui, draft, async () => {
        if (busy || operationInFlight) return;
        busy = true;
        setOperationInFlight(true);
        setPreviewButtons(true);
        setState(local ? '正在写入本机世界…' : '世界正在回应…');
        try {
          if (local) {
            applyLocalIntent(ui, state, value);
          } else {
            const committed = await api.confirmIntent(draft.turnId);
            state.offline = false;
            applySnapshot(state, committed.snapshot, committed.profile);
            state.pending = undefined;
            renderIntentEvents(ui, state, committed.events || []);
            saveLocal(state);
          }
          intentOpen = false;
          ui.content.querySelector('#intent-preview')?.remove();
          renderSnapshot(ui, state);
          await renderStage(ui, state, stage);
          setEntryEnabled(ui, true);
          setToolsEnabled(true);
        } catch (error) {
          setState(isNetworkFailure(error) ? '确认结果还不知道，连接恢复后可原地重试' : errorMessage(error, '这一步没有通过检查'));
          setPreviewButtons(false);
        } finally {
          busy = false;
          setOperationInFlight(false);
        }
      }, async () => {
        if (busy || operationInFlight) return;
        busy = true;
        setOperationInFlight(true);
        setPreviewButtons(true);
        setState('正在取消行动…');
        if (!local) await api.cancelIntent(draft.turnId).catch(() => {});
        state.pending = undefined;
        saveLocal(state);
        ui.content.querySelector('#intent-preview')?.remove();
        intentOpen = false;
        busy = false;
        setEntryEnabled(ui, true);
        setOperationInFlight(false);
        setToolsEnabled(true);
        renderSnapshot(ui, state);
      });
      setEntryEnabled(ui, false);
      syncControls();
      setState('行动预览 · 等待确认');
    };
    const submitIntent = async (rawValue: string): Promise<void> => {
      const value = rawValue.trim();
      if (!value || busy || intentOpen || operationInFlight) return;
      busy = true;
      setOperationInFlight(true);
      setEntryEnabled(ui, false);
      setState('巫毒娃娃正在理解…');
      try {
        if (state.offline) {
          showIntentDraft(localIntent(ui, state, value), value, true);
          return;
        }
        const draft = await api.createIntent(value, requestId(), state.snapshot.worldVersion);
        showIntentDraft(draft, value);
      } catch (error) {
        if (isNetworkFailure(error)) {
          state.offline = true;
          showIntentDraft(localIntent(ui, state, value), value, true);
        } else {
          setState(errorMessage(error, '这句话还不能在当前房间执行'));
          setEntryEnabled(ui, true);
        }
      } finally {
        if (!intentOpen) {
          busy = false;
          setOperationInFlight(false);
        }
      }
    };
    setupPlayContent(ui, state, stage, (value) => { void submitIntent(value); });
    renderSnapshot(ui, state); updateLog(ui, state); await renderStage(ui, state, stage);
    const pending = state.pending;
    if (!state.offline && pending?.kind === 'intent' && pending.text) {
      showIntentDraft({ turnId: pending.id, status: 'draft', ack: '这一步仍在等待你的确认。', preview: pending.preview || { text: pending.text }, worldVersion: state.snapshot.worldVersion }, pending.text);
    }
  };
  function showOnboarding(initial: Partial<PlayProfile> & { story?: string } = state.profile): void {
    renderOnboarding(ui, initial, async (input) => {
    if (operationInFlight) return;
    setOperationInFlight(true);
    setState('正在整理故事…');
    try {
      const draft = await api.createStoryDraft(input);
      state.offline = false;
      localRecoveryAvailable = false;
      showStoryDraft(draft);
    } catch (error) {
      if (isNetworkFailure(error)) { await localStory(ui, state, input); await showPlay(); }
      else {
        const target = ui.content.querySelector('#onboarding-error');
        if (target) { target.textContent = errorMessage(error, '故事没有通过检查'); target.classList.remove('single-hidden'); }
        setState('故事还没有写入世界');
      }
    } finally {
      setOperationInFlight(false);
      setToolsEnabled(!state.pending);
    }
    }, legacyAvailable, localRecoveryAvailable);
  }
  function showStoryDraft(draft: StoryDraftResponse): void {
    state.pending = { kind: 'story', id: draft.draftId, preview: draft.preview, worldVersion: draft.worldVersion };
    saveLocal(state);
    setState('故事预览 · 等待确认');
    renderStoryPreview(ui, draft, async () => {
      if (operationInFlight) return;
      setOperationInFlight(true);
      try {
        const saved = await api.confirmStoryDraft(draft.draftId, draft.worldVersion);
        state.offline = false;
        serverProfileReady = true;
        localRecoveryAvailable = false;
        applySnapshot(state, saved.snapshot, saved.profile);
        state.pending = undefined;
        saveLocal(state);
        await showPlay();
      } catch (error) {
        setState(isNetworkFailure(error) ? '确认结果还不知道，连接恢复后可原地重试' : errorMessage(error, '这个世界没有通过确认'));
      } finally {
        setOperationInFlight(false);
        setToolsEnabled(!state.pending);
      }
    }, async () => {
      if (operationInFlight) return;
      setOperationInFlight(true);
      await api.cancelStoryDraft(draft.draftId).catch(() => {});
      state.pending = undefined;
      saveLocal(state);
      setOperationInFlight(false);
      setToolsEnabled(true);
      setState('故事还没有写入世界');
      showOnboarding({ dollName: draft.preview.dollName, story: draft.preview.story, names: draft.preview.names });
    });
    syncControls();
  }
  // A reachable session can still be a brand-new world.  The story form is
  // therefore selected from profile completeness, not network availability.
  const restoredStoryDraft = restorePendingStoryDraft(state);
  if (session && !serverProfileReady && restoredStoryDraft) showStoryDraft(restoredStoryDraft);
  else if (session && !serverProfileReady) { setState(localRecoveryAvailable ? '本机进度已保留 · 可导出后导入当前世界' : '等待你讲第一个故事'); showOnboarding(existingLocal?.profile || state.profile); }
  else if (!(state.profile.dollName && state.profile.story)) showOnboarding();
  else await showPlay();
  const exportButton = button('导出', async () => { if (operationInFlight || state.pending) return; setOperationInFlight(true); try { download('巫柜保存.json', state.offline ? createLocalSaveEnvelope(state) : await api.exportSave()); } catch { download('巫柜本机保存.json', createLocalSaveEnvelope(state)); } finally { setOperationInFlight(false); } }); exportButton.title = '导出保存';
  const importButton = button('导入', () => {
    if (operationInFlight || state.pending) { setState('请先确认或取消当前预览，再导入保存。'); return; }
    const file = document.createElement('input'); file.type = 'file'; file.accept = 'application/json';
    file.onchange = async () => {
      const selected = file.files?.[0]; if (!selected) return;
      if (operationInFlight || state.pending) { setState('请先完成当前操作，再导入保存。'); return; }
      setOperationInFlight(true);
      setEntryEnabled(ui, false);
      ui.content.querySelectorAll<HTMLButtonElement>('button').forEach((item) => { item.disabled = true; });
      setState('正在检查保存记录…');
      try {
        const payload = JSON.parse(await selected.text());
        const imported = await api.importSave(payload);
        state.offline = false; serverProfileReady = true; applySnapshot(state, imported.snapshot, imported.profile); state.pending = undefined; saveLocal(state); await showPlay();
      } catch (error) {
        setState(errorMessage(error, '导入没有完成，本机记录仍在'));
      } finally {
        setOperationInFlight(false);
        setEntryEnabled(ui, !state.pending);
      }
    };
    file.click();
  }); importButton.title = '导入保存';
  ui.root.querySelector('#single-tools')!.append(exportButton, importButton);
  syncControls();
}

function renderFatal(): void {
  document.body.innerHTML = '<main class="single-player"><section class="single-card"><h1>房间没有打开</h1><p>本机记录或页面资源出现了问题。你可以重新载入；如果仍然无法进入，可以清理这份本机界面记录，服务端世界不会因此删除。</p><div class="single-actions" id="fatal-actions"></div></section></main>';
  const actions = document.querySelector('#fatal-actions');
  actions?.append(
    button('重新载入', () => location.reload(), true),
    button('修复本机记录', () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) backupLocal(raw);
        localStorage.removeItem(STORAGE_KEY);
      } catch { /* private browsing */ }
      location.reload();
    }),
  );
}

void run().catch(() => renderFatal());
