// 本机资料只迁移一次；旧档始终保留，头像永不进入服务器 payload。
import { CAST_IDS, RENAMEABLE_IDS, normalizeStage } from '../shared/cast.js';
import { isDangerous } from '../shared/script-contract.js';

export const STORAGE_KEY = 'voodoo-hex-v5';
export const LEGACY_KEY = 'voodoo-cabinet-v1';
export function defaults() {
  return {
    schemaVersion: 5, dollName: '', avatar: '', onboardingPhase: null, story: '', confirmedFacts: [],
    nights: 0, doubt: 0, stage: normalizeStage(null), names: {}, memories: {}, log: [],
    lastNight: null, declined: [], warnedLocal: false, sync: null,
  };
}
export function normalize(raw) {
  const s = { ...defaults(), ...(raw && typeof raw === 'object' ? raw : {}) };
  s.dollName = typeof s.dollName === 'string' ? s.dollName.slice(0, 12) : '';
  s.avatar = typeof s.avatar === 'string' && /^data:image\/(webp|png|jpeg);base64,/.test(s.avatar) && s.avatar.length < 700000 ? s.avatar : '';
  s.onboardingPhase = ['story-told', 'names-confirmed'].includes(s.onboardingPhase) ? s.onboardingPhase : null;
  s.story = typeof s.story === 'string' ? s.story.slice(0, 600) : '';
  s.confirmedFacts = Array.isArray(s.confirmedFacts) ? s.confirmedFacts.filter(x => typeof x === 'string' && !isDangerous(x)).slice(-24).map(x => x.slice(0, 600)) : [];
  s.nights = Math.max(0, Math.min(999, Number(s.nights) || 0));
  s.doubt = Math.max(0, Math.min(10, Number(s.doubt) || 0));
  s.stage = normalizeStage(s.stage);
  s.log = Array.isArray(s.log) ? s.log.filter(m => m && typeof m.text === 'string').slice(-160) : [];
  s.names = Object.fromEntries(Object.entries(s.names || {}).filter(([id, v]) => RENAMEABLE_IDS.includes(id) && typeof v === 'string' && v.trim() && !isDangerous(v)).map(([id,v])=>[id,v.trim().slice(0,12)]));
  s.memories = Object.fromEntries(Object.entries(s.memories || {}).filter(([id, list]) => [...CAST_IDS, 'doll', 'ENV'].includes(id) && Array.isArray(list)).map(([id,list])=>[id,list.filter(x=>typeof x==='string'&&!isDangerous(x)).slice(-12).map(x=>x.slice(0,200))]));
  s.declined = Array.isArray(s.declined) ? s.declined.slice(-8) : [];
  s.sync = s.sync && typeof s.sync.worldId === 'string' && Number.isInteger(s.sync.version) ? {worldId:s.sync.worldId,version:s.sync.version,offlineDirty:Boolean(s.sync.offlineDirty)} : null;
  return s;
}
export function loadState(storage) {
  try {
    const current = storage.getItem(STORAGE_KEY);
    if (current) {
      try { return normalize(JSON.parse(current)); }
      catch { storage.setItem(STORAGE_KEY+'-unreadable-backup',current); }
    }
    const previous = JSON.parse(storage.getItem(LEGACY_KEY) || 'null');
    if (!previous || typeof previous !== 'object') return defaults();
    return normalize({dollName: previous.name, avatar: previous.avatar, migratedFrom: LEGACY_KEY});
  } catch { return defaults(); }
}
export function serverPayload(s) {
  return {schemaVersion:5,dollName:s.dollName, names:s.names, stage:s.stage, nights:s.nights, doubt:s.doubt,
    onboardingPhase:s.onboardingPhase, confirmedFacts:s.confirmedFacts,story:s.onboardingPhase==='names-confirmed'?s.confirmedFacts.join('\n').slice(0,600):'', memories:s.memories,
    lastNight:s.lastNight, log:s.log.slice(-40).map(m=>({who:m.who,text:String(m.text).slice(0,200)}))};
}
export function mergeSnapshot(local, snapshot) {
  if (!snapshot?.state) return local;
  if(local.sync?.worldId===snapshot.worldId && local.sync.version>snapshot.version)return local;
  return normalize({...local,...snapshot.state,confirmedFacts:snapshot.confirmedFacts || [],
    memories:snapshot.memories || {},log:Array.isArray(snapshot.log) ? snapshot.log : local.log,
    sync:{worldId:snapshot.worldId,version:snapshot.version,offlineDirty:false}});
}

export function markOffline(local) {
  return {...local,sync:{worldId:local.sync?.worldId||'local',version:local.sync?.version||0,offlineDirty:true}};
}
export function preserveLocalBackup(storage,state) {
  const key=STORAGE_KEY+'-backup-'+Date.now();
  storage.setItem(key,JSON.stringify(state));
  return key;
}
export function hasLocalProgress(state) {
  return Boolean(state.dollName || state.nights || state.story || state.confirmedFacts.length || state.log.length || Object.keys(state.names).length);
}
// 无服务端确认的本机演出只结算本机一次，不伪装成在线存档。
export function settleOffline(local,script,playerText) {
  const state=normalize(structuredClone(local));
  const receipt=script.localReceipt || script.requestId;
  if(receipt && state.lastLocalReceipt===receipt)return state;
  if(script.turnId)throw new Error('online-script-needs-confirmation');
  state.nights=Math.min(999,state.nights+1);
  if(state.nights%2===0)state.doubt=Math.min(10,state.doubt+1);
  const add=(id,entry)=>{state.memories[id]=[...(state.memories[id]||[]),entry].slice(-12);};
  add('doll',`玩家第${state.nights}夜私下说：${String(playerText).slice(0,200)}`);
  for(const beat of script.beats) {
    if(beat.action==='move')state.stage.poses[beat.role]=beat.spot;
    if(beat.action==='ambient')for(const key of ['weather','light'])if(beat[key])state.stage.ambient[key]=beat[key];
    if(beat.action==='speak' && beat.role==='doll')add('doll',`娃娃说：${beat.text}`);
    else {
      const entry=beat.action==='speak'?`第${state.nights}夜虚构舞台，${beat.role}说：${beat.text}`:`舞台动作：${JSON.stringify(beat)}`;
      for(const id of ['doll',...state.stage.present])add(id,entry);
    }
    if(['use','ambient'].includes(beat.action))add('ENV',JSON.stringify(beat));
  }
  const last=[...script.beats].reverse().find(b=>b.action==='speak' && !['doll','ENV'].includes(b.role));
  state.lastNight={night:state.nights,text:script.aftermath || last?.text || script.ack};
  state.lastLocalReceipt=receipt;
  return markOffline(state);
}
