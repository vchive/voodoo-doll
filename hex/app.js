// 002 · 巫柜夜场 — 主流程
//
// 核心规则：玩家只能说话。角色移动、房间变化、对物件的动作、环境的反馈，
// 全部由服务端的各个 agent 给出，前端只负责把 beats 演出来。
// 界面上没有任何拖拽与点选角色的入口。
//
// 六个 agent 位（见 docs/decisions/0003-environment-agent.md）：
//   doll（含玩家身体 YOU）、ENV、A、B、C、Z。A/B/C 可以改名——用说话改。

import { createStage } from './stage.js';
import { ROOMS, assignSpots } from './rooms.js';
import { writeScript, closingLine, initializeSession, refreshSession, saveProfile, cancelScript, confirmScript, setOfflineOnly, isSessionOnline, newRequestId, extractStoryNames } from './doll.js';
import { STORAGE_KEY, loadState, mergeSnapshot, markOffline, preserveLocalBackup, hasLocalProgress, settleOffline } from './storage.js';
import { CAST, CAST_IDS, STAGE_IDS, RENAMEABLE_IDS, normalizeStage } from '../shared/cast.js';
import { isDangerous as isDangerousName } from '../shared/script-contract.js';
import { findObject } from '../shared/environment.js';
import { createWorldApiClient, WorldEventReducer } from './world-api.ts';

const $ = (id) => document.getElementById(id);

let localStore;
try { localStore = window.localStorage; } catch { localStore = {getItem:()=>null,setItem:()=>{throw new Error('storage-unavailable');}}; }
let state = loadState(localStore);
let storageOk = true;
let stage = null;
let busy = false;
let interactionEpoch = 0;
let interaction = null;
let synchronizing = false;
let booted = false;
const kernelMode = new URLSearchParams(window.location.search).get('kernel') === '1' ? createWorldApiClient('/api/v4') : null;
let kernelSnapshot = null;
let kernelReducer = null;
let kernelStream = null;

// The Python kernel uses stable world rooms while the pixel stage keeps its
// original room names. This translation is presentation-only; the server
// remains authoritative for the actual room id.
const KERNEL_ROOM_TO_STAGE = {
  parlor: 'bedroom',
  bedroom: 'bedroom',
  hall: 'corridor',
  garden: 'street',
  attic: 'office',
};

function syncKernelProjection() {
  if (!kernelSnapshot) return;
  const roomId = KERNEL_ROOM_TO_STAGE[kernelSnapshot.roomId] || 'bedroom';
  state.stage.roomId = roomId;
  state.stage.present = kernelSnapshot.present.filter((id) => STAGE_IDS.includes(id));
  if (!state.stage.present.includes('YOU')) state.stage.present.unshift('YOU');
  stage?.setModel(currentModel());
  refreshHeader();
}

function renderKernelEvent(event) {
  const value = String(event.payload?.text || '');
  if (event.actor === 'ENV') {
    envLine(value || '房间有了动静。');
    const objectId = event.payload?.object || event.payload?.objectId;
    if (typeof objectId === 'string') stage?.envReact(objectId, event.payload?.verb === 'ring' ? 'ring' : 'flicker');
  } else if (event.actor !== 'YOU' && value) {
    sceneLine(event.actor, value);
    stage?.say(event.actor, value, nameOf(event.actor));
    stage?.focus(event.actor);
  }
}

function applyKernelEvent(event) {
  if (!kernelReducer || !kernelReducer.applyEvent(event)) return false;
  kernelSnapshot = kernelReducer.snapshot;
  syncKernelProjection();
  renderKernelEvent(event);
  return true;
}

function startKernelEventStream() {
  if (!kernelMode || !kernelSnapshot || kernelStream) return;
  kernelStream = kernelMode.subscribeEvents({
    viewer: 'YOU',
    afterVersion: kernelSnapshot.worldVersion,
    onEvent: applyKernelEvent,
    // The subscription performs its own backfill. Avoid adding transient
    // network errors to the story log while the phone changes networks.
    onError: () => {},
  });
}

function stopKernelEventStream() {
  kernelStream?.close();
  kernelStream = null;
}

async function synchronizeKernel() {
  if (!kernelMode) return false;
  stopKernelEventStream();
  kernelSnapshot = await kernelMode.getWorld('YOU');
  kernelReducer = new WorldEventReducer(kernelSnapshot);
  state.dollName = state.dollName || '巫柜';
  state.onboardingPhase = 'names-confirmed';
  syncKernelProjection();
  save();
  return true;
}

async function submitKernelTurn(text) {
  if (!kernelMode || !kernelSnapshot) return;
  const targets = state.stage.present.filter((id) => id !== 'YOU' && ['A', 'B', 'C', 'Z'].includes(id)).slice(0, 4);
  if (!targets.length) throw new Error('no-person-target');
  const result = await kernelMode.submitAsk(text, targets, kernelSnapshot.worldVersion);
  if (!kernelReducer) kernelReducer = new WorldEventReducer(kernelSnapshot);
  const events = kernelReducer.applyTurn(result);
  kernelSnapshot = kernelReducer.snapshot || result.snapshot;
  syncKernelProjection();
  events.forEach(renderKernelEvent);
  dollLine('这一回合已经写进世界。');
}

function acceptSnapshot(snapshot) {
  if (!snapshot) return;
  state = mergeSnapshot(state, snapshot);
  save();
  refreshHeader();
}
function localChanged() { state = markOffline(state); setOfflineOnly(true); save(); }
function choice(message, options) {
  sysLine(message);
  return new Promise(resolve => renderOptions(options.map(([label,value]) => ({label,onPick:()=>{clearOptions();resolve(value);}}))));
}
async function synchronize({ initial = false } = {}) {
  if (synchronizing || interaction || busy) return false;
  synchronizing = true;
  busy = true;
  setInputEnabled(false);
  let success = false;
  try {
    if (state.sync?.offlineDirty) {
      let remote;
      try { remote = await refreshSession(); }
      catch (error) {
        if(error.status!==401)throw error;
        remote = await initializeSession(state);
        acceptSnapshot(remote);
        success = true;
      }
      if (!success) {
        setOfflineOnly(true);
        const pick = await choice('本机有尚未同步的进度。两份记录都会保留，请选择这次继续哪一份。', [
          ['继续本机进度','local'], ['读取服务器备份','server'], ['稍后再同步','later'],
        ]);
        if (pick==='later') return false;
        // 必须先真正保存备份；失败时不把现存本机档覆盖成另一份。
        preserveLocalBackup(localStore,state);
        if (pick==='local') acceptSnapshot(await initializeSession(state,{forkLocal:true}));
        else {acceptSnapshot(remote);setOfflineOnly(false);}
        success = true;
      }
    } else {
      let importLocal = false;
      if (initial && !state.sync && hasLocalProgress(state)) {
        const pick = await choice('发现本机的巫柜存档。可以导入夜场，原存档会保留；头像仍只在这台设备。', [
          ['导入本机进度','import'], ['先在本机玩','local'],
        ]);
        if(pick==='local'){localChanged();return false;}
        preserveLocalBackup(localStore,state);
        importLocal = true;
      }
      const localBefore = state;
      let remote = await initializeSession(state,{forkLocal:importLocal});
      if (localBefore.sync && remote.worldId!==localBefore.sync.worldId && hasLocalProgress(localBefore)) {
        setOfflineOnly(true);
        const pick=await choice('当前连接的是另一份夜场记录。请选择继续哪一份，现有本机记录会先备份。',[
          ['继续本机进度','local'],['读取服务器备份','server'],['稍后再同步','later'],
        ]);
        if(pick==='later'){localChanged();return false;}
        preserveLocalBackup(localStore,localBefore);
        if(pick==='local')remote=await initializeSession(localBefore,{forkLocal:true});
      }
      acceptSnapshot(remote);
      success = true;
    }
    stage?.setModel(currentModel());
    if (!initial) sysLine('已连接到保存进度的夜场。');
    return true;
  } catch {
    setOfflineOnly(true);
    sysLine('暂时连不上夜场。这台设备仍能用内置剧本演出，进度先留在本机。');
    return false;
  } finally {
    synchronizing = false;
    busy = false;
    if(success)setOfflineOnly(false);
    setInputEnabled(state.onboardingPhase==='names-confirmed');
  }
}
async function persistProfile() {
  if (!isSessionOnline()) {localChanged();return true;}
  try {
    const snapshot = await saveProfile(state);
    if(snapshot)acceptSnapshot(snapshot);
    else localChanged();
    return true;
  } catch(error) {
    // 本机修改仍保留，不能因服务端版本冲突偷偷覆盖任一方。
    localChanged();
    sysLine(error.status===409 ? '另一处也改了舞台。本次修改先留在本机，重连时再选择进度。' : '这次修改先存到本机，联网后可以继续同步。');
    return true;
  }
}
async function cancelCurrent({quiet=false}={}) {
  const current = interaction;
  if (!current || ['confirming','confirm-uncertain','playing'].includes(current.phase))return false;
  interaction = null;
  const epoch = ++interactionEpoch;
  current.controller?.abort();
  clearOptions();
  busy = true;
  setInputEnabled(false);
  const snapshot = await cancelScript({turnId:current.script?.turnId,requestId:current.requestId});
  if(epoch!==interactionEpoch)return false;
  if(snapshot && !state.sync?.offlineDirty)acceptSnapshot(snapshot);
  busy = false;
  if(!quiet)sysLine('这一幕已收起，没有演出或增加夜数。');
  setInputEnabled(true);
  return true;
}

function save() {
  try {
    localStore.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    if (storageOk) {
      storageOk = false;
      sysLine('本地空间不可用，这次对话不会被记住。');
    }
    return false;
  }
}

// ---------- 名字 ----------

function nameOf(id) {
  if (id === 'doll') return state.dollName || '娃娃';
  if (id === 'ENV') return '·';
  if (id === 'YOU') return '你';
  if (id === 'Z') return '路人';
  if (state.names[id]) return state.names[id];
  return (CAST[id] && CAST[id].defaultName) || id;
}

// ---------- 呈现 ----------

function line(kind, who, text) {
  const wrap = $('log');
  const row = document.createElement('div');
  row.className = `msg msg-${kind}`;
  const whoEl = document.createElement('span');
  whoEl.className = 'msg-who';
  whoEl.textContent = who;
  const textEl = document.createElement('span');
  textEl.className = 'msg-text';
  // textContent：模型输出与玩家输入都只作为文本呈现
  textEl.textContent = text;
  row.append(whoEl, textEl);
  wrap.appendChild(row);
  wrap.scrollTop = wrap.scrollHeight;
}

function remember(who, text) {
  state.log.push({ who, text: text.slice(0, 240), at: Date.now() });
  if (state.log.length > 160) state.log = state.log.slice(-160);
  save();
}

function playerLine(text) {
  line('you', '你', text);
  remember('you', text);
}
function dollLine(text) {
  line('doll', nameOf('doll'), text);
  remember('doll', text);
}
function sceneLine(speakerId, text) {
  line(speakerId === 'YOU' ? 'body' : 'scene', nameOf(speakerId), text);
  remember(speakerId, text);
}
function envLine(text) {
  line('env', '', text);
  remember('ENV', text);
}
function actLine(text) {
  line('act', '', text);
}
function sysLine(text) {
  line('sys', '', text);
}

function refreshHeader() {
  $('nightPill').textContent = `第 ${state.nights} 夜${state.sync?.offlineDirty ? ' · 本机' : ''}`;
  $('dollNameLabel').textContent = state.dollName || '还没有名字';
  $('roomLabel').textContent = (ROOMS[state.stage.roomId] || ROOMS.bedroom).label;
  const face = $('dollFace');
  face.classList.toggle('reluctant', state.doubt >= 6);
  face.classList.toggle('restless', state.doubt >= 3 && state.doubt < 6);
  renderRoster();
}

const CHIP_COLOR = { YOU: '#e7c48c', A: '#d9d4cf', B: '#c9a4d8', C: '#f0d68a', Z: '#9c9c9c' };

function renderRoster() {
  const box = $('roster');
  box.innerHTML = '';
  state.stage.present.forEach((id) => {
    const chip = document.createElement('span');
    chip.className = 'roster-chip';
    chip.style.borderColor = CHIP_COLOR[id] || '#ccc';
    chip.textContent = nameOf(id) + (CAST[id] && CAST[id].renameable && !state.names[id] ? '（可改名）' : '');
    box.appendChild(chip);
  });
}

// ---------- 渲染模型 ----------

function currentModel() {
  const room = ROOMS[state.stage.roomId] || ROOMS.bedroom;
  const present = state.stage.present;
  const assigned = assignSpots(state.stage.roomId, present);
  const actors = present.map((id) => {
    const spotKey = state.stage.poses[id] || assigned[id];
    const spot = room.spots[spotKey] || room.spots.middle;
    return { castId: id, gx: spot.x, gy: spot.y, spot: spotKey, facing: 'down' };
  });
  return { room, actors, ambient: state.stage.ambient };
}

// ---------- 演出 ----------

const VERB_LABEL = {
  off: '关掉', on: '打开', knock: '碰了一下', flicker: '让它闪', open: '打开', close: '关上', look: '看着',
  sit: '坐下', lie: '躺下', hit: '砸', ring: '让它响', silence: '按掉', throw: '扔', check: '看了眼',
  slam: '甩上', lock: '锁上', boil: '烧', pour: '倒', run: '开', stop: '停', drop: '摔', fill: '倒满', hold: '握着',
  ding: '按了', step: '踩', jam: '卡住', print: '打印', kick: '踹', type: '敲', push: '推', horn: '按喇叭',
  start: '发动', pass: '开过', refill: '续上', slide: '推过去', loud: '开大', change: '换了', dim: '调暗',
};

function runBeats(beats, onDone) {
  busy = true;
  setInputEnabled(false);
  clearOptions();

  let maxAt = 0;
  beats.forEach((beat) => {
    maxAt = Math.max(maxAt, beat.at);
    setTimeout(() => {
      const room = ROOMS[state.stage.roomId] || ROOMS.bedroom;
      if (beat.action === 'move') {
        const spot = room.spots[beat.spot] || room.spots.middle;
        state.stage.poses[beat.role] = beat.spot;
        stage.walkTo(beat.role, spot.x, spot.y, 'down');
      } else if (beat.action === 'use') {
        const obj = findObject(state.stage.roomId, beat.target);
        const who = beat.role === 'doll' ? nameOf('doll') : nameOf(beat.role);
        actLine(`${who} ${VERB_LABEL[beat.verb] || beat.verb} ${obj ? obj.label : beat.target}`);
        if (beat.role === 'doll') {
          // 娃娃的暗手：没有身体，直接让物件出反应
          stage.envReact(beat.target, beat.verb === 'ring' || beat.verb === 'ding' ? 'ring' : 'flicker');
        } else {
          stage.useObject(beat.role, beat.target);
        }
      } else if (beat.action === 'speak') {
        if (beat.role === 'doll') {
          dollLine(beat.text);
        } else if (beat.role === 'ENV') {
          envLine(beat.text);
          stage.envSay(beat.text, beat.target);
          if (beat.effect) stage.envReact(beat.target, beat.effect);
        } else {
          sceneLine(beat.role, beat.text);
          stage.say(beat.role, beat.text, nameOf(beat.role));
          stage.focus(beat.role);

        }
      } else if (beat.action === 'ambient') {
        const next = {};
        if (beat.weather) next.weather = beat.weather;
        if (beat.light) next.light = beat.light;
        state.stage.ambient = { ...state.stage.ambient, ...next };
        stage.setAmbient(next);
        save();
      } else if (beat.action === 'burst') {
        stage.burstOn(beat.role, beat.effect === 'mend' ? 0x8eae7b : 0xcb5b4f);
        stage.shake(beat.role);
      } else if (beat.action === 'shake') {
        stage.shake(beat.role);
      } else if (beat.action === 'focus') {
        stage.focus(beat.role);
      }
    }, beat.at);
  });

  setTimeout(() => {
    if (onDone) onDone();
    busy = false;
    setInputEnabled(true);
  }, maxAt + 1200);
}

function endNight(script, snapshot, playerText) {
  if (snapshot) acceptSnapshot(snapshot);
  else {state = settleOffline(state,script,playerText);setOfflineOnly(true);save();}
  const summary = state.lastNight?.text || script.aftermath || lastSpokenLine(script);
  refreshHeader();
  if (summary) {
    const card = $('report');
    card.classList.remove('hidden');
    card.innerHTML = '';
    const h = document.createElement('p');
    h.className = 'report-title';
    h.textContent = `第 ${state.nights} 夜`;
    const body = document.createElement('p');
    body.className = 'report-body';
    body.textContent = summary;
    const foot = document.createElement('p');
    foot.className = 'report-foot';
    foot.textContent = '这段只留在你的剧场里。';
    card.append(h, body, foot);
  }
  dollLine(closingLine(state.doubt));
}

function lastSpokenLine(script) {
  const spoken = script.beats.filter((b) => b.action === 'speak' && !['Z', 'ENV', 'doll'].includes(b.role));
  if (!spoken.length) return null;
  const last = spoken[spoken.length - 1];
  return `${nameOf(last.role)}最后说：${last.text}`;
}

// ---------- 对话主流程 ----------

function sceneInput(text) {
  return {text,roomId:state.stage.roomId,present:state.stage.present,names:state.names,
    ambient:state.stage.ambient,nights:state.nights,doubt:state.doubt,
    memories:state.memories,dollMemory:state.memories.doll||[],confirmedFacts:state.confirmedFacts,
    recentNight:state.lastNight?.text||null};
}
function showDraft(current) {
  if(interaction!==current || current.epoch!==interactionEpoch)return;
  current.phase='draft';busy=false;
  const options=[
    {label:'就这样，动手',onPick:()=>confirmAndPlay(current)},
    {label:'不是这个意思',onPick:()=>cancelCurrent()},
    {label:'收起这一幕',onPick:()=>cancelCurrent()},
  ];
  renderOptions(options);
  if(current.script.advice)showAdvice(current.script.advice);
  setInputEnabled(true);
}
async function confirmAndPlay(current) {
  if(interaction!==current || current.epoch!==interactionEpoch || !['draft','confirm-uncertain'].includes(current.phase))return;
  current.phase='confirming';busy=true;clearOptions();setInputEnabled(false);
  $('input').placeholder='正在保存这一幕……';
  let snapshot;
  try {
    snapshot=await confirmScript(current.script);
    if(interaction!==current || current.epoch!==interactionEpoch)return;
  } catch(error) {
    if(interaction!==current)return;
    if(error.status===409 || error.status===410) {
      interaction=null;busy=false;
      sysLine('这一幕已经过期或舞台有变化，请重新说一次。');
      try {acceptSnapshot(await refreshSession());}catch {}
      setInputEnabled(true);return;
    }
    current.phase='confirm-uncertain';busy=false;
    sysLine('暂时没收到保存确认。可以重试同一幕，不会重复增加夜数；确认前先不演出。');
    renderOptions([{label:'重试保存这一幕',onPick:()=>confirmAndPlay(current)}]);
    setInputEnabled(false);return;
  }
  current.phase='playing';
  if(current.script.advice)noteDeclined(current.script.advice);
  runBeats(current.script.beats,()=>{
    if(interaction!==current)return;
    endNight(current.script,snapshot,current.text);
    interaction=null;
  });
}
async function handlePlayerText(text) {
  if(busy || synchronizing || interaction?.phase==='confirm-uncertain')return;
  const t=String(text||'').trim();
  if(!t || t.length>200 || isDangerousName(t)){sysLine('请用200字以内的普通文字说给娃娃听。');return;}
  if(interaction)await cancelCurrent({quiet:true});
  if(busy || interaction)return;
  const epoch=++interactionEpoch;
  busy=true;setInputEnabled(false);playerLine(t);$('input').value='';clearOptions();
  if (kernelMode) {
    try {
      await submitKernelTurn(t);
    } catch (error) {
      if (error?.status === 409) {
        try { await synchronizeKernel(); startKernelEventStream(); sysLine('世界刚刚变化，已重新同步，请再说一次。'); }
        catch { sysLine('世界暂时没有回应，请稍后再试。'); }
      } else {
        sysLine('世界暂时没有回应，这句话没有写入。');
      }
    } finally {
      if (epoch === interactionEpoch) {
        busy = false;
        setInputEnabled(true);
      }
    }
    return;
  }
  const correction=t.match(/^(?:纠正故事|更正故事|改正事实)[：:\s]+([\s\S]+)$/);
  if(correction) {
    state.confirmedFacts=[correction[1].slice(0,600)];state.memories={};state.lastNight=null;
    state.story=correction[1].slice(0,600);state.onboardingPhase='names-confirmed';
    await persistProfile();busy=false;refreshHeader();setInputEnabled(true);
    dollLine('我按这段更正记住了，旧的说法不再拿来演。');return;
  }
  const staged=applyStaging(t);
  if(staged.changed)await persistProfile();
  if(staged.onlyStaging){busy=false;setInputEnabled(true);return;}
  const current={epoch,requestId:newRequestId(),controller:new AbortController(),phase:'generating',text:t,script:null};
  interaction=current;
  renderOptions([{label:'取消这一幕',onPick:()=>cancelCurrent()}]);
  $('input').placeholder='娃娃正在排这一幕……';
  try {
    const script=await writeScript(sceneInput(t),{signal:current.controller.signal,requestId:current.requestId});
    if(interaction!==current || epoch!==interactionEpoch)return;
    current.script=script;
    if(script.snapshot && !state.sync?.offlineDirty)acceptSnapshot(script.snapshot);
    if(script.source==='offline')sysLine('本幕使用本机剧本。确认后只保存到这台设备，联网后可选择同步。');
    else if(script.source==='local')sysLine('本幕使用内置剧本，舞台仍然可以正常演出。');
    else if(script.source==='mixed')sysLine('这一幕有角色用了内置台词。');
    if(script.ask && !script.ack) {
      interaction=null;busy=false;dollLine(script.ask);
      renderOptions((script.options||[]).map(label=>({label,onPick:()=>handlePlayerText(label)})));
      if(script.advice)showAdvice(script.advice);
      setInputEnabled(true);return;
    }
    dollLine(script.ack);showDraft(current);
  } catch(error) {
    if(interaction!==current || epoch!==interactionEpoch)return;
    interaction=null;busy=false;clearOptions();
    if(error.name==='AbortError')sysLine('这一幕已取消。');
    else if(error.status===409 || error.status===410) {
      sysLine('舞台刚刚有变化，请再说一次。');
      try {acceptSnapshot(await refreshSession());stage.setModel(currentModel());}catch {setOfflineOnly(true);}
    } else if(error.status===401) {
      setOfflineOnly(true);sysLine('保存凭证已失效，本机进度还在。下一次联网会重新接上。');localChanged();
    } else sysLine('这次没有排好，再试一次就好。');
    setInputEnabled(true);
  }
}

function renderOptions(options) {
  const box = $('options');
  box.innerHTML = '';
  box.classList.remove('hidden');
  options.forEach((o) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'opt';
    b.textContent = o.label;
    b.addEventListener('click', o.onPick);
    box.appendChild(b);
  });
}

function showAdvice(advice) {
  const box = $('advice');
  box.innerHTML = '';
  box.className = `advice advice-${advice.tone}`;
  box.classList.remove('hidden');
  const who = document.createElement('span');
  who.className = 'advice-who';
  who.textContent = state.dollName || '娃娃';
  const text = document.createElement('span');
  text.className = 'advice-text';
  text.textContent = advice.text;
  box.append(who, text);
}

function clearAdvice() {
  const box = $('advice');
  box.innerHTML = '';
  box.classList.add('hidden');
}

function noteDeclined(advice) {
  state.declined.push({ text: advice.text, night: state.nights });
  state.declined = state.declined.slice(-8);
  save();
  refreshHeader();
}

function clearOptions() {
  const box = $('options');
  box.innerHTML = '';
  box.classList.add('hidden');
  clearAdvice();
}

function setInputEnabled(on) {
  $('input').disabled = !on;
  $('send').disabled = !on;
  $('input').placeholder = on ? '想让它做什么？' : '他们在演……';
}

// ---------- 在场、房间、名字：全靠说话 ----------

// 代词/身份 → 角色位。玩家说"她也在"就是请 B 上场。
const PRONOUN = { 他: 'A', 那个人: 'A', 她: 'B', 另一个人: 'B', 知情的人: 'C', 知情者: 'C' };

/**
 * 从一句话里解析：换房间、请人、让人走、改名。
 * 返回 { changed, onlyStaging }：onlyStaging 表示这句话只是安排舞台，不需要演。
 */
function applyStaging(t) {
  let changed = false;
  let renamed = null;

  // 换房间
  for (const [id, room] of Object.entries(ROOMS)) {
    if (t.includes(room.label) && state.stage.roomId !== id) {
      state.stage.roomId = id;
      state.stage.poses = {};
      changed = true;
    }
  }

  // 改名："他叫老张" / "她的名字是小周" / "给 C 起名阿May" / "A 改名王总"
  // 玩家明确改名也是一次资料确认，随后同步服务端。
  {
    const patterns = [
      /(?:给|把)?\s*([ABC])\s*(?:叫做|叫|起名|取名|改名|名字是|就叫)[：:\s]*([^\s，。,！!？?、]{1,12})/,
      /(他|她|那个人|另一个人|知情的人|知情者)(?:的名字)?(?:叫做|叫|改名|就叫|名字是)[：:\s]*([^\s，。,！!？?、]{1,12})/,
    ];
    for (const re of patterns) {
      const m = t.match(re);
      if (!m) continue;
      const id = PRONOUN[m[1]] || m[1];
      const name = m[2].replace(/[的了吧啊呀]+$/, '');
      if (RENAMEABLE_IDS.includes(id) && name && !isDangerousName(name) && name !== nameOf(id)) {
        state.names[id] = name.slice(0, 12);
        renamed = { id, name: state.names[id] };
        changed = true;
        if (!state.stage.present.includes(id) && state.stage.present.length < STAGE_IDS.length) state.stage.present.push(id);
        break;
      }
    }
  }

  // 请人上场：提到某人的名字或代词就把他加进来
  for (const id of STAGE_IDS) {
    if (id === 'YOU' || state.stage.present.includes(id)) continue;
    const candidates = [state.names[id], CAST[id].defaultName, ...Object.keys(PRONOUN).filter((k) => PRONOUN[k] === id)].filter(Boolean);
    if (candidates.some((nm) => t.includes(nm)) && state.stage.present.length < STAGE_IDS.length) {
      state.stage.present.push(id);
      changed = true;
    }
  }

  // 让人走："让他走" / "叫她出去"
  const leave = t.match(/(?:让|叫)(.{1,8}?)(?:走|离开|别在这|出去|滚)/);
  if (leave) {
    for (const id of [...state.stage.present]) {
      if (id === 'YOU') continue;
      const nms = [state.names[id], CAST[id].defaultName, ...Object.keys(PRONOUN).filter((k) => PRONOUN[k] === id)].filter(Boolean);
      if (nms.some((nm) => leave[1].includes(nm))) {
        state.stage.present = state.stage.present.filter((x) => x !== id);
        changed = true;
      }
    }
  }

  if (changed) {
    state.stage = normalizeStage(state.stage);
    save();
    refreshHeader();
    stage.setModel(currentModel());
  }
  if (renamed) {
    dollLine(`好。以后${CAST[renamed.id].defaultName}就叫${renamed.name}。`);
    // 这句话如果只是在起名，就不用演一场
    const rest = t.replace(/(?:给|把)?\s*[ABC]\s*(?:叫做|叫|起名|取名|改名|名字是|就叫)[：:\s]*[^\s，。,！!？?、]{1,12}/, '').replace(/(他|她|那个人|另一个人|知情的人|知情者)(?:的名字)?(?:叫做|叫|改名|就叫|名字是)[：:\s]*[^\s，。,！!？?、]{1,12}/, '').trim();
    if (rest.length < 4) return { changed, onlyStaging: true };
  }
  return { changed, onlyStaging: changed && t.length<=20 && /^(?:去|换到|换成|到|让|叫|请|她也在|他也在|知情)/.test(t) && !/难受|揭穿|出丑|摔|砸|演|施法/.test(t) };
}

// ---------- 开场（故事→人名→确认）----------

async function renderOnboarding() {
  const wrap = $('boot');
  wrap.classList.remove('hidden');
  wrap.innerHTML = '';

  // 第一步：给娃娃起名 + 让玩家讲故事
  if (state.onboardingPhase!=='story-told' || !state.dollName || !state.story) {
    const form = document.createElement('form');
    form.className = 'boot-form';
    const kicker = document.createElement('p');
    kicker.className = 'kicker';
    kicker.textContent = '它还没有名字';
    const title = document.createElement('h2');
    title.className = 'boot-title';
    title.textContent = '先给它取个名，然后把你的故事讲给它听。';

    const nameLabel = document.createElement('label');
    nameLabel.textContent = '叫它什么：';
    nameLabel.className = 'boot-label';
    const nameInput = document.createElement('input');
    nameInput.className = 'boot-input';
    nameInput.maxLength = 12;
    nameInput.placeholder = '比如：阿布';
    nameInput.value = state.dollName || '';
    nameInput.autocomplete = 'off';

    const storyLabel = document.createElement('label');
    storyLabel.textContent = '你的故事（谁伤害了你，发生了什么）：';
    storyLabel.className = 'boot-label';
    const storyInput = document.createElement('textarea');
    storyInput.className = 'boot-textarea';
    storyInput.maxLength = 600;
    storyInput.placeholder = '比如：我和老张在一起三年了，上个月发现他背着我和小周好上了……';
    storyInput.rows = 4;
    storyInput.value = state.story || '';

    const btn = document.createElement('button');
    btn.className = 'btn primary';
    btn.type = 'submit';
    btn.textContent = '讲给它听';

    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = '别填真名。它只需要一个你叫得出口的称呼。故事里的人名也可以是化名。';

    form.append(kicker, title, nameLabel, nameInput, storyLabel, storyInput, btn, hint);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const dName = nameInput.value.trim();
      const story = storyInput.value.trim();
      if (!dName || !story || story.length < 10 || isDangerousName(dName) || isDangerousName(story)) {
        alert('请给娃娃起个名，并讲一下你的故事。');
        return;
      }
      if(btn.disabled)return;
      const onboardingEpoch=++interactionEpoch;
      state.dollName = dName.slice(0, 12);
      state.story = story.slice(0, 600);
      state.onboardingPhase = 'story-told';
      save();
      btn.disabled = true;
      btn.textContent = '正在听...';

      const names=await extractStoryNames(state.story);
      if(onboardingEpoch!==interactionEpoch)return;
      for(const [id,name] of Object.entries(names)) {
        if(RENAMEABLE_IDS.includes(id) && typeof name==='string' && !isDangerousName(name))state.names[id]=name.slice(0,12);
      }
      save();
      await renderOnboarding(); // 进入第二步
    });

    wrap.appendChild(form);
    if(window.innerWidth>520)setTimeout(() => nameInput.focus(), 50);
    return;
  }

  // 第二步：确认人名
  if (state.onboardingPhase === 'story-told') {
    const form = document.createElement('form');
    form.className = 'boot-form';
    const title = document.createElement('h2');
    title.className = 'boot-title';
    title.textContent = `好。我叫${state.dollName}。`;
    const subtitle = document.createElement('p');
    subtitle.textContent = '我从你的故事里听到了这些人。名字对吗？';
    subtitle.className = 'boot-subtitle';

    form.append(title, subtitle);

    const nameEdits = [];
    for (const id of ['A', 'B', 'C']) {
      const row = document.createElement('div');
      row.className = 'boot-name-row';
      const label = document.createElement('label');
      label.textContent = `${CAST[id].defaultName}：`;
      label.className = 'boot-name-label';
      const input = document.createElement('input');
      input.className = 'boot-name-input';
      input.maxLength = 12;
      input.value = state.names[id] || '';
      input.placeholder = '没有就留空';
      nameEdits.push({ id, input });
      row.append(label, input);
      form.appendChild(row);
    }

    const btn = document.createElement('button');
    btn.className = 'btn primary';
    btn.type = 'submit';
    btn.textContent = '就是这些人';
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = '这些称呼和下方故事确认后，娃娃才会记住。以后可以说“他改名……”或“纠正故事：……”。';
    const storyReview=document.createElement('textarea');
    storyReview.className='boot-textarea';storyReview.maxLength=600;storyReview.rows=4;storyReview.value=state.story;
    const storyLabel=document.createElement('label');storyLabel.className='boot-label';storyLabel.textContent='它听到的故事（可以修改）：';
    form.append(storyLabel,storyReview);
    form.append(btn, hint);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if(btn.disabled)return;
      const confirmedStory=storyReview.value.trim();
      if(!confirmedStory || isDangerousName(confirmedStory)){sysLine('请检查这段故事的文字。');return;}
      btn.disabled=true;btn.textContent='正在记住……';
      // 收集最终人名
      for (const { id, input } of nameEdits) {
        const v = input.value.trim();
        if (v && !isDangerousName(v)) {
          state.names[id] = v.slice(0, 12);
        } else {
          delete state.names[id];
        }
      }
      // 把有名字的人加进场上
      for (const id of RENAMEABLE_IDS) {
        if (state.names[id] && !state.stage.present.includes(id)) state.stage.present.push(id);
      }
      state.onboardingPhase = 'names-confirmed';
      state.story = confirmedStory;
      state.confirmedFacts = [confirmedStory];
      state.memories = {};
      await persistProfile();
      save();
      wrap.classList.add('hidden');
      refreshHeader();
      stage.setModel(currentModel());
      dollLine(`好。故事和称呼我记下了。你想让我做什么，说给我听就行。`);
      setInputEnabled(true);
    });

    wrap.appendChild(form);
    if(window.innerWidth>520)setTimeout(() => nameEdits[0].input.focus(), 50);
  }
}

async function boot() {
  try {
    stage = await createStage($('stage'));
  } catch (err) {
    sysLine(`素材没加载出来：${err.message}`);
    setInputEnabled(false);
    return;
  }
  stage.setModel(currentModel());
  refreshHeader();
  if (kernelMode) {
    try { await synchronizeKernel(); startKernelEventStream(); }
    catch { sysLine('Python 世界内核暂时不可用，请确认后端已启动。'); }
  } else {
    await synchronize({initial:true});
  }
  stage.setModel(currentModel());
  refreshHeader();

  if (!state.dollName || state.onboardingPhase !== 'names-confirmed') {
    renderOnboarding();
  } else if (state.log.length) {
    state.log.slice(-10).forEach((m) => {
      const kind = m.who === 'you' ? 'you' : m.who === 'doll' ? 'doll' : m.who === 'ENV' ? 'env' : m.who === 'YOU' ? 'body' : 'scene';
      line(kind, m.who === 'you' ? '你' : m.who === 'ENV' ? '' : nameOf(m.who), m.text);
    });
    // 回放后的开场问候只显示、不落盘：否则每次刷新都往日志里追加一句，
    // 反复刷新后底部会堆一排「演完了。你先歇会儿。」
    line('doll', nameOf('doll'), closingLine(state.doubt));

  } else {
    line('doll', nameOf('doll'), '你回来了。今晚想做什么？');
  }

  $('compose').addEventListener('submit', (e) => {
    e.preventDefault();
    handlePlayerText($('input').value);
  });
  $('log').addEventListener('click', () => {
    if (!busy && window.innerWidth > 520) $('input').focus();
  });
  booted=true;
  setInputEnabled(state.onboardingPhase==='names-confirmed');
  window.addEventListener('online',()=>{if(booted && !interaction && !busy && $('boot').classList.contains('hidden'))synchronize();});
  window.addEventListener('pagehide', stopKernelEventStream, { once: true });
  const syncButton=document.createElement('button');syncButton.type='button';syncButton.className='opt';syncButton.textContent='同步进度';
  syncButton.addEventListener('click',()=>{if(!busy && !interaction && $('boot').classList.contains('hidden'))synchronize();});
  document.querySelector('.doll-bar').appendChild(syncButton);
}

boot();
