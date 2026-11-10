import test from 'node:test';
import assert from 'node:assert/strict';
import {Client,InMemoryTransport} from '@modelcontextprotocol/client';
import {capturePayload,eventProperties} from '../../site/analytics-events.mjs';
import {createAnalytics} from '../../site/analytics.mjs';
import {captureMcpEvent} from '../analytics.mjs';
import {createServer} from '../worker.mjs';

const settings={project_token:'phc_test',api_host:'https://us.i.posthog.com'};
function storage() {
  const values=new Map();
  return {getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),values};
}

test('event payloads reject unknown events and remove search text, email, OAuth URLs and credentials',()=>{
  const properties=eventProperties('collection_filtered',{query_length:12,result_count:3,query:'private product idea',email:'person@example.com',token:'secret',state:'oauth-state',category:'Developer tools'});
  assert.deepEqual(properties,{query_length:12,result_count:3,category:'Developer tools'});
  assert.throws(()=>eventProperties('arbitrary_event'),/Unknown/);
  const payload=capturePayload('collection_viewed','browser:fixture',{entry:'collection',utm_campaign:'name@example.com',referrer_host:'https://site.example/path?code=private'},{key:'phc_test',source:'web'});
  assert.ok(!JSON.stringify(payload).includes('private'));
  assert.ok(!JSON.stringify(payload).includes('name@example.com'));
  assert.equal(payload.properties.$ip,null);
  assert.equal(payload.properties.$geoip_disable,true);
  assert.equal(payload.properties.$process_person_profile,false);
});

test('Do Not Track, GPC and denied storage produce no identifier or captured events',async()=>{
  for(const privacy of [{doNotTrack:'1'},{globalPrivacyControl:true}]) {
    const store=storage();let sends=0;
    const analytics=createAnalytics({config:Promise.resolve(settings),storage:store,privacy,send:async()=>{sends++;return true;}});
    assert.equal(await analytics.track('collection_viewed'),false);
    assert.equal(await analytics.identify('user_fixture'),false);
    assert.equal(store.values.size,0);assert.equal(sends,0);
  }
  const analytics=createAnalytics({config:Promise.resolve(settings),storage:{getItem(){throw new Error('blocked');}},send:async()=>{throw new Error('must not send');}});
  assert.equal(await analytics.track('collection_viewed'),false);
});

test('browser identity persists, merges into the same opaque account as MCP, and test traffic stays marked',async()=>{
  const store=storage(),sent=[];
  const make=()=>createAnalytics({config:Promise.resolve(settings),storage:store,isTest:true,send:async(host,payload)=>{sent.push(payload);return true;}});
  const first=make();await first.track('collection_viewed');
  const second=make();await second.track('reference_opened',{reference_id:3});
  assert.equal(sent[0].distinct_id,sent[1].distinct_id);
  await second.identify('user_fixture');await second.track('consent_viewed',{client:'claude.ai'});
  assert.equal(sent[2].event,'$identify');
  assert.equal(sent[2].properties.$anon_distinct_id,sent[0].distinct_id);
  assert.equal(sent[3].distinct_id,'account:user_fixture');
  assert.ok(sent.every(event=>event.properties.is_test===true));
  assert.equal(await second.identify('person@example.com'),false);
});

test('network failure never rejects a browser action or MCP observation',async()=>{
  const analytics=createAnalytics({config:Promise.resolve(settings),storage:storage(),send:async()=>{throw new Error('network');}});
  assert.equal(await analytics.track('collection_viewed'),false);
  assert.equal(await captureMcpEvent({POSTHOG_PROJECT_TOKEN:'phc_test'},{userId:'user_fixture'}, {},async()=>{throw new Error('network');}),false);
  assert.equal(await captureMcpEvent({},null,{}),false);
});

test('MCP capture uses verified account identity, suppresses private args and marks the internal account',async()=>{
  let payload;
  const success=await captureMcpEvent({POSTHOG_PROJECT_TOKEN:'phc_test',ANALYTICS_INTERNAL_USER_ID:'user_fixture'},
    {userId:'user_fixture',clientId:'https://claude.ai/oauth/client-metadata.json'},
    {tool:'get_launch_video',outcome:'success',reference_found:true,duration_ms:12,query:'private',email:'person@example.com'},
    async(url,options)=>{payload=JSON.parse(options.body);return new Response('{}');});
  assert.equal(success,true);assert.equal(payload.distinct_id,'account:user_fixture');
  assert.equal(payload.properties.source,'mcp');assert.equal(payload.properties.client,'claude.ai');
  assert.equal(payload.properties.is_test,true);assert.equal(payload.properties.reference_found,true);
  assert.ok(!Object.hasOwn(payload.properties,'query'));assert.ok(!Object.hasOwn(payload.properties,'email'));
});

test('real tool completion distinguishes a missing reference and survives an observer failure',async()=>{
  const archive={sourceRevision:'a'.repeat(40),videos:[{id:1,title:'A reference',source:'https://x.com/a/status/1',poster:'previews/a.jpg',styles:[]}],manifest:{},workflow:'Live workflow'};
  const observed=[];const server=createServer(async()=>archive,event=>{observed.push(event);throw new Error('observer unavailable');});
  const client=new Client({name:'analytics-test',version:'1.0.0'});
  const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
  try {
    const found=await client.callTool({name:'get_launch_video',arguments:{reference:'1'}});
    const missing=await client.callTool({name:'get_launch_video',arguments:{reference:'2'}});
    assert.ok(!found.isError);assert.ok(!missing.isError);
    assert.deepEqual(observed.map(e=>e.reference_found),[true,false]);
    assert.ok(observed.every(e=>e.tool==='get_launch_video' && e.outcome==='success' && e.duration_ms>=0));
  } finally {await client.close();await server.close();}
});

test('task reports separate completion and checks, deduplicate retries, and require explicit feedback',async()=>{
  const {reportLaunchTask}=await import('../analytics.mjs');
  const env={POSTHOG_PROJECT_TOKEN:'phc_test'},identity={userId:'user_fixture'},sent=[];
  const send=async(url,options)=>{sent.push(JSON.parse(options.body));return new Response('{}');};
  const start=await reportLaunchTask(env,identity,{status:'started',reference_ids:[1]},send);
  assert.equal(start.recorded,true);assert.match(start.task_id,/^[\da-f-]{36}$/);
  assert.equal((await reportLaunchTask(env,identity,{status:'completed'},send)).recorded,false);
  const incomplete=await reportLaunchTask(env,identity,{status:'completed',task_id:start.task_id},send);
  assert.equal(incomplete.checks_passed,false);
  await reportLaunchTask(env,identity,{status:'completed',task_id:start.task_id},send);
  assert.equal(sent.at(-1).uuid,sent.at(-2).uuid);
  assert.equal((await reportLaunchTask(env,identity,{status:'feedback',reference_ids:[1]},send)).recorded,false);
  const feedback=await reportLaunchTask(env,identity,{status:'feedback',task_id:start.task_id,reference_ids:[1],rating:'not_helpful',reason:'poor_fit'},send);
  assert.equal(feedback.recorded,true);assert.equal(sent.at(-1).event,'reference_feedback');
  assert.equal(sent.at(-1).properties.rating,'not_helpful');assert.equal(sent.at(-1).properties.task_id,start.task_id);
  assert.equal((await reportLaunchTask(env,identity,{status:'failed',task_id:start.task_id},async()=>new Response('{}',{status:503}))).recorded,false);
});


test('reporting MCP tool returns an accepted task ID and rejects private fields',async()=>{
  const {reportLaunchTask}=await import('../analytics.mjs');
  const archive={videos:[{id:1}],manifest:{},workflow:'Live workflow'};
  const payloads=[];
  const server=createServer(async()=>archive,undefined,args=>reportLaunchTask({POSTHOG_PROJECT_TOKEN:'phc_test'},{userId:'user_fixture'},args,async(url,options)=>{payloads.push(JSON.parse(options.body));return new Response('{}');}));
  const client=new Client({name:'report-test',version:'1.0.0'});
  const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
  try {
    const tools=await client.listTools();assert.equal(tools.tools.find(t=>t.name==='report_launch_task').annotations.readOnlyHint,false);
    const start=await client.callTool({name:'report_launch_task',arguments:{status:'started',reference_ids:[1]}});
    assert.equal(start.structuredContent.recorded,true);
    const done=await client.callTool({name:'report_launch_task',arguments:{status:'completed',task_id:start.structuredContent.task_id,checks:{html:true,source:true,mp4:true,music:true,playback:true,download:true}}});
    assert.equal(done.structuredContent.checks_passed,true);
    assert.equal(payloads[1].event,'launch_task_completed');
    const missing=await client.callTool({name:'report_launch_task',arguments:{status:'completed'}});assert.equal(missing.isError,true);
  } finally {await client.close();await server.close();}
});
test('recording events keep client attribution and opaque task/session joins without original text',async()=>{
 const {captureEvent}=await import('../analytics.mjs');let payload;
 await captureEvent({POSTHOG_PROJECT_TOKEN:'phc_test'},{userId:'user_fixture'},'conversation_started',{client:'claude-code',session_id:crypto.randomUUID(),task_id:crypto.randomUUID(),text:'PRIVATE'},async(_url,options)=>{payload=JSON.parse(options.body);return new Response('{}');});
 assert.equal(payload.properties.client,'claude-code');assert.equal(payload.properties.source,'recording');assert.ok(payload.properties.session_id);assert.ok(payload.properties.task_id);assert.ok(!JSON.stringify(payload).includes('PRIVATE'));
});
