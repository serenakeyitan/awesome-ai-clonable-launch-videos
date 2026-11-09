import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import worker from '../worker.mjs';
import {guardRequest, MAX_MCP_BODY_BYTES} from '../request-guard.mjs';

const origin = 'https://serenatan.org';
const allow = {ARCHIVE_REQUEST_LIMITER:{limit:async () => ({success:true})}};
const request = (path='/launchvideo/mcp', init={}) => new Request(origin+path, {...init,headers:{Host:'serenatan.org',...Object.fromEntries(new Headers(init.headers))}});

test('the shared guard blocks MCP and agent HTTP routes before either can load upstream data', async () => {
  const keys = [];
  const env = {ARCHIVE_REQUEST_LIMITER:{limit:async ({key}) => {keys.push(key); return {success:false};}}};
  for (const [path, method] of [
    ['/launchvideo/mcp?client=a','POST'], ['/launchvideo/mcp?client=b','GET'],
    ['/launchvideo/agent/catalog.json','GET'], ['/launchvideo/agent/manifest.json','HEAD'],
    ['/launchvideo/agent/workflow.md','GET'], ['/launchvideo/agent/SKILL.md','OPTIONS']
  ]) {
    const r = await worker.fetch(request(path,{method,headers:{'CF-Connecting-IP':'192.0.2.10','X-Forwarded-For':crypto.randomUUID(),Authorization:`Bearer ${crypto.randomUUID()}`}}),env,{});
    assert.equal(r.status,429);
    assert.equal(r.headers.get('retry-after'),'60');
    assert.equal(r.headers.get('access-control-allow-origin'),'*');
    assert.match(r.headers.get('access-control-expose-headers'),/Retry-After/);
    assert.equal(r.headers.get('cache-control'),'no-store');
  }
  assert.equal(new Set(keys).size,1);
  assert.equal(keys[0],'launch-archive:192.0.2.10');
});

test('different ingress IPs get separate keys; missing IP does not bypass protection', async () => {
  const keys=[];
  const env={ARCHIVE_REQUEST_LIMITER:{limit:async ({key})=>{keys.push(key);return {success:true};}}};
  for (const ip of ['192.0.2.1','192.0.2.2',null,null]) {
    const headers = ip ? {'CF-Connecting-IP':ip} : {};
    assert.equal((await worker.fetch(request('/launchvideo/agent/SKILL.md',{headers}),env,{})).status,200);
  }
  assert.notEqual(keys[0],keys[1]);
  assert.equal(keys[2],keys[3]);
  assert.equal(keys[2],'launch-archive:unknown');
});

test('normal requests, MCP preflights and copied setup remain available', async () => {
  const body=JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'guard-test',version:'1.0'}}});
  const req=request(undefined,{method:'POST',body,headers:{'Content-Type':'application/json','Content-Length':String(Buffer.byteLength(body))}});
  const guarded=await guardRequest(req,allow);
  assert.equal(await guarded.request.text(),body);
  assert.equal(guarded.request.headers.get('Content-Type'),'application/json');
  assert.equal((await worker.fetch(request(undefined,{method:'OPTIONS'}),allow,{})).status,200);
  const bootstrap=await worker.fetch(request('/launchvideo/agent/SKILL.md'),allow,{});
  assert.equal(bootstrap.status,200);
  assert.match(await bootstrap.text(),/Before each launch-video task, call get_launch_context and follow the workflow it returns/);
});

test('oversized bodies are rejected by both declared length and actual streamed bytes', async () => {
  const declared=request(undefined,{method:'POST',body:'{}',headers:{'Content-Length':String(MAX_MCP_BODY_BYTES+1)}});
  assert.equal((await guardRequest(declared,allow)).response.status,413);
  let cancelled=false;
  const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(MAX_MCP_BODY_BYTES));c.enqueue(new Uint8Array(1));},cancel(){cancelled=true;}});
  const streamed=request(undefined,{method:'POST',body:stream,duplex:'half',headers:{'Content-Length':'2'}});
  assert.equal((await guardRequest(streamed,allow)).response.status,413);
  assert.equal(cancelled,true);
  const boundary=request(undefined,{method:'POST',body:new Uint8Array(MAX_MCP_BODY_BYTES)});
  assert.equal((await (await guardRequest(boundary,allow)).request.arrayBuffer()).byteLength,MAX_MCP_BODY_BYTES);
});

test('a broken or missing protection binding fails closed with a retryable response', async () => {
  for(const env of [{},{ARCHIVE_REQUEST_LIMITER:{limit:async()=>{throw new Error('private diagnostics');}}}]) {
    const r=await worker.fetch(request('/launchvideo/agent/catalog.json'),env,{});
    assert.equal(r.status,503);assert.equal(r.headers.get('retry-after'),'10');
    assert.doesNotMatch(await r.text(),/private diagnostics/);
  }
});

test('deployment config binds the intended per-IP short-term allowance', async () => {
  const config=JSON.parse(await readFile(new URL('../wrangler.json',import.meta.url),'utf8'));
  const binding=config.ratelimits.find(b=>b.name==='ARCHIVE_REQUEST_LIMITER');
  assert.deepEqual(binding.simple,{limit:120,period:60});
  assert.equal(config.name,'serenatan-launchvideo-agent');
  assert.equal(config.vars.CLERK_AUTH_ENABLED,'true');
});
