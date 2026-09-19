import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { Agent } from '@earendil-works/pi-agent-core';
import { AssistantMessageEventStream } from '@earendil-works/pi-ai';
import { SceneBudget } from '../server/agents/budget.js';
import { createGatewayProvider } from '../server/agents/provider.js';
import { createGameTools } from '../server/agents/game-tools.js';
import { GameRoleAgent, roleContext } from '../server/agents/role-agent.js';
import { composeScene } from '../server/orchestrator.js';

const model = { id: 'test', name: 'test', provider: 'test', api: 'openai-completions',
  baseUrl: 'http://127.0.0.1', input: ['text'], reasoning: false, contextWindow: 32768, maxTokens: 768,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const usage = { input: 40, output: 40, cacheRead: 0, cacheWrite: 0, totalTokens: 80,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const input = { text: 'PRIVATE_PLAYER_CANARY', roomId: 'bedroom', present: ['YOU', 'A', 'B'],
  names: { A: '阿甲', B: '阿乙' }, nights: 2, doubt: 0,
  ambient: { weather: 'clear', light: 'on' }, confirmedFacts: ['PRIVATE_FACT_CANARY'],
  dollMemory: ['PRIVATE_MEMORY_CANARY'], memories: { A: ['A_ONLY_MEMORY'], B: ['B_ONLY_MEMORY'] }, environmentEvents: [] };

function fakeProvider(role, records, handler, delay = 0) {
  let calls = 0;
  return { model, stream: (_model, context, options) => {
    calls += 1;
    records.push({ role, context: JSON.parse(JSON.stringify(context)), options });
    const stream = new AssistantMessageEventStream();
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      options.signal?.removeEventListener('abort', abort);
      const config = handler?.({ role, context, calls }) ?? {};
      const args = config.args ?? (role === 'doll'
        ? { you: { line: '请你把话说清楚。', to: 'A' }, nudge: { target: 'lamp', verb: 'flicker' } }
        : role === 'ENV' ? { reactions: [{ target: 'lamp', text: '台灯闪了一下。' }], ambient: { light: 'dim' } }
          : { line: `${role}的第${calls}句`, ...(role === 'A' ? { to: 'B' } : {}) });
      const message = { role: 'assistant', model: model.id, api: model.api, provider: model.provider,
        content: config.error ? [] : (config.content || [{ type: 'toolCall', id: `${role}-${calls}`, name: config.tool || 'perform', arguments: args }]),
        timestamp: Date.now(), usage, stopReason: config.error ? 'error' : 'toolUse', ...(config.error ? { errorMessage: 'upstream secret failure' } : {}) };
      if (config.error) stream.push({ type: 'error', reason: 'error', error: message });
      else { stream.push({ type: 'start', partial: message }); stream.push({ type: 'done', reason: 'toolUse', message }); }
      stream.end(message);
    };
    const abort = () => {
      if (done) return;
      done = true; clearTimeout(timer);
      const message = { role: 'assistant', content: [], model: model.id, api: model.api, provider: model.provider,
        usage, timestamp: Date.now(), stopReason: 'aborted', errorMessage: 'aborted' };
      stream.push({ type: 'error', reason: 'aborted', error: message }); stream.end(message);
    };
    const timer = setTimeout(end, delay);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    return stream;
  } };
}

test('Pi Agent defaults have no coding tools; role contexts isolate private story and individual memory', () => {
  const agent = new Agent({ initialState: { model }, streamFn: () => new AssistantMessageEventStream() });
  assert.deepEqual(agent.state.tools, []);
  const a = JSON.stringify(roleContext('A', input));
  const b = JSON.stringify(roleContext('B', input));
  const env = JSON.stringify(roleContext('ENV', input));
  assert(a.includes('A_ONLY_MEMORY')); assert(!a.includes('B_ONLY_MEMORY'));
  assert(b.includes('B_ONLY_MEMORY')); assert(!b.includes('A_ONLY_MEMORY'));
  for (const body of [a, b, env]) assert(!body.includes('PRIVATE_'));
  assert(JSON.stringify(roleContext('doll', input)).includes('PRIVATE_PLAYER_CANARY'));
});

test('Pi game tools reject actor/environment authority and only return proposals', async () => {
  let proposal;
  const tools = createGameTools({ role: 'ENV', input, setProposal: (p) => { proposal = p; }, enqueue: () => {} });
  assert.deepEqual(tools.map(t => t.name), ['perform', 'inspect_object']);
  await tools[0].execute('id', { reactions: [{ text: '<script>bad</script>', target: 'not-there' }],
    ambient: { weather: 'fire', light: 'off' }, move: { role: 'A' } });
  assert.deepEqual(proposal, { reactions: [], ambient: { light: 'off' } });
  let actor;
  const aTools = createGameTools({ role: 'A', input, setProposal: p => { actor = p; }, enqueue: () => {} });
  await aTools[0].execute('a', { line: '听见了。', use: { target: 'phone', verb: 'check' }, spot: 'stove' });
  assert.deepEqual(actor, { line: '听见了。' });
});

test('real Pi tools execute, results reach the next request, and requests count at provider boundary', async () => {
  const records = [];
  const budget = new SceneBudget();
  let proposal;
  const provider = fakeProvider('A', records, ({ calls }) => calls === 1
    ? { tool: 'inspect_object', args: { target: 'door' } } : { args: { line: '门就在这儿。', use: { target: 'door', verb: 'slam' } } });
  const agent = new GameRoleAgent({ role: 'A', input, provider, budget, onProposal: (_r,p) => { proposal=p; } });
  await agent.act({ observations: [] }, new AbortController().signal);
  assert.equal(records.length, 2);
  assert(records[1].context.messages.some(m => m.role === 'toolResult' && m.toolName === 'inspect_object'));
  assert.equal(proposal.use.verb, 'slam');
  assert.equal(budget.snapshot().requests, 2);
  assert.equal(budget.snapshot().outputTokens, 80);
  assert(records.every(r => r.options.maxRetries === 0 && r.options.maxTokens <= 768));
  await agent.close();
});

test('Team is in scene path: directed dialogue, nudge, env feedback, and no raw private input in NPC requests', async () => {
  const records = [];
  let metrics;
  const providers = new Map();
  const script = await composeScene(input, {
    runtime: { providerForRole: role => {
      if (!providers.has(role)) providers.set(role, fakeProvider(role, records));
      return providers.get(role);
    } }, onMetrics: m => { metrics=m; },
  });
  assert.equal(script.source, 'model');
  assert(script.beats.some(b => b.action === 'use' && b.role === 'doll' && b.verb === 'flicker'));
  assert(script.beats.some(b => b.role === 'ENV' && b.action === 'speak'));
  assert(metrics.directedMessages >= 2);
  assert(metrics.requests <= 8);
  assert.equal(metrics.runtime, 'pi');
  for (const r of records.filter(r => r.role !== 'doll')) assert(!JSON.stringify(r.context).includes('PRIVATE_'));
  assert(records.filter(r => r.role === 'B').some(r => JSON.stringify(r.context).includes('A的第1句')));
  assert(!JSON.stringify(records.filter(r => r.role === 'A')).includes('B_ONLY_MEMORY'));
});

test('one NPC failing preserves successful roles and uses role-local fallback', async () => {
  const records = [];
  let metrics;
  const script = await composeScene(input, { runtime: {
    providerForRole: role => fakeProvider(role, records, () => role === 'A' ? { error: true } : undefined),
  }, onMetrics: m => { metrics=m; } });
  assert(script.beats.some(b => b.role === 'B' && b.text?.startsWith('B的第')));
  assert(script.beats.some(b => b.role === 'A' && b.text === '我一时不知道该怎么接。'));
  assert.equal(script.source, 'mixed');
  assert(metrics.modelRoles.includes('B')); assert(metrics.localRoles.includes('A'));
  assert.equal(metrics.allRolesModel, false);
});

test('request/output/concurrency reservations and daily gate bound all model loops', async () => {
  const records = []; let consumed=0, metrics;
  const script = await composeScene({ ...input, present: ['YOU','A','B','C'] }, {
    budget: { maxRequests: 3, maxOutputTokens: 1536, maxConcurrent: 2, reserveRequest: () => ++consumed <= 2 },
    runtime: { providerForRole: role => fakeProvider(role, records, undefined, 4) },
    onMetrics: m => { metrics=m; },
  });
  assert(script.beats.length > 0);
  assert(records.length <= 2);
  assert(metrics.requests <= 3);
  assert(metrics.reservedOutput <= 1536);
  assert(metrics.peakConcurrent <= 2);
});

test('external cancellation aborts instead of returning a script or retaining proposals', async () => {
  const records = []; const controller = new AbortController(); let metrics;
  const pending = composeScene(input, { signal: controller.signal,
    runtime: { providerForRole: role => fakeProvider(role, records, undefined, 300) }, onMetrics: m => { metrics=m; } });
  setTimeout(() => controller.abort(), 15);
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(metrics.inFlight, 0);
  assert.equal(records.length, 1);
});

test('deadline retains playable local results and releases active slots', async () => {
  const records = []; let metrics;
  const script = await composeScene(input, { budget: { deadlineMs: 20, requestTimeoutMs: 20 },
    runtime: { providerForRole: role => fakeProvider(role, records, undefined, 300) }, onMetrics: m => { metrics=m; } });
  assert(script.beats.length > 0); assert.equal(metrics.inFlight, 0);
});

test('Pi AI OpenAI protocol uses actual tool calls and results against a local SSE server', async (t) => {
  const requests=[];
  const server=http.createServer(async (req,res)=> {
    let body=''; for await(const chunk of req) body+=chunk;
    const data=JSON.parse(body); requests.push(data);
    assert.equal(req.url,'/v1/chat/completions');
    const first=requests.length===1;
    const name=first?'inspect_object':'perform';
    const args=first?{target:'door'}:{line:'你先把门关上。'};
    res.writeHead(200,{'content-type':'text/event-stream'});
    res.write(`data: ${JSON.stringify({id:'mock',object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:`tool${requests.length}`,type:'function',function:{name,arguments:JSON.stringify(args)}}]},finish_reason:null}]})}\n\n`);
    res.write(`data: ${JSON.stringify({id:'mock',object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:'tool_calls'}],usage:{prompt_tokens:20,completion_tokens:20,total_tokens:40}})}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(()=> { server.closeAllConnections(); server.close(); });
  const provider=createGatewayProvider({MODEL_BASE_URL:`http://127.0.0.1:${server.address().port}`,MODEL_NAME:'mock',MODEL_API_KEY:'mock-only'});
  const budget=new SceneBudget(); let proposal;
  const agent=new GameRoleAgent({role:'A',input,provider,budget,onProposal:(_r,p)=>{proposal=p;}});
  await agent.act({observations:[]},new AbortController().signal);
  await agent.close();
  assert.equal(requests.length,2);
  assert(requests[1].messages.some(m=>m.role==='tool'));
  assert.equal(proposal.line,'你先把门关上。');
  assert(!requests[0].tools.some(t=>['bash','read','write','edit'].includes(t.function.name)));
});

test('NPC send_message uses Team private mailbox without entering other roles or environment', async () => {
  const records=[]; const providers=new Map();
  await composeScene({...input,present:['YOU','A','B','C']}, {runtime:{providerForRole:role=>{
    if(!providers.has(role)) providers.set(role,fakeProvider(role,records,({calls})=>
      role==='A' && calls===1 ? {tool:'send_message',args:{to:'B',text:'NPC_PRIVATE_CANARY'}} : undefined));
    return providers.get(role);
  }}});
  assert(records.filter(r=>r.role==='B').some(r=>JSON.stringify(r.context).includes('NPC_PRIVATE_CANARY')));
  for(const r of records.filter(r=>['C','ENV','doll'].includes(r.role))) assert(!JSON.stringify(r.context).includes('NPC_PRIVATE_CANARY'));
});

test('provider daily gate prevents the actual network call, including when no role can generate', async () => {
  const records=[]; let metrics;
  const script=await composeScene(input,{budget:{reserveRequest:()=>false},
    runtime:{providerForRole:role=>fakeProvider(role,records)},onMetrics:m=>{metrics=m;}});
  assert.equal(records.length,0); assert.equal(metrics.requests,0);
  assert.equal(script.source,'local'); assert(script.beats.length>0);
});

test('malformed streamed response never executes unknown tools and remains playable', async () => {
  const records=[];
  const script=await composeScene(input,{runtime:{providerForRole:role=>fakeProvider(role,records,
    ()=>({tool:'bash',args:{command:'never-execute'}}))}});
  assert.equal(script.source,'local');
  assert(script.beats.length>0);
  assert(records.every(r=>r.context.tools.every(t=>!['bash','write','read','edit'].includes(t.name))));
});

test('Pi AI Anthropic protocol emits game tools at the configured gateway', async (t)=>{
  let captured;
  const server=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    captured={path:req.url,body:JSON.parse(body)};
    res.writeHead(200,{'content-type':'text/event-stream'});
    const emit=(event,data)=>res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    emit('message_start',{type:'message_start',message:{id:'m',type:'message',role:'assistant',model:'mock',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:20,output_tokens:1}}});
    emit('content_block_start',{type:'content_block_start',index:0,content_block:{type:'tool_use',id:'t',name:'perform',input:{}}});
    emit('content_block_delta',{type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:'{"line":"我听见了。"}'}});
    emit('content_block_stop',{type:'content_block_stop',index:0});
    emit('message_delta',{type:'message_delta',delta:{stop_reason:'tool_use',stop_sequence:null},usage:{output_tokens:20}});
    emit('message_stop',{type:'message_stop'});res.end();
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{server.closeAllConnections();server.close();});
  const provider=createGatewayProvider({MODEL_BASE_URL:`http://127.0.0.1:${server.address().port}`,MODEL_NAME:'mock',MODEL_API_STYLE:'anthropic',MODEL_API_KEY:'mock-only'});
  let proposal;const agent=new GameRoleAgent({role:'A',input,provider,budget:new SceneBudget(),onProposal:(_r,p)=>{proposal=p;}});
  await agent.act({observations:[]},new AbortController().signal);await agent.close();
  assert(captured.path.startsWith('/v1/messages'));assert.equal(proposal.line,'我听见了。');
  assert(captured.body.tools.some(t=>t.name==='perform'));
});

test('perform ends a mixed tool batch without later messages, duplicate actions, or another model request', async () => {
  const records=[];let proposal;
  const provider=fakeProvider('A',records,({calls})=>calls===1?{content:[
    {type:'toolCall',id:'first',name:'inspect_object',arguments:{target:'door'}},
    {type:'toolCall',id:'submit',name:'perform',arguments:{line:'这一句就够了。'}},
    {type:'toolCall',id:'after-submit',name:'send_message',arguments:{to:'B',text:'MUST_NOT_SEND'}},
    {type:'toolCall',id:'duplicate',name:'perform',arguments:{line:'不应该覆盖。'}},
  ]}:{error:true});
  const agent=new GameRoleAgent({role:'A',input,provider,budget:new SceneBudget(),onProposal:(_r,p)=>{proposal=p;}});
  const commands=await agent.act({observations:[]},new AbortController().signal);
  assert.equal(records.length,1);assert.equal(proposal.line,'这一句就够了。');
  assert(!commands.some(c=>c.type==='send'));await agent.close();
});

test('HF22 default NPC wave is parallel; explicit sequential mode gives preceding public dialogue', async()=>{
  for(const mode of ['parallel','sequential']) {
    const records=[];let metrics;
    await composeScene(input,{runtime:{mode,providerForRole:role=>fakeProvider(role,records,undefined,5)},onMetrics:m=>{metrics=m;}});
    assert.equal(metrics.mode,mode);
    if(mode==='parallel') assert(metrics.peakConcurrent>=2);
    else {
      assert.equal(metrics.peakConcurrent,1);
      const firstNpcRequests=records.filter(r=>['A','B'].includes(r.role)).slice(0,2);
      const earlier=firstNpcRequests[0].role;
      assert(JSON.stringify(firstNpcRequests[1].context).includes(`${earlier}的第1句`));
    }
  }
});

test('a model with no environmental reaction is honestly marked mixed when local feedback is used', async()=>{
  const records=[];let metrics;
  const script=await composeScene(input,{runtime:{providerForRole:role=>fakeProvider(role,records,
    ()=>role==='ENV'?{args:{reactions:[],ambient:{light:'dim'}}}:undefined)},onMetrics:m=>{metrics=m;}});
  assert.equal(script.source,'mixed');assert(metrics.localRoles.includes('ENV'));assert.equal(metrics.allRolesModel,false);
});
