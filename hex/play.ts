// These modules are the existing Pixi renderer.  Their public surface is
// deliberately small, but they are plain JavaScript, so keep the boundary
// untyped instead of making the new client depend on generated declarations.
// @ts-ignore -- legacy renderer module
import { createStage } from './stage.js';
// @ts-ignore -- legacy renderer module
import { ROOMS, assignSpots } from './rooms.js';
import { PlayApiClient, PlayApiError, type IntentDraftResponse, type PlayEvent, type PlayProfile, type PlaySnapshot, type SessionResponse, type StoryDraftResponse, type StoryInput } from './play-api';
import { appendLocalLogEntry, createLocalSaveEnvelope, emptyLocalState, hasCompletedLocalWorld, initialPlaySnapshot, normalizeLocalState, PLAY_STORAGE_KEY, restorePendingStoryDraft, type LocalLogEntry, type LocalLogKind, type LocalState } from './play-state';

import { parseLocalAction, applyLocalAction } from './play-local';
import { advanceDialogue, dialogueAfterAction, restoreDialogue } from './play-dialogue';
import { splitGuidanceActions, type GuidanceAction } from './play-guidance';

const STORAGE_KEY = PLAY_STORAGE_KEY;
const LEGACY_KEY = 'voodoo-hex-v5';
const ROOM_TO_STAGE: Record<string, string> = { office: 'office', kitchen: 'kitchen', street: 'street', bar: 'bar', parlor: 'bedroom', home: 'bedroom', bedroom: 'bedroom', hall: 'corridor', station: 'corridor', garden: 'street', attic: 'office' };
const ROOM_LABELS: Record<string, string> = { parlor: '会客厅', bedroom: '卧室', hall: '走廊', station: '地铁站', office: '办公室', home: '家里', kitchen: '厨房', street: '街上', garden: '花园', attic: '阁楼', bar: '酒吧' };
const TUTORIAL_STORY: StoryInput = { templateId: 'signal-rain-v1', dollName: '小墨', names: { A: '林川', B: '沈青', C: '周野' }, story: '红灯下的第三次回声。三天里，你要完成档案馆的工作，追查地铁站第三次警报与 06-17 交班记录，听见沈青保存的录音，再决定和林川共同署名、公开审计，还是先保护仍在照护父亲的他。' };
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
  root.innerHTML = `<header class="single-top"><div class="single-brand">✶ 巫柜</div><div id="single-state" class="single-state">正在打开房间…</div><div id="single-tools" class="single-tools"></div></header><section id="single-content"></section><details id="single-history" class="single-history"><summary>行动记录</summary><section id="single-log" class="single-log"></section></details><div class="single-compose single-hidden" id="single-compose"><input id="single-input" class="single-input" maxlength="240" aria-label="自由行动或对话" placeholder="也可以自己说：去地铁站、开门…" autocomplete="off"><button id="single-send" class="single-button primary" type="button">预览</button></div>`;
  return { root, state: root.querySelector('#single-state')!, content: root.querySelector('#single-content')!, log: root.querySelector('#single-log')!, stage: root, input: root.querySelector('#single-input')!, send: root.querySelector('#single-send')! };
}

function button(label: string, onClick: () => void, primary = false): HTMLButtonElement { const el = document.createElement('button'); el.className = `single-button${primary ? ' primary' : ''}`; el.textContent = label; el.type = 'button'; el.addEventListener('click', onClick); return el; }
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
  const chips = ids.map((id) => `<span class="single-pill">${escapeHtml(displayName(id, state.profile))}</span>`).join('');
  const relationEntries = Object.entries(snapshot.relationships || {}).slice(0, 6).map(([key, rel]) => `${key.split(':').map((id) => displayName(id, state.profile)).join(' · ')}：${text(rel.summary, text(rel.label, '关系在变化'))}`).join('　');
  // `renderSnapshot` can run before or after the Pixi stage is created.  Keep
  // the existing host so a re-render never detaches the canvas from Pixi.
  if (!ui.content.querySelector('#single-stage-host')) {
    const stageHost = document.createElement('div'); stageHost.className = 'single-stage'; stageHost.id = 'single-stage-host'; ui.content.prepend(stageHost);
  }
  const meta = ui.content.querySelector('#single-meta'); if (meta) meta.innerHTML = `<span class="single-pill">地点：${escapeHtml(roomLabel(snapshot.roomId))}</span><span class="single-pill">在场：${ids.map((id) => escapeHtml(displayName(id, state.profile))).join('、')}</span>${snapshot.clock ? `<span class="single-pill">${escapeHtml(clockText(snapshot.clock))}</span>` : ''}`;
  const relations = ui.content.querySelector('#single-relations'); if (relations) relations.textContent = relationEntries || '关系会在你们相处后慢慢改变。';
  if (ui.onIntent && ui.content.querySelector('#single-quick-actions')) { renderGuidance(ui, state, ui.onIntent); renderQuickActions(ui, state, ui.onIntent); }
}
function clockText(clock: PlaySnapshot['clock']): string { if (!clock) return '时间未知'; const minute = Math.max(0, Math.min(1439, Number(clock.minute) || 0)); return `第 ${Number(clock.day) || 1} 天 ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`; }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)); }
function isNetworkFailure(error: unknown): boolean { return error instanceof PlayApiError && error.status === 0; }
function errorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof PlayApiError)) return fallback;
  const messages: Record<string, string> = {
    unsupported_intent: '这句话暂时无法执行。可以点推荐动作、地图，或向在场的人提问。',
    backup_unavailable: '原进度暂时无法备份，本次没有开启新篇章。请检查本机存储后重试。',
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

function renderDialogue(ui: Ui, state: LocalState): void {
  const host = ui.content.querySelector<HTMLElement>('#single-dialogue');
  if (!host) return;
  state.dialogue = restoreDialogue(state.snapshot, state.dialogue);
  const playback = state.dialogue;
  const line = playback.lines[playback.index];
  host.dataset.kind = line.kind;
  host.innerHTML = `<div class="dialogue-nameplate"><span class="dialogue-speaker"></span><small class="dialogue-kind"></small></div><button type="button" class="dialogue-page" aria-label="继续阅读"><span class="dialogue-text" aria-live="polite"></span><span class="dialogue-next" aria-hidden="true">▾</span></button><div class="dialogue-footer"><span class="dialogue-position"></span><div class="dialogue-controls"></div></div><details class="dialogue-backlog"><summary>回看本段</summary><div></div></details>`;
  host.querySelector('.dialogue-speaker')!.textContent = line.kind === 'narration' ? '旁白' : displayName(line.speakerId, state.profile);
  host.querySelector('.dialogue-kind')!.textContent = line.kind === 'thought' ? '心声' : line.kind === 'speech' ? '对白' : '此刻';
  host.querySelector('.dialogue-text')!.textContent = line.kind === 'speech' ? `「${line.text}」` : line.kind === 'thought' ? `（${line.text}）` : line.text;
  host.querySelector('.dialogue-position')!.textContent = `${playback.index + 1} / ${playback.lines.length} · ${playback.choicesOpen ? '现在可以行动' : '点击对话窗继续'}`;
  const redraw = (focus = false): void => {
    saveLocal(state);
    renderDialogue(ui, state);
    const hint = ui.content.querySelector('#single-guidance > .single-action-hint');
    if (hint && state.dialogue?.choicesOpen) hint.textContent = '选择一个推荐动作继续故事；观察和等待属于自由探索。';
    if (focus) ui.content.querySelector<HTMLButtonElement>('.dialogue-page')?.focus({ preventScroll: true });
  };
  const next = (): void => {
    state.dialogue = advanceDialogue(playback);
    redraw(true);
    if (state.dialogue.choicesOpen) ui.content.querySelector('.single-story-actions')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  host.querySelector<HTMLButtonElement>('.dialogue-page')!.onclick = next;
  const controls = host.querySelector('.dialogue-controls')!;
  if (playback.index > 0) controls.append(button('上一句', () => { state.dialogue = { ...playback, index: playback.index - 1 }; redraw(); }));
  if (!playback.choicesOpen) controls.append(button('先行动', () => { state.dialogue = { ...playback, choicesOpen: true }; redraw(); ui.content.querySelector('.single-story-actions')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }));
  controls.append(button(playback.index < playback.lines.length - 1 ? '下一句 ▸' : '选择行动 ▸', next, true));
  const backlog = host.querySelector('.dialogue-backlog div')!;
  playback.lines.slice(0, playback.index + 1).forEach((item) => {
    const p = document.createElement('p');
    const label = item.kind === 'narration' ? '旁白' : `${displayName(item.speakerId, state.profile)}${item.kind === 'thought' ? ' · 心声' : ''}`;
    const name = document.createElement('strong'); name.textContent = label;
    p.append(name, document.createTextNode(item.text)); backlog.append(p);
  });
  // Persist only reading position; no request and no authoritative state change.
  saveLocal(state);
}

function renderGuidance(ui: Ui, state: LocalState, onIntent: (value: string) => void): void {
  const host = ui.content.querySelector<HTMLElement>('#single-guidance');
  if (!host) return;
  const guide = state.snapshot.guidance;
  host.replaceChildren();
  const chapter = document.createElement('small'); chapter.className = 'single-chapter';
  chapter.textContent = guide ? `${guide.title} · ${guide.chapter}` : '自由世界 · 从这里出发';
  const heading = document.createElement('h2'); heading.textContent = guide?.objective || '选择一个行动，看看世界怎样回应';
  host.append(chapter, heading);
  renderDialogue(ui, state);
  for (const value of [guide?.playerRoutine, guide?.scheduleHint]) {
    if (!value) continue;
    const line = document.createElement('p'); line.className = 'single-notice'; line.textContent = value; host.append(line);
  }
  if (state.offline) {
    const notice = document.createElement('p'); notice.className = 'single-notice';
    notice.textContent = '离线探索：本机行动会保留。章节暂时停在上次进度，重新连接后可继续故事。'; host.append(notice);
  }
  const { story, exploration } = splitGuidanceActions(guide?.actions as GuidanceAction[] | undefined);
  const actionHeading = document.createElement('h3'); actionHeading.className = 'single-action-heading'; actionHeading.textContent = story.length ? '剧情推进' : '当前可以做什么';
  const actionHint = document.createElement('p'); actionHint.className = 'single-action-hint';
  actionHint.textContent = story.length
    ? (state.dialogue?.choicesOpen ? '选择一个推荐动作继续故事；观察和等待属于自由探索。' : '对话仍在播放；你也可以直接选择剧情动作。')
    : '选择一个现场动作，或用下面的输入框说出你想做什么。';
  const actions = document.createElement('div'); actions.className = 'single-story-actions';
  if (!state.offline) {
    story.slice(0, 4).forEach((action) => {
      const item = quickButton(action.label, action.intent, onIntent); item.classList.add('primary');
      item.dataset.storyAction = 'true';
      const detail = document.createElement('small');
      detail.textContent = [typeof action.minutes === 'number' ? `约 ${action.minutes} 分钟` : '', action.reason || ''].filter(Boolean).join(' · ');
      if (detail.textContent) item.append(detail);
      actions.append(item);
    });
  }
  host.append(actionHeading, actionHint, actions);
  if (!state.offline && exploration.length) {
    const details = document.createElement('details');
    details.className = 'single-exploration-actions';
    details.open = story.length === 0;
    const summary = document.createElement('summary');
    summary.textContent = `自由探索 · ${exploration.length} 个动作`;
    details.append(summary);
    const explorationActions = document.createElement('div');
    explorationActions.className = 'single-story-actions';
    exploration.slice(0, 8).forEach((action) => {
      const item = quickButton(action.label, action.intent, onIntent);
      item.dataset.explorationAction = 'true';
      const detail = document.createElement('small');
      detail.textContent = [typeof action.minutes === 'number' ? `约 ${action.minutes} 分钟` : '', action.reason || ''].filter(Boolean).join(' · ');
      if (detail.textContent) item.append(detail);
      explorationActions.append(item);
    });
    details.append(explorationActions);
    host.append(details);
  }
  const primaryIntent = story[0]?.intent || exploration[0]?.intent;
  ui.input.placeholder = primaryIntent ? `也可以输入：${primaryIntent}` : '自由行动，例如：观察周围';
  if (guide?.journal?.length) {
    const journal = document.createElement('details'); journal.className = 'single-journal';
    const summary = document.createElement('summary'); summary.textContent = `调查笔记 · ${guide.journal.length} 条已核验记录`;
    journal.append(summary);
    guide.journal.forEach((entry) => {
      const item = document.createElement('p');
      const title = document.createElement('strong'); title.textContent = `${entry.title}：`;
      item.append(title, document.createTextNode(entry.text)); journal.append(item);
    });
    host.append(journal);
  }
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
  // Immediate scene actions stay available while the Galgame text is being
  // read.  Story choices may wait for the next line, but the player must
  // always have a visible way to observe, wait, talk, or inspect the room.
  immediate.append(quickButton('开门看看', '开门', onIntent));
  host.append(immediate);
  const details = document.createElement('details');
  const summary = document.createElement('summary'); summary.textContent = '地图 · 去别处'; details.append(summary);
  const travel = document.createElement('div'); travel.className = 'single-action-row';
  TRAVEL_ROOMS.filter((room) => room !== state.snapshot.roomId).forEach((room) => {
    travel.append(quickButton(roomLabel(room), `去${roomLabel(room)}`, onIntent));
  });
  details.append(travel); host.append(details);
}

function setupPlayContent(ui: Ui, state: LocalState, stage: any, onIntent: (text: string) => void): void {
  ui.content.innerHTML = `<section class="single-play-scene"><div id="single-meta" class="single-meta"></div><div class="single-theater"><div id="single-stage-host" class="single-stage"></div><section id="single-dialogue" class="single-dialogue" aria-label="故事对话窗"></section></div><section class="single-card single-play-plan"><section id="single-guidance" class="single-guidance" aria-label="剧情与今日安排"></section><section class="single-choices" aria-label="现场行动"><h2>现场行动</h2><p class="single-action-hint">观察、等待，或和当前在场的人交谈。</p><div id="single-quick-actions"></div></section><div id="single-relations" class="single-relations">关系会在你们相处后慢慢改变。</div></section></section>`;
  const canvas = stage?.app?.canvas as HTMLCanvasElement | undefined;
  const stageHost = ui.content.querySelector('#single-stage-host')!;
  if (canvas) stageHost.appendChild(canvas);
  else stageHost.textContent = '舞台暂时打不开，文字玩法仍可继续。';
  ui.log.hidden = false; ui.root.querySelector<HTMLElement>('#single-history')!.hidden = false;
  ui.onIntent = onIntent;
  renderGuidance(ui, state, onIntent);
  renderQuickActions(ui, state, onIntent);
  ui.input.parentElement?.classList.remove('single-hidden');
  ui.send.onclick = () => { const value = ui.input.value.trim(); if (value) onIntent(value); };
  ui.input.onkeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); ui.send.click(); } };
}
function renderOnboarding(ui: Ui, initial: Partial<PlayProfile> & { story?: string }, submit: (data: StoryInput) => Promise<void> | void, legacyAvailable = false, localRecoveryAvailable = false): void {
  const legacyHint = legacyAvailable ? '<p class="single-notice">发现旧模式的本机记录。它不会被自动覆盖；如需查看，请用地址后面的 <code>?legacy=1</code> 打开旧模式，再导出后从右上角导入。</p>' : '';
  const recoveryHint = localRecoveryAvailable ? '<p class="single-notice">发现这台设备上的试玩进度，但当前浏览器会话是一个新世界。旧进度仍保留；可先从右上角导出，再导入到当前世界，或重新确认下面的故事。</p>' : '';
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
function renderIntentPreview(ui: Ui, draft: IntentDraftResponse, confirm: () => void, cancel: () => void): void { ui.content.querySelector('#intent-preview')?.remove(); const card = document.createElement('div'); card.id = 'intent-preview'; card.className = 'single-card'; card.innerHTML = '<h2>巫毒娃娃准备这样做</h2><div class="single-preview"></div><div class="single-actions"></div>'; card.querySelector('.single-preview')!.textContent = `${draft.ack}\n${text(draft.preview?.text, '它会把这句话带进当前房间。')}`; const actions = card.querySelector('.single-actions')!; actions.append(button('就这样做', confirm, true), button('先不做', cancel)); ui.content.querySelector('#single-guidance')?.after(card); if (!card.isConnected) ui.content.prepend(card); card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }

function renderIntentErrorRecovery(ui: Ui, message: string): void {
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
    const details = guidance?.querySelector<HTMLDetailsElement>('.single-exploration-actions');
    const target = guidance?.querySelector<HTMLButtonElement>('[data-story-action="true"]')
      || guidance?.querySelector<HTMLButtonElement>('[data-exploration-action="true"]')
      || guidance?.querySelector<HTMLButtonElement>('.single-story-actions button');
    if (details && target?.dataset.explorationAction) details.open = true;
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
  const result = applyLocalAction(before, action); state.snapshot = result.snapshot;
  const turnId = state.pending?.id;
  addLog(ui, state, '你', textValue, 'accepted', logContext(before), 'action', turnId ? `turn:${turnId}` : undefined);
  const feedbackEventId = turnId ? `event:${turnId}:feedback` : undefined;
  addLog(ui, state, '环境', result.feedback, undefined, logContext(state.snapshot), 'feedback', feedbackEventId);
  state.dialogue = dialogueAfterAction(state.snapshot, [{ eventId: feedbackEventId || 'local', actor: 'ENV', payload: { text: result.feedback } }], state.dialogue, false);
  state.pending = undefined; saveLocal(state);
}

function renderIntentEvents(ui: Ui, state: LocalState, events: PlayEvent[]): void {
  events.forEach((event) => {
    // The player's event is already represented by the accepted action entry.
    // Rendering it again from the commit response makes retries look like a
    // second action in the history.
    if (event.actor === 'YOU') return;
    const value = text(event.payload?.text) || (event.action === 'silence' ? '沉默了一会儿，没有回答。' : '');
    if (value) addLog(ui, state, displayName(text(event.actor, '巫柜'), state.profile), value, undefined, logContext(state.snapshot), 'feedback', event.eventId);
  });
}

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
    ui.content.querySelectorAll<HTMLButtonElement>('button').forEach((item) => { item.disabled = locked || Boolean(pending); });
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
    if (state.snapshot.worldId && state.snapshot.worldId !== session.snapshot.worldId) {
      state.pending = undefined;
      state.tutorial = undefined;
      state.dialogue = undefined;
      state.log = [];
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
      ui.input.value = '';
      ui.content.querySelector('#intent-error')?.remove();
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
            const before = state.snapshot;
            const committed = await api.confirmIntent(draft.turnId);
            state.offline = false;
            applySnapshot(state, committed.snapshot, committed.profile);
            state.pending = undefined;
            addLog(ui, state, '你', value, 'accepted', logContext(before), 'action', `turn:${draft.turnId}`);
            state.dialogue = dialogueAfterAction(state.snapshot, committed.events || [], state.dialogue);
            renderIntentEvents(ui, state, committed.events || []);
            saveLocal(state);
          }
          intentOpen = false;
          ui.content.querySelector('#intent-preview')?.remove();
          renderSnapshot(ui, state);
          await renderStage(ui, state, stage);
          ui.content.querySelector('#single-dialogue')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
          if (parseLocalAction(value, ROOM_LABELS)) showIntentDraft(localIntent(ui, state, value), value, true);
          else setState('连接暂时不可用，已保留进度。离线可观察、移动、开门和等待。');
        } else {
          const message = errorMessage(error, '这句话还不能在当前房间执行');
          addRejectedLog(ui, state, value, message);
          setState(`未执行 · ${roomLabel(state.snapshot.roomId)} · ${clockText(state.snapshot.clock)}`);
          renderIntentErrorRecovery(ui, `${message}失败的原话和原因已记录在“行动记录”中。`);
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
    if (pending?.kind === 'intent' && pending.text) {
      showIntentDraft({ turnId: pending.id, status: 'draft', ack: '这一步仍在等待你的确认。', preview: pending.preview || { text: pending.text }, worldVersion: state.snapshot.worldVersion }, pending.text, pending.id.startsWith('local-'));
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
  }
  function showStoryDraft(draft: StoryDraftResponse): void {
    state.pending = { kind: 'story', id: draft.draftId, preview: draft.preview, worldVersion: draft.worldVersion };
    saveLocal(state);
    setState('故事预览 · 等待确认');
    renderStoryPreview(ui, draft, async () => {
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
        const saved = await api.confirmStoryDraft(draft.draftId, draft.worldVersion);
        state.offline = false;
        serverProfileReady = true;
        localRecoveryAvailable = false;
        applySnapshot(state, saved.snapshot, saved.profile);
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
    if (hasCompletedLocalWorld(state)) {
      const note = document.createElement('p'); note.className = 'single-notice';
      note.textContent = '确认后将在当前世界开启新篇章，时间与章节将重新开始。原进度会保存在本机备份中，可从“旧进度”导出后恢复。';
      ui.content.querySelector('#story-actions')?.before(note);
    }
    syncControls();
  }
  // A reachable session can still be a brand-new world.  The story form is
  // therefore selected from profile completeness, not network availability.
  const restoredStoryDraft = restorePendingStoryDraft(state);
  if (restoredStoryDraft) showStoryDraft(restoredStoryDraft);
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
  const libraryButton = button('故事库', () => {
    if (operationInFlight || state.pending) return;
    showOnboarding();
    if (hasCompletedLocalWorld(state)) ui.content.querySelector('#tutorial-entry')!.append(button('回到当前故事', () => { void showPlay(); }));
  });
  const backupButton = button('旧进度', () => {
    try {
      const raw = localStorage.getItem(`${STORAGE_KEY}-before-story`);
      if (raw) { const backup = JSON.parse(raw); download('巫柜开启新篇章前的保存.json', backup.save || backup); }
      else setState('还没有新篇章备份，当前进度可用“导出”保存。');
    } catch { setState('备份暂时无法读取，当前世界不受影响。'); }
  });
  ui.root.querySelector('#single-tools')!.append(libraryButton, exportButton, importButton, backupButton);
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
