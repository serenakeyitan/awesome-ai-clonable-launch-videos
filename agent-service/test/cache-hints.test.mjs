import test from 'node:test';
import assert from 'node:assert/strict';
import {Client,StreamableHTTPClientTransport,InMemoryResponseCacheStore} from '@modelcontextprotocol/client';
import worker from '../worker.mjs';

const env={CLERK_AUTH_ENABLED:'false',ARCHIVE_REQUEST_LIMITER:{limit:async()=>({success:true})}};
function harness() {
  const seen=[];
  const fetch=async(url,init={})=>{
    const headers=new Headers(new Request(url,init).headers); headers.set('Host','serenatan.org');
    let method='-'; try { method=JSON.parse(String(init.body)).method; } catch {}
    const response=await worker.fetch(new Request(url,{method:init.method,headers,body:init.body}),env,{waitUntil(){}});
    seen.push({method,body:await response.clone().text()});
    return response;
  };
  return {seen,transport:()=>new StreamableHTTPClientTransport(new URL('https://serenatan.org/launchvideo/mcp'),{fetch})};
}

test('2026-era discover and tools/list are cacheable so clients stop re-listing tools on every use', async () => {
  const {seen,transport}=harness();
  const responseCacheStore=new InMemoryResponseCacheStore();
  for (let refresh=0; refresh<3; refresh++) {
    const client=new Client({name:'cache-test',version:'1'},{versionNegotiation:{mode:'auto'},responseCacheStore});
    await client.connect(transport());
    assert.equal((await client.listTools()).tools.length,4);
    await client.close();
  }
  const lists=seen.filter(r=>r.method==='tools/list');
  assert.equal(lists.length,1,'tools/list should be served from the client cache after the first refresh');
  for (const r of seen.filter(r=>['tools/list','server/discover'].includes(r.method))) {
    assert.match(r.body,/"ttlMs":3600000/);
    assert.match(r.body,/"cacheScope":"private"/);
  }
});

test('2025-era clients keep the legacy handshake with no cache fields', async () => {
  const {seen,transport}=harness();
  const client=new Client({name:'legacy-test',version:'1'});
  await client.connect(transport());
  assert.equal((await client.listTools()).tools.length,4);
  await client.close();
  assert.equal(seen[0].method,'initialize');
  assert.doesNotMatch(seen.find(r=>r.method==='tools/list').body,/ttlMs/);
});
