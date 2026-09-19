// 同源 H5 + 匿名世界 + 可取消的 Pi 剧本草稿。
import http from 'node:http';
import { stat, realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRequest, validateScript, CONTRACT_VERSION } from '../shared/script-contract.js';
import { modelConfigured, extractNames } from './model.js';
import { composeScene } from './orchestrator.js';
import { localScript } from './local-station.js';
import { RateLimiter } from './rate-limit.js';
import { GameStore } from './state/game-store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2'};
const COOKIE = 'hex_session';

function json(res, status, body) {
  if (res.destroyed || res.writableEnded) return;
  const data = JSON.stringify(body);
  res.writeHead(status, {'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(data),'cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(data);
}
function cookieToken(req) {
  return (req.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
}
function setCookie(req,res,token) {
  res.setHeader('set-cookie',COOKIE+'='+token+'; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000'+(req.socket.encrypted ? '; Secure' : ''));
}
function requireToken(req) {
  const token = cookieToken(req);
  if (!token) throw Object.assign(new Error('session-required'),{status:401,code:'session-required'});
  return token;
}
async function readBody(req, limitBytes=48*1024) {
  let size=0;
  const parts=[];
  for await (const part of req) {
    size+=part.length;
    if (size>limitBytes) throw Object.assign(new Error('body-too-large'),{status:413,code:'body-too-large'});
    parts.push(part);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('bad-json'),{status:400,code:'bad-json'}); }
}
function checkOrigin(req) {
  if (req.headers['sec-fetch-site']==='cross-site') return false;
  if (!req.headers.origin) return true;
  try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; }
}

export function createGameServer({
  store = new GameStore({filename:process.env.DATA_FILE || path.join(ROOT,'data','worlds.sqlite')}),
  dist = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT,'dist-hex'),
  compose = composeScene, configured = modelConfigured, extract = extractNames,
  limiter = new RateLimiter({dailyLimit:Number(process.env.MODEL_DAILY_LIMIT)||300,usageFile:path.join(ROOT,'data','model-budget.json')}),
}={}) {
  const active = new Map();
  function stop(token, turnId) {
    const current=active.get(token);
    if (current && (!turnId || current.turnId===turnId)) {
      current.controller.abort(new DOMException('Cancelled','AbortError'));
      active.delete(token);
    }
  }
  async function serveStatic(req,res,urlPath) {
    let decoded;
    try { decoded=decodeURIComponent(urlPath); } catch { return json(res,400,{ok:false,reason:'bad-path'}); }
    const rel=decoded==='/' ? 'index.html' : decoded.replace(/^\/+/, '');
    if (rel.split(/[\\/]/).some(part=>part.startsWith('.')) || /\.(map|sqlite|env)$/.test(rel)) return json(res,404,{ok:false});
    const target=path.resolve(dist,rel);
    if (!target.startsWith(dist+path.sep)) return json(res,403,{ok:false});
    let info, resolved;
    try { [info,resolved]=await Promise.all([stat(target),realpath(target)]); } catch { return json(res,404,{ok:false}); }
    const realRoot=await realpath(dist);
    if (!info.isFile() || !resolved.startsWith(realRoot+path.sep)) return json(res,404,{ok:false});
    const immutable=/^assets\/.+-[\w-]+\.[a-z0-9]+$/.test(rel);
    res.writeHead(200,{'content-type':MIME[path.extname(target)]||'application/octet-stream','content-length':info.size,'cache-control':immutable?'public, max-age=31536000, immutable':'no-cache','x-content-type-options':'nosniff'});
    if (req.method==='HEAD') return res.end();
    createReadStream(target).on('error',()=>res.destroy()).pipe(res);
  }

  const server=http.createServer(async(req,res)=>{
    try {
      const pathname=new URL(req.url || '/', 'http://localhost').pathname;
      const ip=req.socket.remoteAddress || 'unknown';
      if (pathname==='/healthz') return json(res,200,{ok:true,contract:CONTRACT_VERSION,model:configured()?'configured':'not-configured',runtime:'pi',storage:'sqlite'});
      if (!pathname.startsWith('/api/')) {
        if (!['GET','HEAD'].includes(req.method)) return json(res,405,{ok:false});
        return await serveStatic(req,res,pathname);
      }
      if (pathname==='/api/session' && req.method==='GET') return json(res,200,{ok:true,snapshot:store.get(requireToken(req))});
      if (req.method!=='POST') return json(res,405,{ok:false,reason:'method-not-allowed'});
      if (!checkOrigin(req)) return json(res,403,{ok:false,reason:'cross-origin'});
      if (!String(req.headers['content-type']||'').startsWith('application/json')) return json(res,415,{ok:false,reason:'json-required'});
      const body=await readBody(req);
      if (!body || typeof body!=='object' || Array.isArray(body)) return json(res,400,{ok:false,reason:'invalid-input'});

      if (pathname==='/api/session') {
        // 玩家明确选择保留本机进度时创建新世界，旧世界不删除。
        const oldToken=cookieToken(req);
        if (body.forkLocal && oldToken) { store.get(oldToken); stop(oldToken); }
        const session=store.openSession(body.forkLocal ? undefined : oldToken,{legacy:body.legacy});
        setCookie(req,res,session.token);
        return json(res,200,{ok:true,snapshot:session.snapshot});
      }
      const token=requireToken(req);
      store.get(token); // worldId从不充当凭证。
      if (pathname==='/api/profile') {
        if (!Number.isSafeInteger(body.version) || body.version<0) return json(res,400,{ok:false,reason:'version-required'});
        const snapshot=store.configure(token,body.profile || {},body.version);
        stop(token);
        return json(res,200,{ok:true,snapshot});
      }
      if (pathname==='/api/cancel') {
        const running=active.get(token);
        const matching=running && (!body.requestId || running.requestId===body.requestId);
        const turnId=body.turnId || (matching ? running.turnId : undefined);
        if (turnId) {
          stop(token,turnId);
          return json(res,200,{ok:true,snapshot:store.cancel(token,turnId)});
        }
        return json(res,200,{ok:true,snapshot:store.get(token)});
      }
      if (pathname==='/api/confirm') {
        const snapshot=store.confirm(token,body.turnId);
        stop(token,body.turnId);
        return json(res,200,{ok:true,snapshot});
      }
      if (pathname==='/api/extract-names') {
        const story=typeof body.story==='string' ? body.story.slice(0,600) : '';
        if (!story.trim()) return json(res,400,{ok:false});
        const gate=limiter.check(ip);
        if (!gate.allowed || !configured() || !limiter.consumeModelRequest().allowed) return json(res,200,{ok:true,source:'local',names:{}});
        try { return json(res,200,{ok:true,source:'model',names:await extract(story)}); }
        catch { return json(res,200,{ok:true,source:'local',names:{}}); }
      }
      if (pathname!=='/api/write') return json(res,404,{ok:false});

      const input=validateRequest(body);
      if (!input) return json(res,400,{ok:false,reason:'invalid-input'});
      if (!Number.isSafeInteger(body.version) || body.version<0) return json(res,400,{ok:false,reason:'version-required'});
      input.version=body.version;
      if (body.requestId && active.get(token)?.requestId===body.requestId) return json(res,409,{ok:false,reason:'request-in-progress'});
      const gate=limiter.check(ip);
      const prepared=store.begin(token,{requestId:body.requestId,input});
      stop(token);
      const controller=new AbortController();
      active.set(token,{controller,turnId:prepared.turnId,requestId:body.requestId});
      const disconnected=()=>{
        if (!res.writableEnded) {
          stop(token,prepared.turnId);
          try { store.cancel(token,prepared.turnId); } catch {}
        }
      };
      res.once('close',disconnected);
      const started=Date.now();
      let script,reason,metrics,retainDraft=false;
      try {
        if (configured() && gate.allowed) {
          try {
            const raw=await compose(prepared.input,{signal:controller.signal,budget:{reserveRequest:()=>limiter.consumeModelRequest()},onMetrics:value=>{metrics=value;}});
            script=validateScript(raw,{roomId:prepared.input.roomId,present:prepared.input.present});
            if (!script) reason='invalid-model-output';
          } catch (error) {
            if (controller.signal.aborted) throw error;
            reason=error?.name==='AbortError' ? 'timeout' : 'model-error';
          }
        } else reason=gate.allowed ? 'model-not-configured' : gate.reason;
        if (controller.signal.aborted) throw new DOMException('Cancelled','AbortError');
        script ||= validateScript(localScript(prepared.input),{roomId:prepared.input.roomId,present:prepared.input.present});
        if (!script) throw Object.assign(new Error('local-script-invalid'),{status:500});
        if (script.ask && !script.ack) {
          const snapshot=store.cancel(token,prepared.turnId);
          return json(res,200,{ok:true,script,reason,snapshot,elapsed:Date.now()-started});
        }
        const draft=store.propose(token,prepared.turnId,script);
        retainDraft=true;
        const cleanup=setTimeout(()=>{
          if (active.get(token)?.turnId===prepared.turnId) {
            stop(token,prepared.turnId);
            try { store.cancel(token,prepared.turnId); } catch {}
          }
        },Math.max(1,draft.expiresAt-Date.now()));
        cleanup.unref();
        return json(res,200,{ok:true,...draft,reason,source:script.source,elapsed:Date.now()-started,metrics});
      } catch (error) {
        try { store.cancel(token,prepared.turnId); } catch {}
        if (controller.signal.aborted) return json(res,409,{ok:false,reason:'cancelled'});
        throw error;
      } finally {
        if (!retainDraft && active.get(token)?.turnId===prepared.turnId) active.delete(token);
        res.removeListener('close',disconnected);
      }
    } catch (error) {
      const status=Number(error?.status || error?.statusCode)||500;
      if (status===401) res.setHeader('set-cookie',COOKIE+'=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
      // 不返回或记录上游响应、玩家文本、密钥。
      json(res,status,{ok:false,reason:typeof error?.code==='string' ? error.code : 'request-failed'});
    }
  });
  server.on('close',()=>{for (const token of active.keys()) stop(token); store.close();});
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const server=createGameServer();
  const port=Number(process.env.PORT)||8080;
  server.listen(port,()=>console.log('巫柜夜场 http://localhost:'+port+' · Pi · '+(modelConfigured()?'模型已配置':'本地剧本')));
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>server.close(()=>process.exit(0)));
}
