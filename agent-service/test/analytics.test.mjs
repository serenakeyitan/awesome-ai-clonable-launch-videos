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

test('HTTP traffic records challenges, throttles and validated clients without private request data',async()=>{
 const {measureMcpRequest}=await import('../analytics.mjs');
 const env={POSTHOG_PROJECT_TOKEN:'phc_test',ANALYTICS_TEST_USER_IDS:'user_owner'},sent=[],pending=[];
 const ctx={waitUntil:task=>pending.push(task)};
 const capture=async(_url,options)=>{sent.push(JSON.parse(options.body));return new Response('{}');};
 const request=new Request('https://serenatan.org/launchvideo/mcp?private=secret',{method:'POST',headers:{Authorization:'Bearer private-token','X-Serena-Analytics-Test':'1'},body:JSON.stringify({params:{arguments:{prompt:'PRIVATE PRODUCT'}}})});
 for(const status of [401,429]){
  const response=await measureMcpRequest(request,env,ctx,async()=>new Response('unchanged',{status}),capture);
  assert.equal(response.status,status);assert.equal(await response.text(),'unchanged');
 }
 await measureMcpRequest(request,env,ctx,async observe=>{
  observe({userId:'user_owner',clientId:'https://chatgpt.com/oauth/codex/client.json'},{method:'tools/list'});
  return new Response('{}');
 },capture);
 await Promise.all(pending);
 assert.deepEqual(sent.map(e=>e.properties.status_code),[401,429,200]);
 assert.equal(sent[0].distinct_id,'service:mcp');assert.equal(sent[0].properties.authenticated,false);
 assert.equal(sent[2].properties.client,'codex');assert.equal(sent[2].properties.rpc_method,'tools/list');
 assert.equal(sent[2].distinct_id,'account:user_owner');assert.ok(sent.every(e=>e.properties.is_test));
 assert.ok(!/PRIVATE PRODUCT|private-token|private=secret/.test(JSON.stringify(sent)));
});

test('HTTP observation failure never changes a successful MCP response',async()=>{
 const {measureMcpRequest}=await import('../analytics.mjs');const pending=[];
 const response=await measureMcpRequest(new Request('https://serenatan.org/launchvideo/mcp'),{POSTHOG_PROJECT_TOKEN:'phc_test'},{waitUntil:p=>pending.push(p)},async()=>new Response('ok'),async()=>{throw Error('network');});
 assert.equal(await response.text(),'ok');await Promise.all(pending);
});

test('HTTP MCP diagnostics join requests and replies across a creation task',async()=>{
 const {createMcpHandler}=await import('agents/mcp/server');
 const {Client:Modern,StreamableHTTPClientTransport:ModernHTTP}=await import('@modelcontextprotocol/client');
 const {StreamableHTTPClientTransport:LegacyHTTP}=await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
 const {captureEvent,describeMcpRequest,measureMcpRequest,observeMcpReplies,reportLaunchTask}=await import('../analytics.mjs');
 const endpoint=new URL('https://serenatan.org/launchvideo/mcp');
 const env={POSTHOG_PROJECT_TOKEN:'phc_test'};
 const account={userId:'user_fixture',clientId:'https://claude.ai/client'};
 const archive={videos:[],manifest:{},workflow:'Live workflow'};

 for(const [Agent,Transport] of [[Modern,ModernHTTP],[Client,LegacyHTTP]]) {
  const events=[],pending=[];
  const capture=async(_url,options)=>{events.push(JSON.parse(options.body));return new Response('{}');};
  const ctx={waitUntil:promise=>pending.push(promise)};
  const dispatch=(url,options)=>{
   const request=new Request(url,options);
   request.headers.set('Host',endpoint.hostname);
   return measureMcpRequest(request,env,ctx,async observe=>{
    const rpc=await describeMcpRequest(request,true);
    observe(account,rpc);
    const handler=createMcpHandler(()=>{
     const server=createServer(async()=>archive,event=>{
      ctx.waitUntil(captureMcpEvent(env,account,{...event,rpc_request_id:rpc.traceId},capture,{isTest:true}));
     },args=>reportLaunchTask(env,account,args,capture,{isTest:true,rpcRequestId:rpc.traceId}));
     if(!rpc.traceId)return server;
     return observeMcpReplies(server,rpc,event=>ctx.waitUntil(captureEvent(env,account,'mcp_rpc_completed',event,capture,{isTest:true})));
    },{route:endpoint.pathname,allowedHostnames:[endpoint.hostname]});
    return handler(request,env,ctx);
   },capture);
  };
  const client=new Agent({name:'rpc-observation-test',version:'1.0.0'});
  const transport=new Transport(endpoint,{fetch:dispatch,requestInit:{headers:{'X-Serena-Analytics-Test':'1'}}});
  try {
   await client.connect(transport);
   assert.equal((await client.listTools()).tools.length,6);
   const start=await client.callTool({name:'report_launch_task',arguments:{status:'started'}});
   const taskId=start.structuredContent.task_id;
   assert.equal(start.structuredContent.recorded,true);
   assert.ok(!(await client.callTool({name:'get_launch_context',arguments:{task_id:taskId}})).isError);
   assert.ok((await client.callTool({name:'get_launch_video',arguments:{reference:42,task_id:taskId}})).isError);
   assert.ok((await client.callTool({name:'get_launch_video',arguments:{reference:'1',task_id:'private product idea'}})).isError);
   await assert.rejects(client.callTool({name:'private-unregistered-tool',arguments:{task_id:taskId}}));
   const completed=await client.callTool({name:'report_launch_task',arguments:{status:'completed',task_id:taskId,
    checks:{html:true,source:true,mp4:true,music:true,playback:true,download:true}}});
   assert.equal(completed.structuredContent.checks_passed,true);
   await Promise.all(pending);
   const replies=events.filter(event=>event.event==='mcp_rpc_completed').map(event=>event.properties);
   assert.deepEqual(replies.map(({rpc_method,tool,outcome,error_kind})=>[rpc_method,tool,outcome,error_kind]),[
    ['tools/list',undefined,'success',undefined],
    ['tools/call','report_launch_task','success',undefined],
    ['tools/call','get_launch_context','success',undefined],
    ['tools/call','get_launch_video','tool_error',undefined],
    ['tools/call','get_launch_video','tool_error',undefined],
    ['tools/call','other','protocol_error','invalid_params'],
    ['tools/call','report_launch_task','success',undefined]
   ]);
   assert.deepEqual(replies.map(reply=>reply.task_id),[undefined,taskId,taskId,taskId,undefined,undefined,taskId]);
   for(const reply of replies) {
    const http=events.find(event=>event.event==='mcp_request_completed'&&event.properties.rpc_request_id===reply.rpc_request_id);
    assert.equal(http?.properties.rpc_method,reply.rpc_method);
    assert.equal(http?.properties.status_code,200);
   }
   for(const name of ['launch_task_started','mcp_tool_completed','launch_task_completed']) {
    const event=events.find(event=>event.event===name);
    assert.equal(event.properties.task_id,taskId);
    assert.ok(replies.some(reply=>reply.task_id===taskId&&reply.rpc_request_id===event.properties.rpc_request_id));
   }
   assert.ok(events.every(event=>event.properties.is_test));
   assert.doesNotMatch(JSON.stringify(events),/private-unregistered-tool|private product idea/);
  } finally {await client.close();}
 }
});

test('stateless clients\' listen and resource calls are named instead of counted as other', async () => {
  const {describeMcpRequest}=await import('../analytics.mjs');
  for (const method of ['server/discover','subscriptions/listen','resources/read','prompts/get']) {
    const r=new Request('https://serenatan.org/launchvideo/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method})});
    assert.equal((await describeMcpRequest(r,false)).method,method);
  }
  const unknown=new Request('https://serenatan.org/launchvideo/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'x/private-name'})});
  assert.equal((await describeMcpRequest(unknown,false)).method,'other');
});

test('final MP4 completion offers public posting, schema blocks unconsented upload and failure never fabricates publication',async()=>{
 const archive={videos:[],manifest:{},workflow:'Live workflow'};let creates=0,handle=null;
 const server=createServer(async()=>archive,undefined,async args=>({recorded:true,task_id:args.task_id??crypto.randomUUID()}),{suggestHandle:async()=>handle,create:async()=>{creates++;return {upload_id:crypto.randomUUID()};},publish:async()=>{throw Error('storage unavailable');}});
 const client=new Client({name:'community-offer-test',version:'1.0.0'}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
 try{
  const task_id=crypto.randomUUID(),checks={html:true,source:true,mp4:true,music:true,playback:true,download:true};
  const done=await client.callTool({name:'report_launch_task',arguments:{status:'completed',task_id,checks}});
  assert.match(done.structuredContent.community_offer.question,/extra exposure/);assert.match(done.structuredContent.community_offer.when,/Ask once/);assert.equal(creates,0);
  assert.match(done.structuredContent.community_offer.question,/which X\/Twitter handle/);
  assert.equal(done.structuredContent.community_offer.suggested_x_handle,null);
  handle='Creator_1';
  const known=await client.callTool({name:'report_launch_task',arguments:{status:'completed',task_id,checks}});
  assert.match(known.structuredContent.community_offer.question,/should I show @Creator_1/);
  const context=await client.callTool({name:'get_launch_context',arguments:{}});
  assert.equal(context.structuredContent.community_attribution.suggested_x_handle,'Creator_1');
  assert.match(context.structuredContent.community_attribution.instructions,/explicitly confirmed handle/);
  const noVideo=await client.callTool({name:'report_launch_task',arguments:{status:'completed',task_id,checks:{...checks,mp4:false}}});assert.equal(noVideo.structuredContent.community_offer,undefined);
  const denied=await client.callTool({name:'create_community_upload',arguments:{title:'Test',video_bytes:12,user_confirmed:false}});assert.equal(denied.isError,true);assert.equal(creates,0);
  const accepted=await client.callTool({name:'create_community_upload',arguments:{title:'Test',video_bytes:12,user_confirmed:true,task_id}});assert.equal(accepted.isError,undefined);assert.equal(creates,1);
  const failed=await client.callTool({name:'publish_community_video',arguments:{upload_id:accepted.structuredContent.upload_id}});assert.equal(failed.isError,true);assert.equal(failed.structuredContent.published,undefined);
 }finally{await client.close();await server.close();}
});
