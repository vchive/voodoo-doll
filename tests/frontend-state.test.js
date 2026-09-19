import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, normalize, loadState, serverPayload, mergeSnapshot, markOffline, settleOffline, preserveLocalBackup, STORAGE_KEY, LEGACY_KEY } from '../hex/storage.js';

function storage(initial={}) {
  const data=new Map(Object.entries(initial));
  return {data,getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
}
const localScript=()=>({version:3,source:'offline',requestId:'local-1',turnId:null,ack:'一场虚构小戏。',beats:[
  {at:0,action:'speak',role:'doll',text:'这是我们的小秘密。'},
  {at:100,action:'speak',role:'A',text:'我先解释。'},
  {at:200,action:'use',role:'YOU',target:'lamp',verb:'off'},
  {at:300,action:'ambient',role:'ENV',light:'off'},
],aftermath:'这一幕结束。'});

test('v1只读迁娃娃资料，旧key和全部原始数据保留，头像不上传',()=>{
  const original={name:'阿布',avatar:'data:image/png;base64,aGVsbG8=',mana:72,pins:3,history:['旧日志']};
  const memory=storage({[LEGACY_KEY]:JSON.stringify(original)});
  const migrated=loadState(memory);
  assert.equal(migrated.dollName,'阿布');
  assert.equal(migrated.avatar,original.avatar);
  assert.deepEqual(JSON.parse(memory.getItem(LEGACY_KEY)),original);
  assert.equal(memory.getItem(STORAGE_KEY),null);
  const sent=serverPayload(migrated);
  assert.equal(sent.avatar,undefined);
  assert.ok(!JSON.stringify(sent).includes('data:image'));
});

test('v5优先读取，坏JSON先备份；没有存储不白屏',()=>{
  const current=normalize({dollName:'新娃娃',nights:5,confirmedFacts:['曾经的约定']});
  const memory=storage({[STORAGE_KEY]:JSON.stringify(current),[LEGACY_KEY]:JSON.stringify({name:'旧娃娃'})});
  assert.equal(loadState(memory).nights,5);
  memory.setItem(STORAGE_KEY,'{broken');
  assert.equal(loadState(memory).dollName,'旧娃娃');
  assert.equal(memory.getItem(STORAGE_KEY+'-unreadable-backup'),'{broken');
  assert.equal(memory.getItem(STORAGE_KEY),'{broken');
  assert.equal(loadState({getItem:()=>{throw new Error('denied');}}).nights,0);
});

test('在线confirm snapshot合并夜数不双算，保留本机头像并拒绝旧snapshot',()=>{
  const local=normalize({avatar:'data:image/png;base64,aGVsbG8=',nights:2,sync:{worldId:'w1',version:3,offlineDirty:false}});
  const snapshot={worldId:'w1',version:5,state:{...defaults(),nights:3},confirmedFacts:['已确认的故事'],memories:{A:['公开台词']},log:[]};
  delete snapshot.state.avatar;
  const merged=mergeSnapshot(local,snapshot);
  assert.equal(merged.nights,3);
  assert.equal(merged.avatar,local.avatar);
  assert.equal(mergeSnapshot(merged,snapshot).nights,3);
  assert.equal(mergeSnapshot(merged,{...snapshot,version:4,state:{...snapshot.state,nights:2}}).nights,3);
  assert.equal(merged.sync.offlineDirty,false);
});

test('离线完整演出只结算一次且标记dirty；私人文本只进娃娃，ENV只有物件事件',()=>{
  const initial=defaults();initial.stage.present=['YOU','A','B'];
  const settled=settleOffline(initial,localScript(),'只有娃娃知道的计划');
  assert.equal(settled.nights,1);
  assert.equal(settled.sync.offlineDirty,true);
  assert.equal(settled.stage.ambient.light,'off');
  assert.ok(settled.memories.doll.some(m=>m.includes('只有娃娃知道')));
  assert.ok(!JSON.stringify(settled.memories.A).includes('只有娃娃知道'));
  assert.ok(!JSON.stringify(settled.memories.B).includes('小秘密'));
  assert.ok(!JSON.stringify(settled.memories.ENV).includes('解释'));
  assert.equal(settleOffline(settled,localScript(),'重复').nights,1);
  assert.throws(()=>settleOffline(initial,{...localScript(),turnId:'online-unconfirmed'},'x'),/online-script-needs-confirmation/);
});

test('本机分歧备份不删原档，多条故事通过迁移payload保留',()=>{
  const local=markOffline(normalize({confirmedFacts:['第一条事实','第二条事实'],onboardingPhase:'names-confirmed',nights:4}));
  const memory=storage({[STORAGE_KEY]:JSON.stringify(local)});
  const backup=preserveLocalBackup(memory,local);
  assert.deepEqual(JSON.parse(memory.getItem(backup)),local);
  assert.equal(JSON.parse(memory.getItem(STORAGE_KEY)).nights,4);
  assert.deepEqual(serverPayload(local).confirmedFacts,['第一条事实','第二条事实']);
  assert.equal(serverPayload(local).schemaVersion,5);
});

async function doll(t,fetcher) {
  const previous=globalThis.fetch;
  globalThis.fetch=fetcher;
  t.after(()=>{globalThis.fetch=previous;});
  return import('../hex/doll.js?test='+Math.random());
}
function reply(data,status=200){return {ok:status<400,status,json:async()=>data};}
const snapshot=(version=0)=>({worldId:'world',version,state:{stage:defaults().stage,names:{},nights:0,doubt:0,dollName:''},confirmedFacts:[],memories:{},log:[]});

test('请求层用服务端版本发write；unknown cookie只重试初始化，不丢本机payload',async(t)=>{
  const calls=[];
  const api=await doll(t,async(url,options)=>{
    const body=options.body?JSON.parse(options.body):null;calls.push({url,body});
    if(calls.length===1)return reply({ok:false,reason:'UNAUTHORIZED'},401);
    if(url==='/api/session')return reply({ok:true,snapshot:snapshot(7)});
    if(url==='/api/write')return reply({ok:true,turnId:'draft-1',version:8,script:{...localScript(),source:'local'}});
    return reply({ok:true,snapshot:snapshot(9)});
  });
  await api.initializeSession(normalize({confirmedFacts:['私密故事'],onboardingPhase:'names-confirmed'}));
  assert.deepEqual(calls[1].body.legacy.confirmedFacts,['私密故事']);
  const script=await api.writeScript({text:'让他难受',roomId:'bedroom',present:['YOU','A'],names:{}},{requestId:'r1'});
  assert.equal(calls.find(c=>c.url==='/api/write').body.version,7);
  assert.equal(script.turnId,'draft-1');
  await api.saveProfile(defaults());
  assert.equal(calls.find(c=>c.url==='/api/profile').body.version,8);
});

test('取消的迟到write不推进版本，也不回退成本机已成功演出',async(t)=>{
  let resolveWrite;
  const calls=[];
  const api=await doll(t,async(url,options)=>{
    calls.push({url,body:options.body?JSON.parse(options.body):null});
    if(url==='/api/session')return reply({ok:true,snapshot:snapshot(2)});
    if(url==='/api/write')return new Promise(resolve=>{resolveWrite=resolve;});
    return reply({ok:true,snapshot:snapshot(3)});
  });
  await api.initializeSession(defaults());
  const controller=new AbortController();
  const pending=api.writeScript({text:'让他难受',roomId:'bedroom',present:['YOU','A']},{signal:controller.signal});
  controller.abort();
  resolveWrite(reply({ok:true,version:99,turnId:'late',script:localScript()}));
  await assert.rejects(pending,error=>error.name==='AbortError');
  await api.saveProfile(defaults());
  assert.equal(calls.find(c=>c.url==='/api/profile').body.version,2);
});

test('confirm响应丢失重试同turn，全部失败也不能转为离线确认',async(t)=>{
  const calls=[];
  const api=await doll(t,async(url,options)=>{
    calls.push({url,body:options.body?JSON.parse(options.body):null});
    if(url==='/api/session')return reply({ok:true,snapshot:snapshot(0)});
    throw new TypeError('network disconnected');
  });
  await api.initializeSession(defaults());
  await assert.rejects(api.confirmScript({turnId:'same-confirmation'}),/network disconnected/);
  const confirmations=calls.filter(c=>c.url==='/api/confirm');
  assert.equal(confirmations.length,2);
  assert.ok(confirmations.every(c=>c.body.turnId==='same-confirmation'));
});

test('无会话/离线无需fetch即可排完内置剧本，状态仍需显式本机结算',async(t)=>{
  let fetches=0;
  const api=await doll(t,async()=>{fetches++;throw new Error('unexpected request');});
  const result=await api.writeScript({text:'让他难受',roomId:'bedroom',present:['YOU','A'],names:{}},{requestId:'offline-123'});
  assert.equal(fetches,0);
  assert.equal(result.source,'offline');
  assert.equal(result.turnId,null);
  assert.ok(result.beats.length>0);
  assert.equal(settleOffline(defaults(),result,'让他难受').nights,1);
});
