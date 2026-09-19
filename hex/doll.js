// 同源匿名会话。模型请求、确认与本机演出分开，迟到请求不回写会话版本。
import { validateScript, LIMITS } from '../shared/script-contract.js';
import { localScript } from '../shared/local-station.js';
import { serverPayload } from './storage.js';
let sessionVersion = null;
let sessionWorld = null;
let sessionEpoch = 0;
let offlineOnly = false;
export const newRequestId = () => globalThis.crypto?.randomUUID?.() || 'turn-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
export function setOfflineOnly(value) { offlineOnly=Boolean(value); }
export function isSessionOnline() { return sessionVersion!==null && !offlineOnly; }
function adopt(snapshot, reset=false) {
  if(!Number.isSafeInteger(snapshot?.version))return;
  if(reset || snapshot.worldId===sessionWorld) {
    if(reset || snapshot.version>=sessionVersion) {sessionVersion=snapshot.version;sessionWorld=snapshot.worldId;}
  }
}
async function request(url, body, {signal, timeout=15000, method='POST'}={}) {
  const controller=new AbortController();
  const abort=()=>controller.abort(signal?.reason);
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>controller.abort(new DOMException('Timeout','TimeoutError')),timeout);
  try {
    const response=await fetch(url,{method,credentials:'same-origin',headers:method==='GET'?{}:{'content-type':'application/json'},body:method==='GET'?undefined:JSON.stringify(body),signal:controller.signal});
    const data=await response.json();
    if(!response.ok || !data.ok)throw Object.assign(new Error(data.reason||'request-failed'),{status:response.status,reason:data.reason});
    return data;
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
export async function initializeSession(state,{forkLocal=false}={}) {
  const epoch=++sessionEpoch;
  const body={legacy:serverPayload(state),forkLocal};
  let data;
  try {data=await request('/api/session',body,{timeout:3500});}
  catch(error) {if(error.status!==401)throw error;data=await request('/api/session',body,{timeout:3500});}
  if(epoch!==sessionEpoch)throw new DOMException('Superseded','AbortError');
  adopt(data.snapshot,true);offlineOnly=false;
  return data.snapshot;
}
export async function refreshSession() {
  const epoch=sessionEpoch;
  const data=await request('/api/session',null,{method:'GET',timeout:3500});
  if(epoch===sessionEpoch)adopt(data.snapshot,sessionWorld===null);
  return data.snapshot;
}
export async function saveProfile(state) {
  if(!isSessionOnline())return null;
  const epoch=sessionEpoch;
  const data=await request('/api/profile',{version:sessionVersion,profile:{dollName:state.dollName,names:state.names,stage:state.stage,confirmedFacts:state.confirmedFacts}},{timeout:4000});
  if(epoch!==sessionEpoch)throw new DOMException('Superseded','AbortError');
  adopt(data.snapshot);return data.snapshot;
}
export async function extractStoryNames(story,{signal}={}) {
  if(!isSessionOnline())return {};
  try {return (await request('/api/extract-names',{story},{signal,timeout:4500})).names||{};}catch {return {};}
}
export async function cancelScript({turnId,requestId}={}) {
  if(sessionVersion===null)return null;
  const epoch=sessionEpoch;
  try {const data=await request('/api/cancel',{turnId,requestId},{timeout:2500});if(epoch===sessionEpoch)adopt(data.snapshot);return data.snapshot;}
  catch {return null;}
}
export async function confirmScript(script) {
  if(!script.turnId)return null;
  const epoch=sessionEpoch;
  let firstError;
  for(let i=0;i<2;i++) {
    try {
      const data=await request('/api/confirm',{turnId:script.turnId},{timeout:4000});
      if(epoch!==sessionEpoch)throw new DOMException('Superseded','AbortError');
      adopt(data.snapshot);return data.snapshot;
    } catch(error) {firstError=error;if(error.status || error.name==='AbortError')throw error;}
  }
  throw firstError;
}
export function offlineScript(input) {
  const script=validateScript(localScript(input),{roomId:input.roomId,present:input.present});
  if(!script)throw new Error('local-script-invalid');
  return {...script,source:'offline',reason:'connection-lost',turnId:null};
}
export async function writeScript(input,{signal,requestId=newRequestId()}={}) {
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  if(offlineOnly || sessionVersion===null || globalThis.navigator?.onLine===false)return {...offlineScript(input),requestId};
  const epoch=sessionEpoch;
  try {
    const data=await request('/api/write',{text:String(input.text).slice(0,LIMITS.input),roomId:input.roomId,present:input.present,names:input.names,ambient:input.ambient,version:sessionVersion,requestId},{signal});
    if(signal?.aborted || epoch!==sessionEpoch)throw new DOMException('Cancelled','AbortError');
    const script=validateScript(data.script,{roomId:input.roomId,present:input.present});
    if(!script)throw new Error('invalid-script');
    if(data.snapshot)adopt(data.snapshot);else if(Number.isSafeInteger(data.version))sessionVersion=Math.max(sessionVersion,data.version);
    return {...script,turnId:data.turnId||null,reason:data.reason||null,snapshot:data.snapshot||null,requestId,metrics:data.metrics};
  } catch(error) {
    if(signal?.aborted || epoch!==sessionEpoch)throw new DOMException('Cancelled','AbortError');
    if(error.status===409 || error.status===410 || error.status===401)throw error;
    await cancelScript({requestId});
    return {...offlineScript(input),requestId};
  }
}
export function closingLine(doubt) {
  if(doubt>=6)return '今晚这个戏……我不太想演了。你要是还想演，我演。';
  if(doubt>=4)return '你讲的时候，我听见你笑了一下。';
  if(doubt>=2)return '他今天又在你脑子里出现了几次？';
  return '演完了。你先歇会儿。';
}
