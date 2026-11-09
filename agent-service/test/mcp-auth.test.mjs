import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, createSign} from 'node:crypto';
import {createClerkClient} from '@clerk/backend';
import worker from '../worker.mjs';
import {authorizeMcp, MCP_RESOURCE, protectedResourceMetadata} from '../mcp-auth.mjs';

const env = {CLERK_AUTH_ENABLED:'true', CLERK_SECRET_KEY:'sk_test_fixture',
  CLERK_PUBLISHABLE_KEY:'pk_test_' + Buffer.from('fixture.clerk.accounts.dev$').toString('base64'),
  CLERK_ISSUER:'https://fixture.clerk.accounts.dev'};
const request = token => new Request(MCP_RESOURCE, {headers:token ? {Authorization:`Bearer ${token}`} : {}});
const client = auth => () => ({authenticateRequest:async (req, options) => {
  assert.equal(options.acceptsToken, 'oauth_token');
  assert.equal(options.audience, MCP_RESOURCE);
  return {isAuthenticated:true,toAuth:()=>auth};
}});

test('anonymous requests receive OAuth discovery; incomplete enabled configuration fails closed', async () => {
  const r=(await authorizeMcp(request(), env)).response;
  assert.equal(r.status,401);assert.match(r.headers.get('WWW-Authenticate'),/oauth-protected-resource\/launchvideo\/mcp/);
  assert.match(r.headers.get('Access-Control-Expose-Headers'),/WWW-Authenticate/);
  assert.equal((await authorizeMcp(request('token'),{CLERK_AUTH_ENABLED:'true'})).response.status,503);
  assert.deepEqual(await authorizeMcp(request(),{}),{});
});

test('verified OAuth identity requires both scopes and never exposes an email or token', async () => {
  const valid={tokenType:'oauth_token', userId:'user_fixture', clientId:'client_fixture',scopes:['profile','email']};
  const r=await authorizeMcp(request('fixture'),env,client(valid));
  assert.deepEqual(r,{identity:{userId:'user_fixture',clientId:'client_fixture'}});
  for (const bad of [{...valid,tokenType:'session_token'},{...valid,userId:null},{...valid,clientId:null}]) {
    assert.equal((await authorizeMcp(request('fixture'),env,client(bad))).response.status,401);
  }
  const missing=(await authorizeMcp(request('fixture'),env,client({...valid,scopes:['profile']}))).response;
  assert.equal(missing.status,403);assert.match(missing.headers.get('WWW-Authenticate'),/insufficient_scope/);
  const error=(await authorizeMcp(request('fixture'),env,()=>({authenticateRequest:async()=>{throw new Error('private data');}}))).response;
  assert.equal(error.status,401);assert.doesNotMatch(await error.text(),/private data/);
});

test('protected resource metadata is exact and public only when enabled', async () => {
  const r=protectedResourceMetadata(env);const data=await r.json();
  assert.equal(data.resource,MCP_RESOURCE);assert.deepEqual(data.authorization_servers,[env.CLERK_ISSUER]);
  assert.deepEqual(data.scopes_supported,['profile','email']);assert.equal(protectedResourceMetadata({}).status,404);
});

test('Worker enforces auth before MCP dispatch while preserving browser preflight and public setup', async () => {
  const configured={...env,ARCHIVE_REQUEST_LIMITER:{limit:async()=>({success:true})}};
  for(const method of ['GET','POST','DELETE']) {
    const r=await worker.fetch(new Request(MCP_RESOURCE,{method}),configured,{});
    assert.equal(r.status,401);assert.ok(r.headers.get('WWW-Authenticate'));
  }
  const preflight=await worker.fetch(new Request(MCP_RESOURCE,{method:'OPTIONS',headers:{Host:'serenatan.org',Origin:'https://chatgpt.com','Access-Control-Request-Method':'POST'}}),configured,{});
  assert.equal(preflight.status,200);
  const skill=await worker.fetch(new Request('https://serenatan.org/launchvideo/agent/SKILL.md'),configured,{});
  assert.equal(skill.status,200);
  const markdown=await skill.text();assert.match(skill.headers.get('Content-Type'),/^text\/markdown/);
  for (const method of ['GET','HEAD']) {
    const page=await worker.fetch(new Request('https://serenatan.org/launchvideo/agent/SKILL.md',{method,headers:{Accept:'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8'}}),configured,{});
    assert.equal(page.status,200);assert.match(page.headers.get('Content-Type'),/^text\/html/);assert.equal(page.headers.get('Vary'),'Accept');
    const html=await page.text();
    if(method==='GET'){
      assert.match(html,/<link rel="icon" type="image\/png" href="\/launchvideo\/mascot\/serena-popcorn.png">/);
      const source=html.match(/<pre class="skill-source">([\s\S]*?)<\/pre>/)[1].replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
      assert.equal(source,markdown);
    }else assert.equal(html,'');
  }
  for(const [suffix,accept] of [['?raw=1','text/html'],['','text/markdown'],['','text/html;q=0, text/markdown']]){
    const raw=await worker.fetch(new Request('https://serenatan.org/launchvideo/agent/SKILL.md'+suffix,{headers:{Accept:accept}}),configured,{});
    assert.match(raw.headers.get('Content-Type'),/^text\/markdown/);assert.equal(await raw.text(),markdown);
  }
  for (const method of ['GET','HEAD']) {
    const connect=await worker.fetch(new Request('https://serenatan.org/launchvideo/agent/connect/claude?redirect_uri=https://untrusted.example',{method}),configured,{});
    assert.equal(connect.status,302);assert.equal(connect.headers.get('Cache-Control'),'no-store');
    const target=new URL(connect.headers.get('Location'));
    assert.equal(target.origin,'https://claude.ai');assert.equal(target.pathname,'/customize/connectors');
    assert.equal(target.searchParams.get('modal'),'add-custom-connector');
    assert.equal(target.searchParams.get('connectorName'),'Serena Launch');
    assert.equal(target.searchParams.get('connectorUrl'),MCP_RESOURCE);
    assert.equal(target.searchParams.has('redirect_uri'),false);
  }
  const metadata=await worker.fetch(new Request('https://serenatan.org/.well-known/oauth-protected-resource/launchvideo/mcp'),configured,{});
  assert.equal(metadata.status,200);assert.equal((await metadata.json()).resource,MCP_RESOURCE);
});

test('the real Clerk verifier rejects bad signatures, expiry, session tokens and wrong or missing audiences', async () => {
  const {privateKey, publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const now=Math.floor(Date.now()/1000);
  const payload={sub:'user_fixture',client_id:'client_fixture',iss:env.CLERK_ISSUER,
    aud:MCP_RESOURCE,scope:'profile email',exp:now+120,iat:now-10,nbf:now-10,jti:'oat_fixture'};
  const sign=(claims,typ='at+jwt',key=privateKey)=>{
    const input=[{alg:'RS256',kid:'fixture',typ},claims].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
    return input+'.'+createSign('RSA-SHA256').update(input).sign(key,'base64url');
  };
  const sdk=options=>createClerkClient({...options,jwtKey:publicKey.export({type:'spki',format:'pem'})});
  const good=await authorizeMcp(request(sign(payload)),env,sdk);
  assert.deepEqual(good.identity,{userId:'user_fixture',clientId:'client_fixture'});
  const wrongKey=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey;
  for(const token of [sign({...payload,aud:'https://other.example/mcp'}),sign({...payload,aud:undefined}),
    sign({...payload,exp:now-600}),sign(payload,'JWT'),sign(payload,'at+jwt',wrongKey)]) {
    assert.equal((await authorizeMcp(request(token),env,sdk)).response.status,401);
  }
});
