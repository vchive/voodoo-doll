// 显式运行此脚本才访问配置的真实模型；仅发送内置虚构测试文本，不读取玩家档案。
// node --env-file=.env scripts/check-pi.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GameStore } from '../server/state/game-store.js';
import { composeScene } from '../server/orchestrator.js';
import { modelConfigured } from '../server/model.js';
import { RateLimiter } from '../server/rate-limit.js';

if(!modelConfigured())throw new Error('模型未配置；请使用服务端环境变量。');
const dir=mkdtempSync(path.join(tmpdir(),'hex-pi-check-'));
const filename=path.join(dir,'world.sqlite');
let store=new GameStore({filename});
const limiter=new RateLimiter({dailyLimit:24});
const report={runtime:'pi',fictionalFixture:true,rounds:[],confirmedNights:0,restartRestored:false};
try {
  const {token}=store.openSession();
  store.configure(token,{dollName:'小夜',names:{A:'甲先生',B:'乙女士'},stage:{roomId:'bedroom',present:['YOU','A','B']},confirmedFacts:['虚构排练。所有人物均为成年人。甲先生答应来参加晚餐，后来没有出现。']});
  const prompts=['让A在B面前把晚餐的事情说清楚。','让B回应A刚才的说法。','今晚先算了，让他们安静下来。'];
  for (let i=0;i<prompts.length;i++) {
    const before=store.get(token);
    const turn=store.begin(token,{requestId:'pi-check-'+i,input:{text:prompts[i],version:before.version}});
    let metrics;const started=Date.now();
    const script=await composeScene(turn.input,{budget:{reserveRequest:()=>limiter.consumeModelRequest()},onMetrics:m=>{metrics=m;}});
    const proposal=store.propose(token,turn.turnId,script);
    assert(proposal.script.beats.length>0);
    const after=store.confirm(token,turn.turnId);
    assert.equal(after.state.nights,i+1);
    assert.equal(store.confirm(token,turn.turnId).state.nights,i+1);
    report.rounds.push({round:i+1,source:script.source,elapsedMs:Date.now()-started,beats:script.beats.length,roles:[...new Set(script.beats.map(b=>b.role))],metrics});
    if(i===1){store.close();store=new GameStore({filename});report.restartRestored=store.get(token).state.nights===2;assert(report.restartRestored);}
  }
  report.confirmedNights=store.get(token).state.nights;
  report.modelRequests=limiter.stats().usedToday;
  report.ok=report.rounds.every(r=>['model','mixed'].includes(r.source)&&r.metrics.requests>0&&r.metrics.failures===0);
  report.allRolesModel=report.rounds.every(r=>r.metrics.failedRoles.length===0);
  console.log(JSON.stringify(report,null,2));
  if(!report.ok)process.exitCode=1;
} catch(error) {
  console.log(JSON.stringify({...report,ok:false,error:{name:error.name,code:error.code||'verification-failed'}},null,2));
  process.exitCode=1;
} finally {store.close();rmSync(dir,{recursive:true,force:true});}
