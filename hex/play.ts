import { createGalgameStage, type GalgameStage } from './play-stage';
import { ART_CREDITS, GALGAME_ART } from './play-art';
import './play-stage.css';
import { PlayApiClient, PlayApiError, type IntentDraftResponse, type PlayEvent, type PlayProfile, type PlaySnapshot, type SessionResponse, type StoryDraftResponse, type StoryInput } from './play-api';
import { appendLocalLogEntry, createLocalSaveEnvelope, emptyLocalState, hasCompletedLocalWorld, initialPlaySnapshot, normalizeLocalState, PLAY_OFFLINE_BACKUP_KEY, PLAY_STORAGE_KEY, restorePendingStoryDraft, shouldKeepLocalBranch, type LocalLogEntry, type LocalLogKind, type LocalState } from './play-state';

import { parseLocalAction, applyLocalAction } from './play-local';
import { advanceDialogue, dialogueAfterAction, restoreDialogue } from './play-dialogue';
import { hasMoreToRead, nextReadingScroll, canSubmitInput } from './play-reading';
import { isAtStoryEnd, splitGuidanceActions, type GuidanceAction } from './play-guidance';
import { latestConfirmedView } from './play-recovery';

const composingInputs = new WeakSet<HTMLInputElement>();
const readingObservers = new WeakMap<HTMLElement, () => void>();

const STORAGE_KEY = PLAY_STORAGE_KEY;
const LEGACY_KEY = 'voodoo-hex-v5';
const ROOM_LABELS: Record<string, string> = { parlor: '会客厅', bedroom: '卧室', hall: '走廊', station: '地铁站', office: '办公室', home: '家里', kitchen: '厨房', street: '街上', garden: '花园', attic: '阁楼', bar: '酒吧' };
const TUTORIAL_STORY: StoryInput = { templateId: 'signal-rain-v1', dollName: '小墨', names: { A: '林川', B: '沈青', C: '周野' }, story: '红灯下的第三次回声。三天里，你要完成档案馆的工作，追查地铁站第三次警报与 06-17 交班记录，听见沈青保存的录音，再决定和林川共同署名、公开审计，还是先保护仍在照护父亲的他。' };
const TRAVEL_ROOMS = ['parlor', 'bedroom', 'hall', 'office', 'home', 'bar', 'kitchen', 'street', 'station', 'garden', 'attic'];

type IntentHandler = (value: string, direct?: boolean) => void;

type Ui = { root: HTMLElement; state: HTMLElement; content: HTMLElement; log: HTMLElement; stage: HTMLElement; input: HTMLInputElement; send: HTMLButtonElement; onIntent?: IntentHandler; onLibrary?: () => void; performance?: GalgameStage };

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
  root.innerHTML = `<header class="single-top"><div class="single-brand">✶ 巫柜</div><details class="single-menu"><summary>菜单</summary><div id="single-tools" class="single-tools"></div></details><div id="single-state" class="single-state" role="status">正在打开房间…</div></header><section id="single-content"></section><section id="single-history" class="single-secondary" aria-label="回看" hidden><div class="single-panel-heading"><h2>回看</h2></div><div class="single-panel-body"><div id="single-backlog"></div><h2>行动记录</h2><section id="single-log" class="single-log"></section></div></section><div class="single-compose single-hidden" id="single-compose"><input id="single-input" class="single-input" maxlength="240" aria-label="自由行动或对话" placeholder="说出想做的事…" autocomplete="off"><button id="single-send" class="single-button primary" type="button">预览</button></div>`;
  const input = root.querySelector<HTMLInputElement>('#single-input')!;
  input.addEventListener('compositionstart', () => { composingInputs.add(input); });
  input.addEventListener('compositionend', () => { composingInputs.delete(input); });
  input.addEventListener('blur', () => { composingInputs.delete(input); });
  trackPlayViewport(root);
  return { root, state: root.querySelector('#single-state')!, content: root.querySelector('#single-content')!, log: root.querySelector('#single-log')!, stage: root, input: root.querySelector('#single-input')!, send: root.querySelector('#single-send')! };
}

// Browser chrome and software keyboards can resize the visible viewport without
// changing world state or rebuilding the canvas / input / reading cursor.
function trackPlayViewport(root: HTMLElement): void {
  const update = (): void => {
    const viewport = window.visualViewport;
    root.style.setProperty('--play-viewport-height', `${viewport?.height || innerHeight}px`);
    root.style.setProperty('--play-viewport-top', `${viewport?.offsetTop || 0}px`);
    const editing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
    root.classList.toggle('keyboard-open', editing && ((viewport?.height || innerHeight) < innerHeight - 80 || innerHeight < 280));
  };
  window.addEventListener('resize', update);
  window.visualViewport?.addEventListener('resize', update);
  window.visualViewport?.addEventListener('scroll', update);
  root.addEventListener('focusin', update);
  root.addEventListener('focusout', () => { requestAnimationFrame(update); });
  update();
}

function button(label: string, onClick: () => void, primary = false): HTMLButtonElement { const el = document.createElement('button'); el.className = `single-button${primary ? ' primary' : ''}`; el.textContent = label; el.type = 'button'; el.addEventListener('click', onClick); el.onkeydown = (event) => { if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault(); }; return el; }
function logContext(snapshot: PlaySnapshot): Pick<LocalLogEntry, 'roomId' | 'clock' | 'worldVersion'> {
  return {
    roomId: snapshot.roomId,
    clock: snapshot.clock ? { day: snapshot.clock.day, minute: snapshot.clock.minute } : undefined,
    worldVersion: snapshot.worldVersion,
  };
}
function contextText(item: LocalLogEntry): string {
  const clock = item.clock ? clockText(item.clock as PlaySnapshot['clock']) : '';
  const room = item.roomId ? roomLabel(item.roomId) : '';
  return [clock, room].filter(Boolean).join(' · ');
}
function appendLine(ui: Ui, item: LocalLogEntry, _profile: PlayProfile): void {
  const line = document.createElement('div');
  line.className = `single-line${item.status ? ` ${item.status}` : ''}${item.kind ? ` ${item.kind}` : ''}`;
  line.innerHTML = `<small class="single-log-who"></small><small class="single-log-context"></small><span></span>`;
  line.querySelector('small')!.textContent = `${item.who}${item.status === 'rejected' ? ' · 未执行' : item.status === 'notice' ? ' · 提示' : ''}`;
  if (item.status === 'accepted') line.querySelector('.single-log-who')!.textContent = `${item.who} · 已执行`;
  const context = contextText(item);
  const contextNode = line.querySelector<HTMLElement>('.single-log-context')!;
  contextNode.textContent = context;
  contextNode.hidden = !context;
  line.querySelector('span')!.textContent = item.text;
  ui.log.appendChild(line);
  ui.log.scrollTop = ui.log.scrollHeight;
}
function updateLog(ui: Ui, state: LocalState): void { ui.log.innerHTML = ''; state.log.slice(-40).forEach((item) => appendLine(ui, item, state.profile)); }
function addLog(ui: Ui, state: LocalState, who: string, value: string, status?: LocalLogEntry['status'], context: Pick<LocalLogEntry, 'roomId' | 'clock' | 'worldVersion'> = logContext(state.snapshot), kind?: LocalLogKind, eventId?: string): void {
  if (!value) return;
  const added = appendLocalLogEntry(state, { who, text: value, ...(eventId ? { eventId } : {}), ...(status ? { status } : {}), ...(kind ? { kind } : {}), ...context });
  if (!added) return;
  updateLog(ui, state);
  saveLocal(state);
}
function addRejectedLog(ui: Ui, state: LocalState, input: string, message: string): void {
  if (!input) return;
  const context = logContext(state.snapshot);
  // Rejected attempts are user-visible history, but are not authoritative
  // events. Keep each attempt while still applying the shared size bound.
  appendLocalLogEntry(state, { who: '你', text: input, status: 'rejected', kind: 'error', ...context });
  appendLocalLogEntry(state, { who: '巫柜', text: message, status: 'notice', kind: 'error', ...context });
  updateLog(ui, state);
  saveLocal(state);
}

function applySnapshot(state: LocalState, snapshot: PlaySnapshot, profile?: PlayProfile): void { state.snapshot = clone(snapshot); if (profile) state.profile = { ...state.profile, ...clone(profile), names: { ...state.profile.names, ...(profile.names || {}) } }; }
function renderSnapshot(ui: Ui, state: LocalState): void {
  const snapshot = state.snapshot;
  ui.state.textContent = `${state.offline ? '本地试玩 · ' : ''}${roomLabel(snapshot.roomId)} · ${clockText(snapshot.clock)}`;
  const ids = snapshot.present || ['YOU'];
  // Keep the presentation host across state updates and action feedback.
  if (!ui.content.querySelector('#single-stage-host')) {
    const stageHost = document.createElement('div'); stageHost.className = 'single-stage'; stageHost.id = 'single-stage-host'; ui.content.prepend(stageHost);
  }
  const meta = ui.content.querySelector('#single-meta'); if (meta) meta.textContent = `在场 · ${ids.map((id) => displayName(id, state.profile)).join('、')}`;
  if (ui.onIntent && ui.content.querySelector('#single-quick-actions')) { renderGuidance(ui, state, ui.onIntent); renderQuickActions(ui, state, ui.onIntent); }
}
function clockText(clock: PlaySnapshot['clock']): string { if (!clock) return '时间未知'; const minute = Math.max(0, Math.min(1439, Number(clock.minute) || 0)); return `第 ${Number(clock.day) || 1} 天 ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`; }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)); }
function isNetworkFailure(error: unknown): boolean { return error instanceof PlayApiError && error.status === 0; }
function isStaleAction(error: unknown): boolean { return error instanceof PlayApiError && ['stale_version', 'version_conflict', 'unknown_turn'].includes(error.code || ''); }
function errorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof PlayApiError)) return fallback;
  const messages: Record<string, string> = {
    unsupported_intent: '这句话暂时无法执行。可以点推荐动作、地图，或向在场的人提问。',
    backup_unavailable: '原进度暂时无法备份，本次没有开启新篇章。请检查本机存储后重试。',
    offline_backup_unavailable: '本机探索暂时无法备份，仍留在离线进度。请先导出保存，再重试。',
    invalid_text: '请写下 1 到 240 个字的行动。',
    invalid_story: '请补充一段有效的开场故事。',
    invalid_dollName: '请给巫毒娃娃填写一个有效的名字。',
    invalid_name: '角色名字需要在 12 个字以内。',
    stale_version: '世界刚刚发生了变化，请重新选择这一步。',
    version_conflict: '世界刚刚发生了变化，请重新选择这一步。',
    unknown_turn: '这份行动预览已经过期，请重新选择。',
    unknown_object: '这里还没有这件物品。试试当前场景的推荐动作。',
    object_out_of_range: '这件物品不在这里，请先去它所在的地点。',
    unsupported_object_action: '这件物品不支持这个动作。试试当前场景的推荐动作。',
    activation_required: '对方暂时不在交谈范围，看看公开行程再去找他。',
    target_not_in_room: '对方已经离开这里，看看公开行程再去找他。',
    target_not_present: '对方现在不在这里，看看公开行程再去找他。',
    target_out_of_range: '对方现在不在这里，看看公开行程再去找他。',
    already_in_room: '你已经在这里，可以观察、开门或与在场角色交谈。',
  };
  if (error.code && messages[error.code]) return messages[error.code];
  if (error.status === 0) return '连接暂时不可用，已保留当前进度。';
  if (error.status >= 500) return '世界暂时没有回应，请稍后再试。';
  return fallback;
}

async function renderStage(ui: Ui, state: LocalState, stage: GalgameStage | null): Promise<void> {
  stage?.update(state.snapshot, state.profile, state.dialogue?.lines[state.dialogue.index], state.dialogue?.choicesOpen);
}

function setEntryEnabled(ui: Ui, enabled: boolean): void {
  ui.input.disabled = !enabled;
  ui.send.disabled = !enabled;
  ui.root.querySelectorAll<HTMLButtonElement>('[data-quick-action]').forEach((item) => { item.disabled = !enabled; });
}

function quickButton(label: string, value: string, onIntent: IntentHandler): HTMLButtonElement {
  const item = button(label, () => onIntent(value, true));
  item.dataset.quickAction = 'true';
  return item;
}

function openPlayPanel(ui: Ui, panel?: string): void {
  for (const id of ['single-explore', 'single-notebook', 'single-history']) {
    const node = ui.root.querySelector<HTMLElement>(`#${id}`);
    if (node) node.hidden = id !== panel;
  }
  ui.root.dataset.openPanel = panel || '';
  const theater = ui.content.querySelector<HTMLElement>('.single-theater');
  if (theater) theater.inert = Boolean(panel);
  ui.root.querySelectorAll<HTMLButtonElement>('[data-panel]').forEach((item) => {
    item.setAttribute('aria-expanded', String(item.dataset.panel === panel));
  });
  if (panel) focusSurface(ui.root.querySelector<HTMLElement>(`#${panel} .single-panel-heading`));
}

function focusSurface(target: HTMLElement | null): void {
  if (!target) return;
  target.tabIndex = -1;
  target.focus({ preventScroll: true });
}

function addPanelClose(ui: Ui, id: string): void {
  const panel = ui.root.querySelector<HTMLElement>(`#${id}`);
  const heading = panel?.querySelector('.single-panel-heading');
  if (!heading || heading.querySelector('button')) return;
  const close = button('收起', () => {
    openPlayPanel(ui);
    ui.root.querySelector<HTMLButtonElement>(`[data-panel="${id}"]`)?.focus({ preventScroll: true });
  });
  close.setAttribute('aria-label', `收起${panel?.getAttribute('aria-label') || '面板'}`);
  heading.append(close);
}

function renderDialogue(ui: Ui, state: LocalState): void {
  const host = ui.content.querySelector<HTMLElement>('#single-dialogue');
  if (!host) return;
  readingObservers.get(host)?.();
  state.dialogue = restoreDialogue(state.snapshot, state.dialogue);
  const playback = state.dialogue;
  const line = playback.lines[playback.index];
  ui.performance?.update(state.snapshot, state.profile, line, playback.choicesOpen);
  ui.performance?.setInteractionEnabled(!ui.input.disabled && !state.offline);
  host.dataset.kind = line.kind;
  host.dataset.choices = String(playback.choicesOpen);
  host.dataset.ending = String(!state.offline && isAtStoryEnd(state.snapshot.guidance));
  delete host.dataset.preview;
  host.innerHTML = `<div class="dialogue-nameplate"><span class="dialogue-speaker"></span><small class="dialogue-kind"></small></div><button type="button" class="dialogue-page" aria-label="继续阅读"><span class="dialogue-text" aria-live="polite"></span><span class="dialogue-next" aria-hidden="true">▾</span></button><section id="single-guidance" class="single-guidance" aria-label="选择行动"></section><div class="dialogue-footer"><span class="dialogue-position"></span><div class="dialogue-controls"></div></div>`;
  host.querySelector('.dialogue-speaker')!.textContent = playback.choicesOpen ? (!state.offline && isAtStoryEnd(state.snapshot.guidance) ? '这一段故事已结束' : '你打算怎么做？') : displayName(line.kind === 'narration' ? 'PLAYER_DOLL' : line.speakerId, state.profile);
  host.querySelector('.dialogue-kind')!.textContent = playback.choicesOpen ? '' : line.kind === 'thought' ? '心声' : line.kind === 'narration' || line.speakerId === 'PLAYER_DOLL' ? '巫毒娃娃' : '对白';
  host.querySelector('.dialogue-text')!.textContent = line.kind === 'speech' ? `「${line.text}」` : line.kind === 'thought' ? `（${line.text}）` : line.text;
  const page = host.querySelector<HTMLButtonElement>('.dialogue-page')!;
  page.hidden = playback.choicesOpen;
  host.querySelector('.dialogue-position')!.textContent = playback.choicesOpen ? '' : `${playback.index + 1} / ${playback.lines.length}`;
  const redraw = (focus = false): void => {
    saveLocal(state);
    renderDialogue(ui, state);
    if (focus) {
      // Held Enter must never carry over from reading to committing a choice.
      // Focus a non-action container until the player deliberately selects.
      const target = ui.content.querySelector<HTMLElement>(state.dialogue?.choicesOpen ? '#single-guidance' : '.dialogue-page');
      if (state.dialogue?.choicesOpen) target?.setAttribute('tabindex', '-1');
      target?.focus({ preventScroll: true });
    }
  };
  const next = (): void => {
    if (hasMoreToRead(page)) {
      page.scrollTop = nextReadingScroll(page);
      updateScrollCues();
      return;
    }
    state.dialogue = advanceDialogue(playback); redraw(true);
  };
  // A drag to read long text must not be treated as a click to skip it.
  let pointerStart: { x: number; y: number } | undefined;
  let dragged = false;
  page.onpointerdown = (event) => { pointerStart = { x: event.clientX, y: event.clientY }; dragged = false; };
  const trackPointer = (event: PointerEvent): void => {
    if (pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 8) dragged = true;
  };
  page.onpointermove = trackPointer;
  page.onpointerup = trackPointer;
  page.onpointercancel = () => { dragged = true; };
  page.onclick = () => { if (!dragged) next(); dragged = false; pointerStart = undefined; };
  page.onkeydown = (event) => { if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault(); };
  const controls = host.querySelector('.dialogue-controls')!;
  let continueButton: HTMLButtonElement | undefined;
  let moreChoices: HTMLButtonElement | undefined;
  const actions = host.querySelector<HTMLElement>('#single-guidance')!;
  actions.hidden = !playback.choicesOpen;
  if (playback.choicesOpen) {
    renderChoices(ui, state, actions);
    moreChoices = button('更多选项 ↓', () => { actions.scrollTop = nextReadingScroll(actions); updateScrollCues(); });
    moreChoices.classList.add('dialogue-more');
    moreChoices.hidden = true;
    controls.append(moreChoices, button('返回对白', () => { state.dialogue = { ...playback, choicesOpen: false }; redraw(true); }));
  } else {
    controls.append(button('行动', () => { state.dialogue = { ...playback, choicesOpen: true }; redraw(true); }));
    continueButton = button('继续 ▸', next, true);
    continueButton.onkeydown = (event) => { if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault(); };
    controls.append(continueButton);
  }
  function updateScrollCues(): void {
    if (continueButton) {
      const more = hasMoreToRead(page);
      continueButton.textContent = more ? '继续阅读 ↓' : playback.index < playback.lines.length - 1 ? '继续 ▸' : '选择行动 ▸';
      page.setAttribute('aria-label', more ? '继续阅读本句' : '继续阅读');
    }
    if (moreChoices) {
      const visible = hasMoreToRead(actions);
      // Keep focus stable when the final scroll hides this button.
      if (!visible && document.activeElement === moreChoices) focusSurface(actions);
      moreChoices.hidden = !visible;
    }
  }
  page.addEventListener('scroll', updateScrollCues, { passive: true });
  actions.addEventListener('scroll', updateScrollCues, { passive: true });
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(updateScrollCues);
  observer?.observe(page); observer?.observe(actions);
  window.addEventListener('resize', updateScrollCues);
  const frame = requestAnimationFrame(updateScrollCues);
  readingObservers.set(host, () => { observer?.disconnect(); window.removeEventListener('resize', updateScrollCues); cancelAnimationFrame(frame); });
  const backlog = ui.root.querySelector<HTMLElement>('#single-backlog')!;
  backlog.innerHTML = '<h2>本段对白</h2>';
  playback.lines.slice(0, playback.index + 1).forEach((item) => {
    const p = document.createElement('p');
    const name = document.createElement('strong'); name.textContent = `${displayName(item.kind === 'narration' ? 'PLAYER_DOLL' : item.speakerId, state.profile)}${item.kind === 'thought' ? ' · 心声' : ''}`;
    p.append(name, document.createTextNode(item.text)); backlog.append(p);
  });
  // Reading and opening panels never submit a world action.
  saveLocal(state);
}

function renderChoices(ui: Ui, state: LocalState, host: HTMLElement): void {
  const guide = state.snapshot.guidance;
  const { story, exploration } = splitGuidanceActions(guide?.actions as GuidanceAction[] | undefined);
  const atEnd = !state.offline && isAtStoryEnd(guide);
  const objective = document.createElement('p'); objective.className = 'single-objective';
  objective.textContent = state.offline ? '离线探索 · 故事进度已保留' : atEnd ? '结局已保留。换个故事，或去别处走走。' : guide?.objective || '从这里出发。';
  host.append(objective);
  const actions = document.createElement('div'); actions.className = 'single-story-actions';
  if (atEnd) {
    const library = button('打开故事库', () => ui.onLibrary?.(), true);
    library.dataset.endingAction = 'library';
    const map = button('打开地图', () => {
      openPlayPanel(ui, 'single-explore');
      const travel = ui.content.querySelector<HTMLDetailsElement>('#single-travel');
      if (travel) {
        travel.open = true;
        travel.scrollIntoView({ block: 'nearest' });
        travel.querySelector('summary')?.focus({ preventScroll: true });
      }
    });
    map.dataset.endingAction = 'map';
    actions.append(library, map);
  } else if (!state.offline) (story.length ? story : exploration).slice(0, 4).forEach((action) => {
    const item = quickButton(action.label, action.intent, ui.onIntent!); item.classList.add('primary');
    item.dataset[story.length ? 'storyAction' : 'explorationAction'] = 'true';
    if (typeof action.minutes === 'number') {
      const minutes = document.createElement('small'); minutes.textContent = `约 ${action.minutes} 分钟`; item.append(minutes);
    }
    actions.append(item);
  });
  if (!actions.childElementCount) actions.append(button('去自由行动', () => {
    openPlayPanel(ui, 'single-explore');
    ui.content.querySelector('#single-explore')?.scrollIntoView({ block: 'nearest' });
  }, true));
  host.append(actions);
}

function renderGuidance(ui: Ui, state: LocalState, onIntent: IntentHandler): void {
  renderDialogue(ui, state);
  const host = ui.content.querySelector<HTMLElement>('#single-notebook-body');
  if (!host) return;
  const guide = state.snapshot.guidance;
  host.replaceChildren();
  const title = document.createElement('h2'); title.textContent = guide?.title || '我的世界';
  const chapter = document.createElement('p'); chapter.textContent = guide?.chapter || '自由探索';
  host.append(title, chapter);
  for (const value of [guide?.objective, guide?.playerRoutine, guide?.scheduleHint]) {
    if (!value) continue;
    const line = document.createElement('p'); line.textContent = value; host.append(line);
  }
  if (guide?.journal?.length) {
    const heading = document.createElement('h2'); heading.textContent = '调查笔记'; host.append(heading);
    guide.journal.forEach((entry) => {
      const item = document.createElement('p'); const title = document.createElement('strong'); title.textContent = `${entry.title}：`;
      item.append(title, document.createTextNode(entry.text)); host.append(item);
    });
  }
  const relations = document.createElement('p'); relations.id = 'single-relations';
  relations.textContent = Object.entries(state.snapshot.relationships || {}).slice(0, 6).map(([key, rel]) => `${key.split(':').map((id) => displayName(id, state.profile)).join(' · ')}：${text(rel.summary, text(rel.label, '关系在变化'))}`).join('　');
  if (relations.textContent) host.append(relations);
  const extra = ui.content.querySelector<HTMLElement>('#single-exploration-actions')!;
  extra.replaceChildren();
  if (state.offline) {
    const notice = document.createElement('p'); notice.textContent = '离线时可以观察、移动、开门和等待。联网后，在菜单选择“回到在线故事”；本机探索会先备份。'; extra.append(notice);
  } else {
    const { exploration } = splitGuidanceActions(guide?.actions as GuidanceAction[] | undefined);
    exploration.slice(0, 8).forEach((action) => {
      const item = quickButton(action.label, action.intent, onIntent); item.dataset.explorationAction = 'true'; extra.append(item);
    });
  }
  ui.input.placeholder = '自己说，例如：去地铁站';
}


function renderQuickActions(ui: Ui, state: LocalState, onIntent: IntentHandler): void {
  const host = ui.content.querySelector<HTMLElement>('#single-quick-actions');
  if (!host) return;
  host.innerHTML = '';
  const immediate = document.createElement('div'); immediate.className = 'single-action-row';
  immediate.append(quickButton('观察周围', '观察周围', onIntent), quickButton('等十分钟', '等待十分钟', onIntent));
  const people = (state.snapshot.present || []).filter((id) => !['YOU', 'PLAYER_DOLL', 'ENV'].includes(id));
  if (!state.offline) people.forEach((id) => {
    const name = displayName(id, state.profile);
    immediate.append(quickButton(`和${name}聊聊`, `问${name}：你现在在想什么？`, onIntent));
  });
  immediate.append(quickButton('开门看看', '开门', onIntent));
  host.append(immediate);
  const details = document.createElement('details'); details.id = 'single-travel';
  const summary = document.createElement('summary'); summary.textContent = '地图 · 去别处'; details.append(summary);
  const travel = document.createElement('div'); travel.className = 'single-action-row';
  TRAVEL_ROOMS.filter((room) => room !== state.snapshot.roomId).forEach((room) => {
    travel.append(quickButton(roomLabel(room), `去${roomLabel(room)}`, onIntent));
  });
  details.append(travel); host.append(details);
}

function setupPlayContent(ui: Ui, state: LocalState, stage: GalgameStage | null, onIntent: IntentHandler): void {
  stage?.settle();
  // Keep the input node (and any unsent draft) when rebuilding the play surface.
  const oldReading = ui.content.querySelector<HTMLElement>('#single-dialogue');
  if (oldReading) readingObservers.get(oldReading)?.();
  const compose = ui.input.parentElement!;
  ui.root.classList.add('is-playing');
  ui.content.innerHTML = `<section class="single-play-scene"><p class="single-rotate-hint">横过手机，场景看得更完整</p><div class="single-theater"><div id="single-meta" class="single-meta"></div><div id="single-stage-host" class="single-stage"></div><section id="single-dialogue" class="single-dialogue" aria-label="故事对话窗"></section></div><nav id="single-play-tools" class="single-play-tools" aria-label="其他玩法"></nav><section id="single-explore" class="single-secondary" aria-label="自由行动" hidden><div class="single-panel-heading"><h2>自由行动</h2></div><div class="single-panel-body"><div id="single-compose-slot"></div><div id="single-exploration-actions" class="single-action-row"></div><div id="single-quick-actions"></div></div></section><section id="single-notebook" class="single-secondary" aria-label="手记与日程" hidden><div class="single-panel-heading"><h2>手记 · 日程</h2></div><div id="single-notebook-body" class="single-panel-body"></div></section></section>`;
  ui.content.querySelector('#single-compose-slot')!.append(compose);
  compose.classList.remove('single-hidden');
  const stageHost = ui.content.querySelector('#single-stage-host')!;
  if (stage) stageHost.appendChild(stage.element);
  else stageHost.textContent = '舞台暂时打不开，文字玩法仍可继续。';
  const tools = ui.content.querySelector('#single-play-tools')!;
  for (const [id, label] of [['single-explore', '自由行动'], ['single-notebook', '手记 · 日程'], ['single-history', '回看']]) {
    const item = button(label, () => {
      const target = ui.root.querySelector<HTMLElement>(`#${id}`)!;
      const open = target.hidden;
      openPlayPanel(ui, open ? id : undefined);
      if (open) target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    item.dataset.panel = id; item.setAttribute('aria-controls', id); item.setAttribute('aria-expanded', 'false'); tools.append(item);
  }
  ui.log.hidden = false;
  for (const id of ['single-explore', 'single-notebook', 'single-history']) addPanelClose(ui, id);
  ui.root.onkeydown = (event) => {
    if (composingInputs.has(ui.input) || event.isComposing || event.keyCode === 229 || event.key !== 'Escape' || !ui.root.dataset.openPanel) return;
    const id = ui.root.dataset.openPanel;
    openPlayPanel(ui);
    ui.root.querySelector<HTMLButtonElement>(`[data-panel="${id}"]`)?.focus({ preventScroll: true });
  };
  openPlayPanel(ui);
  const menu = ui.root.querySelector<HTMLDetailsElement>('.single-menu'); if (menu) menu.open = false;
  ui.onIntent = onIntent;
  renderGuidance(ui, state, onIntent);
  renderQuickActions(ui, state, onIntent);
  ui.send.onclick = () => { const value = ui.input.value.trim(); if (value) onIntent(value); };
  ui.input.onkeydown = (event) => {
    if (canSubmitInput(event, composingInputs.has(ui.input))) { event.preventDefault(); ui.send.click(); }
  };
}

function renderOnboarding(ui: Ui, initial: Partial<PlayProfile> & { story?: string }, submit: (data: StoryInput) => Promise<void> | void, legacyAvailable = false, localRecoveryAvailable = false): void {
  ui.performance?.settle();
  const legacyHint = legacyAvailable ? '<p class="single-notice">发现旧模式的本机记录。它不会被自动覆盖；如需查看，请用地址后面的 <code>?legacy=1</code> 打开旧模式，再导出后从右上角导入。</p>' : '';
  const recoveryHint = localRecoveryAvailable ? '<p class="single-notice">发现这台设备上的试玩进度，但当前浏览器会话是一个新世界。旧进度仍保留；可先从右上角导出，再导入到当前世界，或重新确认下面的故事。</p>' : '';
  const reading = ui.content.querySelector<HTMLElement>('#single-dialogue');
  if (reading) readingObservers.get(reading)?.();
  ui.root.classList.remove('is-playing');
  ui.root.append(ui.input.parentElement!);
  ui.content.innerHTML = `<section class="single-card"><h1>从一个故事开始</h1><p>先玩一段有结局的故事，学会行动、交谈和安排自己的一天。</p><article class="single-library"><small>完整短篇 · 三日 · 三种立场</small><h2>红灯下的第三次回声</h2><p>一张写着明天日期的通行证，把你带进三天的档案工作、地铁值班、警报录音和公开选择。每个人都有自己的时间表；错过当面机会后，世界会留下公开记录，但不会替你补造证词。</p><div id="tutorial-entry"></div></article><details id="custom-world"><summary>自己设计世界</summary><p>按这五项描述：开场地点、你的处境、关键角色、各自诉求、即将发生的事件。也可以套用示例后修改。</p><div id="story-example"></div>${legacyHint}${recoveryHint}<label for="doll-name" class="single-label">给娃娃取个名字</label><input id="doll-name" class="single-input" maxlength="12" value="${escapeHtml(initial.dollName || '')}" placeholder="比如：小墨"><label for="story" class="single-label">世界从哪里开始</label><textarea id="story" class="single-textarea" maxlength="600" placeholder="比如：我在办公室遇见了一个总在加班的人…">${escapeHtml(initial.story || '')}</textarea><label for="name-a" class="single-label">角色 A 的名字</label><input id="name-a" class="single-input" maxlength="12" value="${escapeHtml(initial.names?.A || '')}" placeholder="林川"><label for="name-b" class="single-label">角色 B 的名字</label><input id="name-b" class="single-input" maxlength="12" value="${escapeHtml(initial.names?.B || '')}" placeholder="沈青"><label for="name-c" class="single-label">角色 C 的名字</label><input id="name-c" class="single-input" maxlength="12" value="${escapeHtml(initial.names?.C || '')}" placeholder="周野"><div class="single-actions" id="onboarding-actions"></div></details><p class="single-error single-hidden" id="onboarding-error" role="alert"></p></section>`;
  ui.log.hidden = true; ui.root.querySelector<HTMLElement>('#single-history')!.hidden = true;
  ui.input.parentElement?.classList.add('single-hidden');
  ui.content.querySelector('#tutorial-entry')!.append(button('开始新手故事', async () => {
    await submit(clone(TUTORIAL_STORY));
  }, true));
  ui.content.querySelector('#story-example')!.append(button('套用示例', () => {
    (ui.content.querySelector('#doll-name') as HTMLInputElement).value = TUTORIAL_STORY.dollName;
    (ui.content.querySelector('#story') as HTMLTextAreaElement).value = TUTORIAL_STORY.story;
    for (const [id, name] of Object.entries(TUTORIAL_STORY.names)) (ui.content.querySelector(`#name-${id.toLowerCase()}`) as HTMLInputElement).value = name;
  }));
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
  ui.root.classList.remove('is-playing');
  ui.log.hidden = true; ui.root.querySelector<HTMLElement>('#single-history')!.hidden = true;
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
function renderIntentPreview(ui: Ui, draft: IntentDraftResponse, confirm: () => void, cancel: () => void): void {
  ui.input.blur();
  openPlayPanel(ui);
  ui.content.querySelector('#intent-preview')?.remove();
  const host = ui.content.querySelector<HTMLElement>('#single-dialogue');
  if (host) {
    host.dataset.preview = 'true';
    Array.from(host.children).forEach((node) => { (node as HTMLElement).hidden = true; });
  }
  const card = document.createElement('section'); card.id = 'intent-preview';
  card.innerHTML = '<h2>要这样行动吗？</h2><div class="single-preview"></div><div class="single-actions"></div>';
  card.querySelector('.single-preview')!.textContent = text(draft.preview?.text, draft.ack);
  card.querySelector('.single-actions')!.append(button('就这样做', confirm, true), button('先不做', cancel));
  (host || ui.content).append(card);
  card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  focusSurface(card);
}

function renderIntentErrorRecovery(ui: Ui, message: string): void {
  ui.input.blur();
  openPlayPanel(ui);
  ui.content.querySelector('#intent-error')?.remove();
  const notice = document.createElement('section');
  notice.id = 'intent-error';
  notice.className = 'single-error-panel';
  notice.setAttribute('role', 'alert');
  const copy = document.createElement('p');
  copy.className = 'single-error';
  copy.textContent = `${message} 这次没有执行。`;
  const actions = document.createElement('div');
  actions.className = 'single-actions single-error-actions';
  const guidance = ui.content.querySelector<HTMLElement>('#single-guidance');
  const focusRecommendation = (): void => {
    const target = guidance?.querySelector<HTMLButtonElement>('[data-story-action="true"]')
      || guidance?.querySelector<HTMLButtonElement>('[data-exploration-action="true"]')
      || guidance?.querySelector<HTMLButtonElement>('.single-story-actions button');
    guidance?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    target?.focus({ preventScroll: true });
  };
  actions.append(
    button('看推荐动作', () => {
      focusRecommendation();
    }, true),
    button('清空这句话', () => {
      ui.input.value = '';
      notice.remove();
      openPlayPanel(ui, 'single-explore');
      ui.input.focus();
    }),
  );
  notice.append(copy, actions);
  guidance?.append(notice);
  if (!notice.isConnected) ui.content.append(notice);
}

async function localStory(ui: Ui, state: LocalState, input: { dollName: string; story: string; names: Record<string, string> }): Promise<void> { state.profile = { dollName: input.dollName, story: input.story, names: input.names, modelEnabled: false }; state.snapshot = initialPlaySnapshot(); state.pending = undefined; state.offline = true; state.tutorial = undefined; state.dialogue = undefined; state.log = []; saveLocal(state); addLog(ui, state, '巫柜', '它先在本机搭好了一个小房间。'); renderSnapshot(ui, state); }
function localIntent(ui: Ui, state: LocalState, value: string): IntentDraftResponse {
  const action = parseLocalAction(value, ROOM_LABELS);
  if (!action) throw new PlayApiError(422, '离线时暂时无法执行这句话', 'unsupported_intent');
  const turnId = `local-${requestId()}`;
  const preview = { text: value, ...action };
  state.pending = { kind: 'intent', id: turnId, text: value, preview }; saveLocal(state);
  return { turnId, status: 'draft', ack: '这是离线探索，确认后只更新本机进度。', preview, worldVersion: state.snapshot.worldVersion };
}
function applyLocalIntent(ui: Ui, state: LocalState, textValue: string): void {
  const action = parseLocalAction(textValue, ROOM_LABELS);
  if (!action) throw new PlayApiError(422, '离线时暂时无法执行这句话', 'unsupported_intent');
  const before = state.snapshot;
  state.offline = true;
  const result = applyLocalAction(before, action); state.snapshot = result.snapshot;
  const turnId = state.pending?.id;
  addLog(ui, state, '你', textValue, 'accepted', logContext(before), 'action', turnId ? `turn:${turnId}` : undefined);
  const feedbackEventId = turnId ? `event:${turnId}:feedback` : undefined;
  addLog(ui, state, '环境', result.feedback, undefined, logContext(state.snapshot), 'feedback', feedbackEventId);
  state.dialogue = dialogueAfterAction(state.snapshot, [{ eventId: feedbackEventId || 'local', actor: 'ENV', payload: { text: result.feedback } }], state.dialogue, false);
  state.pending = undefined; saveLocal(state);
}

function renderIntentEvents(ui: Ui, state: LocalState, events: PlayEvent[], snapshot = state.snapshot, profile = state.profile): void {
  events.forEach((event) => {
    // The player's event is already represented by the accepted action entry.
    // Rendering it again from the commit response makes retries look like a
    // second action in the history.
    if (event.actor === 'YOU') return;
    const value = text(event.payload?.text) || (event.action === 'silence' ? '沉默了一会儿，没有回答。' : '');
    if (value) addLog(ui, state, displayName(text(event.actor, '巫柜'), profile), value, undefined, logContext(snapshot), 'feedback', event.eventId);
  });
}

async function run(): Promise<void> {
  const ui = buildUi(); const api = new PlayApiClient(); let stage: GalgameStage | null = null; const existingLocal = loadLocal(); const legacyAvailable = !existingLocal && (() => { try { return Boolean(localStorage.getItem(LEGACY_KEY)); } catch { return false; } })(); let state: LocalState = existingLocal || emptyLocalState(); let session: SessionResponse | null = null;
  const setState = (message: string) => { ui.state.textContent = message; };
  let serverProfileReady = false;
  let localRecoveryAvailable = false;
  let keepingLocalBranch = shouldKeepLocalBranch(existingLocal);
  let operationInFlight = false;
  const setToolsEnabled = (enabled: boolean): void => {
    ui.root.querySelectorAll<HTMLButtonElement>('#single-tools button').forEach((item) => { item.disabled = !enabled; });
  };
  function syncControls(): void {
    const pending = state.pending;
    const locked = operationInFlight;
    const reconnect = ui.root.querySelector<HTMLElement>('#single-reconnect');
    if (reconnect) reconnect.hidden = !state.offline;
    ui.input.disabled = locked || Boolean(pending);
    ui.send.disabled = locked || Boolean(pending);
    ui.root.querySelectorAll<HTMLButtonElement>('[data-quick-action]').forEach((item) => { item.disabled = locked || Boolean(pending); });
    setToolsEnabled(!locked && !pending);
    ui.content.querySelectorAll<HTMLButtonElement>('button').forEach((item) => { item.disabled = locked || Boolean(pending); });
    if (!locked && pending?.kind === 'intent') {
      ui.content.querySelectorAll<HTMLButtonElement>('#intent-preview button').forEach((item) => { item.disabled = false; });
    }
    if (!locked && pending?.kind === 'story') {
      ui.content.querySelectorAll<HTMLButtonElement>('#story-actions button').forEach((item) => { item.disabled = false; });
    }
    stage?.setInteractionEnabled(!locked && !pending && !state.offline);
  }
  const setOperationInFlight = (busy: boolean): void => {
    operationInFlight = busy;
    syncControls();
  };
  try {
    session = await api.getSession();
    serverProfileReady = Boolean(session.profile.dollName && (session.profile.story || session.profile.onboardingPhase === 'names-confirmed'));
    if (!keepingLocalBranch && state.snapshot.worldId && state.snapshot.worldId !== session.snapshot.worldId) {
      state.pending = undefined;
      state.tutorial = undefined;
      state.dialogue = undefined;
      state.log = [];
    }
    if (keepingLocalBranch) {
      state.offline = true;
      saveLocal(state);
    } else if (!serverProfileReady && hasCompletedLocalWorld(existingLocal)) {
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
      try {
        stage = createGalgameStage(GALGAME_ART, (id) => {
          if (!state.offline && state.snapshot.present.includes(id)) ui.onIntent?.(`问${displayName(id, state.profile)}：你现在方便聊聊吗？`);
        });
        ui.performance = stage;
      }
      catch { stage = null; setState(`${state.offline ? '本地试玩 · ' : ''}舞台暂时不可用，文字玩法仍可继续`); }
    }
    let busy = false;
    let intentOpen = false;
    const setPreviewButtons = (disabled: boolean): void => {
      ui.content.querySelectorAll<HTMLButtonElement>('#intent-preview button').forEach((item) => { item.disabled = disabled; });
    };
    const refreshStaleWorld = async (): Promise<void> => {
      const current = await api.getSession();
      applySnapshot(state, current.snapshot, current.profile);
      state.offline = false;
      state.pending = undefined;
      intentOpen = false;
      state.dialogue = { ...restoreDialogue(state.snapshot, state.dialogue), choicesOpen: true };
      saveLocal(state);
      renderSnapshot(ui, state);
      await renderStage(ui, state, stage);
    };
    const showIntentDraft = async (draft: IntentDraftResponse, value: string, local = false, direct = false): Promise<void> => {
      ui.content.querySelector('#intent-error')?.remove();
      busy = false;
      intentOpen = true;
      state.pending = { kind: 'intent', id: draft.turnId, text: value, preview: draft.preview };
      saveLocal(state);
      setOperationInFlight(false);
      const display = (): void => {
        saveLocal(state);
        renderIntentPreview(ui, draft, () => { void confirm(); }, () => { void cancel(); });
        syncControls();
      };
      const confirm = async (recovering = false): Promise<void> => {
        if (busy || operationInFlight) return;
        busy = true;
        setOperationInFlight(true);
        setPreviewButtons(true);
        setState(local ? '正在写入本机世界…' : '世界正在回应…');
        try {
          if (local) {
            applyLocalIntent(ui, state, value);
          } else {
            const before = state.snapshot;
            const known = state.offline ? null : { snapshot: state.snapshot, profile: state.profile };
            const committed = await api.confirmIntent(draft.turnId);
            const current = await api.getSession().catch(() => null);
            const latest = latestConfirmedView(committed, known, current);
            const advanced = latest.snapshot.worldVersion > committed.snapshot.worldVersion;
            state.offline = false;
            applySnapshot(state, latest.snapshot, latest.profile);
            state.pending = undefined;
            addLog(ui, state, '你', value, 'accepted', logContext(recovering || advanced ? committed.snapshot : before), 'action', `turn:${draft.turnId}`);
            // Visiting another room after the ending should play this action's
            // feedback, not perform the ending again. Keep room-aware reading
            // keys so other tabs cannot reuse dialogue from a different place.
            const continuingAfterEnd = before.worldId === state.snapshot.worldId && isAtStoryEnd(before.guidance) && isAtStoryEnd(state.snapshot.guidance);
            state.dialogue = advanced ? restoreDialogue(state.snapshot, state.dialogue)
              : dialogueAfterAction(state.snapshot, committed.events || [], state.dialogue, !continuingAfterEnd);
            renderIntentEvents(ui, state, committed.events || [], committed.snapshot, committed.profile);
            if (!advanced) stage?.perform(committed.events || []);
            saveLocal(state);
          }
          intentOpen = false;
          if (!direct && ui.input.value.trim() === value) ui.input.value = '';
          openPlayPanel(ui);
          ui.content.querySelector('#intent-preview')?.remove();
          renderSnapshot(ui, state);
          await renderStage(ui, state, stage);
          ui.content.querySelector('#single-dialogue')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } catch (error) {
          if (isStaleAction(error)) {
            try {
              await refreshStaleWorld();
              setState('世界已更新，请重新选择行动。');
              return;
            } catch { /* Keep the pending turn retryable if refresh fails. */ }
          }
          display();
          setState(isNetworkFailure(error) ? '确认结果还不知道，连接恢复后可原地重试' : errorMessage(error, '这一步没有通过检查'));
        } finally {
          busy = false;
          setOperationInFlight(false);
        }
      };
      const cancel = async (): Promise<void> => {
        if (busy || operationInFlight) return;
        busy = true;
        setOperationInFlight(true);
        setState('正在取消行动…');
        try {
          if (!local) await api.cancelIntent(draft.turnId);
          state.pending = undefined;
          saveLocal(state);
          ui.content.querySelector('#intent-preview')?.remove();
          intentOpen = false;
          renderSnapshot(ui, state);
          focusSurface(ui.content.querySelector<HTMLElement>('#single-dialogue'));
        } catch (error) {
          if (error instanceof PlayApiError && error.code === 'turn_already_committed') {
            // Confirmation is idempotent: this retrieves the existing receipt,
            // including its events, instead of pretending the action was cancelled.
            busy = false;
            setOperationInFlight(false);
            await confirm(true);
            if (!state.pending) setState('这一步已经执行，已恢复实际结果。');
            return;
          }
          if (isStaleAction(error)) {
            try {
              await refreshStaleWorld();
              setState('这份行动预览已失效，已恢复当前世界。');
              focusSurface(ui.content.querySelector<HTMLElement>('#single-dialogue'));
              return;
            } catch { /* An unavailable session cannot establish a safe replacement. */ }
          }
          display();
          setState(isNetworkFailure(error) ? '取消还未确认，预览已保留。连接恢复后请重试。' : errorMessage(error, '取消没有完成，预览已保留，请重试。'));
        } finally {
          busy = false;
          setOperationInFlight(false);
        }
      };
      if (direct) await confirm();
      else { display(); setState(`${local ? '本地试玩 · ' : ''}行动预览 · 等待确认`); }
    };
    const submitIntent = async (rawValue: string, direct = false): Promise<void> => {
      const value = rawValue.trim();
      if (!value || busy || intentOpen || operationInFlight || state.pending) return;
      busy = true;
      setOperationInFlight(true);
      setEntryEnabled(ui, false);
      setState('巫毒娃娃正在理解…');
      try {
        if (state.offline) {
          await showIntentDraft(localIntent(ui, state, value), value, true, direct);
          return;
        }
        const draft = await api.createIntent(value, requestId(), state.snapshot.worldVersion);
        await showIntentDraft(draft, value, false, direct);
      } catch (error) {
        if (isNetworkFailure(error)) {
          state.offline = true;
          if (parseLocalAction(value, ROOM_LABELS)) await showIntentDraft(localIntent(ui, state, value), value, true);
          else {
            state.dialogue = { ...restoreDialogue(state.snapshot, state.dialogue), choicesOpen: true };
            saveLocal(state);
            renderSnapshot(ui, state);
            openPlayPanel(ui, 'single-explore');
            setState('连接暂时不可用，已保留进度。离线可观察、移动、开门和等待。');
          }
        } else {
          if (isStaleAction(error)) {
            try { await refreshStaleWorld(); } catch { /* Keep the last readable snapshot. */ }
          }
          const message = errorMessage(error, '这句话还不能在当前房间执行');
          addRejectedLog(ui, state, value, message);
          setState(`未执行 · ${roomLabel(state.snapshot.roomId)} · ${clockText(state.snapshot.clock)}`);
          state.dialogue = { ...restoreDialogue(state.snapshot, state.dialogue), choicesOpen: true };
          renderDialogue(ui, state);
          renderIntentErrorRecovery(ui, message);
          setEntryEnabled(ui, true);
        }
      } finally {
        if (!intentOpen) {
          busy = false;
          setOperationInFlight(false);
        }
      }
    };
    setupPlayContent(ui, state, stage, (value, direct) => { void submitIntent(value, direct); });
    renderSnapshot(ui, state); updateLog(ui, state); await renderStage(ui, state, stage);
    const pending = state.pending;
    if (pending?.kind === 'intent' && pending.text) {
      ui.input.value = pending.text;
      await showIntentDraft({ turnId: pending.id, status: 'draft', ack: '这一步仍在等待你的确认。', preview: pending.preview || { text: pending.text }, worldVersion: state.snapshot.worldVersion }, pending.text, pending.id.startsWith('local-'));
    }
  };
  function showOnboarding(initial: Partial<PlayProfile> & { story?: string } = state.profile): void {
    renderOnboarding(ui, initial, async (input) => {
    if (operationInFlight) return;
    setOperationInFlight(true);
    setState('正在整理故事…');
    try {
      const draft = await api.createStoryDraft(input);
      showStoryDraft(draft);
    } catch (error) {
      if (isNetworkFailure(error) && !input.templateId) { showStoryDraft({ draftId: `local-story-${requestId()}`, worldVersion: state.snapshot.worldVersion, preview: { ...input, roomLabels: ['会客厅'] } }); }
      else if (isNetworkFailure(error)) {
        const target = ui.content.querySelector('#onboarding-error');
        if (target) { target.textContent = '暂时连不上世界。可以重试新手故事，或在“自己设计世界”里开始离线探索。'; target.classList.remove('single-hidden'); }
      }
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
    if (hasCompletedLocalWorld(state)) {
      const back = button('回到当前故事', () => {
        if (!operationInFlight && !state.pending) void showPlay();
      });
      back.id = 'single-return-story';
      ui.content.querySelector('.single-library')!.before(back);
    }
  }
  function showStoryDraft(draft: StoryDraftResponse): void {
    state.pending = { kind: 'story', id: draft.draftId, preview: draft.preview, worldVersion: draft.worldVersion };
    saveLocal(state);
    setState('故事预览 · 等待确认');
    const confirmStory = async (): Promise<void> => {
      if (operationInFlight) return;
      setOperationInFlight(true);
      try {
        if (hasCompletedLocalWorld(state)) {
          try {
            const key = `${STORAGE_KEY}-before-story`;
            const previous = localStorage.getItem(key);
            const existingBackup = previous ? JSON.parse(previous) : null;
            if (existingBackup?.draftId !== draft.draftId) {
              const backup = state.offline || draft.draftId.startsWith('local-story-') ? createLocalSaveEnvelope(state) : await api.exportSave();
              localStorage.setItem(key, JSON.stringify({ draftId: draft.draftId, save: backup }));
            }
          }
          catch { throw new PlayApiError(422, '无法备份当前进度', 'backup_unavailable'); }
        }
        if (draft.draftId.startsWith('local-story-')) {
          await localStory(ui, state, draft.preview);
          await showPlay(); return;
        }
        const known = state.offline ? null : { snapshot: state.snapshot, profile: state.profile };
        const saved = await api.confirmStoryDraft(draft.draftId, draft.worldVersion);
        const current = await api.getSession().catch(() => null);
        const latest = latestConfirmedView(saved, known, current);
        state.offline = false;
        serverProfileReady = true;
        localRecoveryAvailable = false;
        applySnapshot(state, latest.snapshot, latest.profile);
        state.log = []; state.tutorial = undefined; state.dialogue = undefined;
        state.pending = undefined;
        saveLocal(state);
        await showPlay();
      } catch (error) {
        setState(isNetworkFailure(error) ? '确认结果还不知道，连接恢复后可原地重试' : errorMessage(error, '这个世界没有通过确认'));
      } finally {
        setOperationInFlight(false);
        setToolsEnabled(!state.pending);
      }
    };
    const cancelStory = async (): Promise<void> => {
      if (operationInFlight) return;
      setOperationInFlight(true);
      try {
        if (!draft.draftId.startsWith('local-story-')) await api.cancelStoryDraft(draft.draftId);
        state.pending = undefined;
        saveLocal(state);
        setState('故事还没有写入世界');
        showOnboarding({ dollName: draft.preview.dollName, story: draft.preview.story, names: draft.preview.names });
      } catch (error) {
        if (error instanceof PlayApiError && error.code === 'story_already_committed') {
          setOperationInFlight(false);
          await confirmStory();
          if (!state.pending) setState('这个故事已经开始，已恢复实际进度。');
          return;
        }
        if (error instanceof PlayApiError && error.code === 'unknown_world_draft') {
          try {
            const current = await api.getSession();
            if (current.snapshot.worldId !== state.snapshot.worldId) {
              state.log = []; state.dialogue = undefined; state.tutorial = undefined;
            }
            state.profile = clone(current.profile);
            applySnapshot(state, current.snapshot);
            state.offline = false;
            state.pending = undefined;
            serverProfileReady = Boolean(current.profile.dollName && (current.profile.story || current.profile.onboardingPhase === 'names-confirmed'));
            saveLocal(state);
            if (serverProfileReady) await showPlay();
            else showOnboarding({ dollName: draft.preview.dollName, story: draft.preview.story, names: draft.preview.names });
            setState(serverProfileReady ? '这份故事预览已失效，已恢复当前故事。' : '这份故事预览已失效，请重新生成预览。');
            return;
          } catch { /* Preserve the preview until the current world can be read. */ }
        }
        setState(isNetworkFailure(error) ? '撤回还未确认，故事预览已保留。连接恢复后请重试。' : errorMessage(error, '撤回没有完成，故事预览已保留，请重试。'));
      } finally { setOperationInFlight(false); }
    };
    renderStoryPreview(ui, draft, confirmStory, cancelStory);
    if (hasCompletedLocalWorld(state)) {
      const note = document.createElement('p'); note.className = 'single-notice';
      note.textContent = '确认后将在当前世界开启新篇章，时间与章节将重新开始。原进度会保存在本机备份中，可从“旧进度”导出后恢复。';
      ui.content.querySelector('#story-actions')?.before(note);
    }
    syncControls();
  }
  ui.onLibrary = () => {
    if (operationInFlight || state.pending) return;
    openPlayPanel(ui);
    showOnboarding();
    focusSurface(ui.content.querySelector('.single-card h1'));
  };
  // A reachable session can still be a brand-new world.  The story form is
  // therefore selected from profile completeness, not network availability.
  const restoredStoryDraft = restorePendingStoryDraft(state);
  if (restoredStoryDraft) showStoryDraft(restoredStoryDraft);
  else if (session && !serverProfileReady && !keepingLocalBranch) { setState(localRecoveryAvailable ? '本机进度已保留 · 可导出后导入当前世界' : '等待你讲第一个故事'); showOnboarding(existingLocal?.profile || state.profile); }
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
        state.offline = false; serverProfileReady = true; applySnapshot(state, imported.snapshot, imported.profile); state.pending = undefined; state.dialogue = undefined; state.tutorial = undefined; state.log = []; saveLocal(state); await showPlay();
      } catch (error) {
        setState(errorMessage(error, '导入没有完成，本机记录仍在'));
      } finally {
        setOperationInFlight(false);
        setEntryEnabled(ui, !state.pending);
      }
    };
    file.click();
  }); importButton.title = '导入保存';
  const libraryButton = button('故事库', ui.onLibrary);
  const backupButton = button('旧进度', () => {
    try {
      const raw = localStorage.getItem(`${STORAGE_KEY}-before-story`);
      if (raw) { const backup = JSON.parse(raw); download('巫柜开启新篇章前的保存.json', backup.save || backup); }
      else setState('还没有新篇章备份，当前进度可用“导出”保存。');
    } catch { setState('备份暂时无法读取，当前世界不受影响。'); }
  });
  const reconnectButton = button('回到在线故事', async () => {
    if (operationInFlight || state.pending || !state.offline) return;
    setOperationInFlight(true);
    setState('正在连接在线故事，本机探索仍保留…');
    try {
      const current = await api.getSession();
      try { localStorage.setItem(PLAY_OFFLINE_BACKUP_KEY, JSON.stringify(state)); }
      catch { throw new PlayApiError(422, '离线备份不可用', 'offline_backup_unavailable'); }
      state = { profile: clone(current.profile), snapshot: clone(current.snapshot), log: [], offline: false };
      session = current;
      keepingLocalBranch = false;
      localRecoveryAvailable = false;
      serverProfileReady = Boolean(current.profile.dollName && (current.profile.story || current.profile.onboardingPhase === 'names-confirmed'));
      saveLocal(state);
      if (serverProfileReady) await showPlay();
      else showOnboarding();
      setState('已回到在线故事。本机探索可从菜单“离线备份”导出。');
    } catch (error) {
      setState(isNetworkFailure(error) ? '仍未连上在线故事，本机探索和进度都已保留。' : errorMessage(error, '暂时无法恢复在线故事，本机探索仍保留。'));
    } finally { setOperationInFlight(false); }
  });
  reconnectButton.id = 'single-reconnect';
  const offlineBackupButton = button('离线备份', () => {
    try {
      const raw = localStorage.getItem(PLAY_OFFLINE_BACKUP_KEY);
      const backup = raw ? normalizeLocalState(JSON.parse(raw)) : null;
      if (backup) download('巫柜离线探索备份.json', createLocalSaveEnvelope(backup));
      else setState('还没有离线备份，当前本机进度可用“导出”保存。');
    } catch { setState('离线备份暂时无法读取，当前进度不受影响。'); }
  });
  offlineBackupButton.id = 'single-offline-backup';
  const creditsButton = button('美术署名', () => {
    const modal = document.createElement('dialog'); modal.className = 'vn-credits';
    const title = document.createElement('h2'); title.textContent = '美术署名'; modal.append(title);
    for (const entry of ART_CREDITS) {
      const p = document.createElement('p'); const link = document.createElement('a');
      link.textContent = entry.author; link.href = entry.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      p.append(link, document.createTextNode(` · ${entry.work}\n${entry.license}`)); modal.append(p);
    }
    modal.append(button('回到游戏', () => modal.close()));
    modal.addEventListener('close', () => { modal.remove(); });
    ui.root.append(modal); modal.showModal();
  });
  ui.root.querySelector('#single-tools')!.append(libraryButton, exportButton, importButton, reconnectButton, backupButton, offlineBackupButton, creditsButton);
  ui.root.querySelector('#single-tools')!.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('button')) ui.root.querySelector<HTMLDetailsElement>('.single-menu')!.open = false;
  });
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
