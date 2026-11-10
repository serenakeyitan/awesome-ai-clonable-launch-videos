import {test} from 'node:test';
import assert from 'node:assert/strict';
import {appendFile,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {recordingRoutes,browserIdentity,CONSENT_VERSION,digest,cleanupDeletedRecordings} from '../recording.mjs';
import {eventProperties} from '../../site/analytics-events.mjs';
import {syncFile} from '../../agent/recorder.mjs';
const BASE='https://serenatan.org/launchvideo/agent/recording';
const fixtureIdentity=async req=>({userId:req.headers.get('x-fixture-user')||'user_a',admin:req.headers.get('x-fixture-admin')==='1'});
test('real D1/R2 recording lifecycle enforces consent, isolation, order and deletion',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'recording-test',modules:true,script:'export default {fetch(){return new Response("fixture")}}',compatibilityDate:'2026-11-03',d1Databases:['RECORDING_DB'],r2Buckets:['RECORDING_TEXT']}]}));
 const env=await mf.getBindings();
 const dir=await mkdtemp(join(tmpdir(),'serena-replay-fixture-'));
 const sql=await readFile(new URL('../migrations/0001_conversation_sharing.sql',import.meta.url),'utf8');
 for(const statement of sql.split(';').filter(x=>x.trim()))await env.RECORDING_DB.prepare(statement).run();
 async function call(path,method='GET',body,token,who='user_a',admin=false){return recordingRoutes(new Request(BASE+path,{method,headers:{Origin:'https://serenatan.org','x-fixture-user':who,...(admin?{'x-fixture-admin':'1'}:{}),...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,{},fixtureIdentity);}
 const pref=enabled=>({enabled,consent_version:CONSENT_VERSION});
 try{
  assert.equal((await (await call('/preference')).json()).enabled,true);
  assert.equal((await env.RECORDING_DB.prepare('SELECT * FROM recording_preferences').all()).results.length,0);
  const pair=await (await call('/pair','POST',{client:'claude-code'})).json();assert.match(pair.token,/^rec_/);
  const stored=await env.RECORDING_DB.prepare('SELECT * FROM recording_devices').first();assert.ok(!JSON.stringify(stored).includes(pair.token.split('.')[1]));
  assert.equal((await call('/sessions','POST',{client:'claude-code',source_session_id:'fixture'},pair.token)).status,403);
  // A saved opt-out blocks recorder approval; an unset preference defaults on.
  await call('/preference','PUT',pref(false),null,'user_b');
  assert.equal((await (await call('/preference','GET',null,null,'user_b')).json()).enabled,false);
  assert.equal((await call('/pair/approve','POST',{code:pair.code},null,'user_b')).status,403);
  assert.equal((await (await call('/preference','GET',null,null,'user_b')).json()).enabled,false);assert.equal((await call('/pair?code='+pair.code)).status,200);
  assert.equal((await call('/pair/approve','POST',{code:pair.code})).status,200);
  const start=await (await call('/sessions','POST',{client:'claude-code',source_session_id:'fixture',reference_ids:[87]},pair.token)).json();assert.ok(start.session_id);
  assert.equal((await call(`/sessions/${start.session_id}/finish`,'POST',{last_seq:0,message_count:0,status:'source_complete'},pair.token)).status,409);
  const text='  我说：逐字保存 🍿\n\n```ts\nconst x = "原文";\n```\t  ';
  const messages=[{id:'original-1',role:'user',content:[{type:'text',text}],timestamp:'2026-11-09T01:00:00Z',source_offset:42}];
  const chunk={seq:1,messages},payload={...chunk,sha256:await digest(JSON.stringify(chunk))};
  const upload=()=>call(`/sessions/${start.session_id}/chunks`,'POST',payload,pair.token);
  assert.equal((await upload()).status,200);assert.equal((await (await upload()).json()).duplicate,true);
  assert.equal((await env.RECORDING_DB.prepare('SELECT * FROM recording_chunks').all()).results.length,1);
  const original=await (await call(`/sessions/${start.session_id}/chunks/1`)).json();assert.equal(original.messages[0].content[0].text,text);
  const storedChunk=await env.RECORDING_DB.prepare('SELECT object_key FROM recording_chunks WHERE session_id=? AND seq=1').bind(start.session_id).first();
  await env.RECORDING_TEXT.put(storedChunk.object_key,'{"messages":[]}');
  const damaged=await call(`/sessions/${start.session_id}/chunks/1`);
  assert.equal(damaged.status,503);assert.match((await damaged.json()).error,/integrity check/);
  await env.RECORDING_TEXT.put(storedChunk.object_key,JSON.stringify(chunk));
  assert.equal((await call(`/sessions/${start.session_id}/chunks/1`,'GET',null,null,'user_b')).status,404);
  assert.equal((await call('/sessions?scope=all','GET',null,null,'user_b')).status,403);
  assert.equal((await call(`/sessions/${start.session_id}/chunks/1`,'GET',null,null,'team',true)).status,200);
  assert.equal((await call(`/sessions/${start.session_id}/chunks`,'POST',{...payload,sha256:'invalid'},pair.token)).status,400);
  const gap={seq:3,messages};gap.sha256=await digest(JSON.stringify(gap));assert.equal((await call(`/sessions/${start.session_id}/chunks`,'POST',gap,pair.token)).status,409);
  assert.equal((await call(`/sessions/${start.session_id}/finish`,'POST',{last_seq:2,status:'source_complete'},pair.token)).status,409);
  assert.equal((await call(`/sessions/${start.session_id}/finish`,'POST',{last_seq:1,message_count:2,status:'source_complete'},pair.token)).status,409);
  const finish=()=>call(`/sessions/${start.session_id}/finish`,'POST',{last_seq:1,message_count:1,status:'source_complete'},pair.token);
  const complete=await (await finish()).json();assert.deepEqual(complete,{status:'source_complete',last_seq:1,message_count:1,coverage:'visible_text'});
  assert.deepEqual(await (await finish()).json(),complete);
  assert.equal((await call(`/sessions/${start.session_id}/finish`,'POST',{last_seq:1,status:'stopped'},pair.token)).status,409);
  await call('/preference','PUT',pref(false));assert.equal((await (await call('/device','GET',null,pair.token)).json()).enabled,false);assert.equal((await upload()).status,403);
  await call('/preference','PUT',pref(true));assert.equal((await upload()).status,403);
  assert.equal((await call(`/sessions/${start.session_id}`,'DELETE',null,null,'user_b')).status,404);
  await env.RECORDING_TEXT.put(`sessions/${start.session_id}/interrupted-upload.json`,'synthetic orphan');
  assert.equal((await call(`/sessions/${start.session_id}`,'DELETE')).status,200);assert.equal((await env.RECORDING_TEXT.list()).objects.length,0);
  assert.equal((await call(`/sessions/${start.session_id}/chunks/1`)).status,404);
  const file=join(dir,'selected.jsonl');
  const state={path:join(dir,'state.json'),seq:0,messages:0};
  const finalText='\t最后一句 🧪\r\n  ';
  await writeFile(file,JSON.stringify({type:'user',uuid:'original-1',sessionId:'next',message:{content:text}})+'\n');
  let loseAck=true;
  const send=async(path,{method,body,token})=>{
   const response=await call(path,method,body,token);assert.ok(response.ok);
   if(path.endsWith('/chunks')&&loseAck){loseAck=false;throw Error('network lost after storing the first chunk');}
   return response.json();
  };
  const options={file,client:'claude-code',state,token:pair.token,send,sourceId:'next'};
  await assert.rejects(syncFile(options),/network lost/);
  await appendFile(file,JSON.stringify({type:'assistant',uuid:'original-2',sessionId:'next',message:{content:finalText}}));
  await syncFile({...options,final:true});
  assert.equal(state.messages,2);assert.equal(state.seq,2);
  const legacyFinish=await (await call(`/sessions/${state.session_id}/finish`,'POST',{last_seq:2,status:'source_complete'},pair.token)).json();
  assert.equal(legacyFinish.status,'stopped');assert.equal(legacyFinish.message_count,2);
  // Legacy 90-day deadlines and old creation dates must not hide or purge text.
  await env.RECORDING_DB.prepare('UPDATE recording_sessions SET expires_at=1,created_at=1').run();
  await cleanupDeletedRecordings(env);
  assert.equal((await env.RECORDING_DB.prepare('SELECT * FROM recording_sessions').all()).results.length,1);
  assert.equal((await (await call('/sessions')).json()).sessions.length,1);
  const replay=[];
  for(let seq=1;seq<=state.seq;seq++){
   const chunk=await (await call(`/sessions/${state.session_id}/chunks/${seq}`)).json();
   replay.push(...chunk.messages.map(message=>message.content[0].text));
  }
  assert.deepEqual(replay,[text,finalText]);
  assert.equal((await env.RECORDING_TEXT.list()).objects.length,2);
  const retentionMigration=await readFile(new URL('../migrations/0002_retain_conversations.sql',import.meta.url),'utf8');
  await env.RECORDING_DB.prepare(retentionMigration).run();
  assert.equal((await env.RECORDING_DB.prepare('SELECT expires_at FROM recording_sessions').first()).expires_at,Number.MAX_SAFE_INTEGER);
  // Only an explicit deletion tombstone is eligible for scheduled cleanup.
  await env.RECORDING_DB.prepare('UPDATE recording_sessions SET deleted_at=1').run();
  await cleanupDeletedRecordings(env);
  assert.equal((await env.RECORDING_DB.prepare('SELECT * FROM recording_sessions').all()).results.length,0);
  assert.equal((await env.RECORDING_TEXT.list()).objects.length,0);
  assert.equal((await call('/devices/'+stored.id,'DELETE')).status,200);assert.equal((await call('/device','GET',null,pair.token)).status,401);
  const large=new Request(BASE+'/preference',{method:'PUT',headers:{'Content-Type':'application/json'},body:'x'.repeat(513*1024)});assert.equal((await recordingRoutes(large,env,{},fixtureIdentity)).status,413);
 }finally{await mf.dispose();await rm(dir,{recursive:true,force:true});}
});
test('browser auth verifies session tokens and blocks cross-origin mutations',async()=>{
 const env={CLERK_SECRET_KEY:'fixture'};
 const factory=()=>({authenticateRequest:async(_r,options)=>{assert.equal(options.acceptsToken,'session_token');return{isAuthenticated:true,toAuth:()=>({userId:'user_fixture',sessionId:'sess_fixture',tokenType:'session_token'})};}});
 const req=origin=>new Request(BASE+'/preference',{method:'PUT',headers:{Origin:origin,Authorization:'Bearer fixture'}});
 assert.equal((await browserIdentity(req('https://serenatan.org'),env,factory)).userId,'user_fixture');
 for(const origin of ['https://evil.example','null'])await assert.rejects(browserIdentity(req(origin),env,factory),/origin/);
 await assert.rejects(browserIdentity(new Request(BASE+'/preference',{method:'PUT',headers:{Authorization:'Bearer fixture'}}),env,factory),/Same-origin/);
 await assert.rejects(browserIdentity(req('https://serenatan.org'),env,()=>({authenticateRequest:async()=>({isAuthenticated:false})})),/Sign in/);
});
test('analytics strips text, messages and device credentials',()=>{
 for(const name of ['conversation_sharing_changed','conversation_started','conversation_finished','conversation_deleted']){
  const value=eventProperties(name,{enabled:true,session_id:crypto.randomUUID(),text:'private',messages:['private'],token:'secret'});
  for(const key of ['text','messages','token'])assert.ok(!(key in value));
 }
});
test('the actual Clerk SDK accepts signed session JWTs and rejects OAuth tokens on recording routes',async()=>{
 const {generateKeyPairSync,createSign}=await import('node:crypto');const {createClerkClient}=await import('@clerk/backend');
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048}),now=Math.floor(Date.now()/1000);
 const env={CLERK_SECRET_KEY:'sk_test_fixture',CLERK_PUBLISHABLE_KEY:'pk_test_ZXhhbXBsZS5jb20k'};
 const claims={sub:'user_fixture',sid:'sess_fixture',iss:'https://example.com',azp:'https://serenatan.org',exp:now+120,iat:now-10,nbf:now-10};
 const sign=(payload,typ='JWT')=>{const input=[{alg:'RS256',kid:'fixture',typ},payload].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');return input+'.'+createSign('RSA-SHA256').update(input).sign(privateKey,'base64url');};
 const factory=options=>createClerkClient({...options,jwtKey:publicKey.export({type:'spki',format:'pem'})});
 const request=token=>new Request(BASE+'/preference',{headers:{Authorization:'Bearer '+token}});
 assert.equal((await browserIdentity(request(sign(claims)),env,factory)).userId,'user_fixture');
 for(const token of [sign({...claims,azp:'https://evil.example'}),sign({...claims,exp:now-600}),sign({...claims,client_id:'client_fixture',scope:'profile email',aud:'https://serenatan.org/launchvideo/mcp'},'at+jwt')])await assert.rejects(browserIdentity(request(token),env,factory));
});
