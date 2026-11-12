import {capturePayload,clientName} from '../site/analytics-events.mjs';
import {z} from 'zod';

const internalAccount=(env,identity)=>!!identity?.userId && (identity.userId===env.ANALYTICS_INTERNAL_USER_ID || String(env.ANALYTICS_TEST_USER_IDS||'').split(',').map(id=>id.trim()).includes(identity.userId));

export async function captureEvent(env, identity, name, event, fetcher = fetch, {uuid, isTest = false} = {}) {
  if (!env.POSTHOG_PROJECT_TOKEN || !identity?.userId) return false;
  try {
    const payload=capturePayload(name,`account:${identity.userId}`,{...event,client:name.startsWith('conversation_') ? event.client : clientName(identity.clientId)},
      {key:env.POSTHOG_PROJECT_TOKEN,source:name.startsWith('conversation_') ? 'recording' : 'mcp',identified:true,isTest:isTest || internalAccount(env,identity),...(uuid ? {uuid} : {})});
    const response=await fetcher('https://us.i.posthog.com/i/v0/e/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(3000)});
    if (!response.ok) console.warn(JSON.stringify({event:'analytics_capture_failed',status:response.status}));
    return response.ok;
  } catch {console.warn(JSON.stringify({event:'analytics_capture_failed'}));return false;}
}
export const captureMcpEvent=(env,identity,event,fetcher,options)=>captureEvent(env,identity,'mcp_tool_completed',event,fetcher,options);

const rpcMethods = new Set(['initialize','server/discover','tools/list','tools/call','notifications/initialized','ping','resources/list','prompts/list','subscriptions/listen','resources/templates/list','resources/read','prompts/get','notifications/cancelled']);
const toolNames = new Set(['get_launch_context','search_launch_videos','get_launch_video','report_launch_task']);
export const taskIdSchema = z.uuid();

export async function describeMcpRequest(request, trace) {
  if (request.method !== 'POST') return {method:'other'};
  let body;
  try { body = await request.clone().json(); }
  catch { return {method:'other'}; }

  const method = rpcMethods.has(body?.method) ? body.method : 'other';
  if (!trace || !['tools/list','tools/call'].includes(method) || !['number','string'].includes(typeof body.id)) return {method};
  const tool = method === 'tools/call' ? (toolNames.has(body.params?.name) ? body.params.name : 'other') : undefined;
  const taskId = tool && tool !== 'other' ? taskIdSchema.safeParse(body.params?.arguments?.task_id).data : undefined;
  return {method, tool, taskId, id:body.id, traceId:crypto.randomUUID()};
}

// Both HTTP transports send terminal replies through McpServer.connect. Observe
// the reply after the transport accepts it, without buffering or reading SSE.
export function observeMcpReplies(server, request, observe) {
  const connect = server.connect.bind(server);
  server.connect = transport => {
    const send = transport.send.bind(transport);
    transport.send = async (message, options) => {
      await send(message, options);
      if (message.id !== request.id || message.method) return;
      const outcome = message.error ? 'protocol_error' : message.result?.isError ? 'tool_error' : message.result ? 'success' : undefined;
      if (!outcome) return;
      const errorKind = message.error ? ({'-32602':'invalid_params','-32601':'method_not_found','-32603':'internal_error'}[message.error.code] ?? 'other_protocol_error') : undefined;
      const taskId = request.tool === 'report_launch_task'
        ? taskIdSchema.safeParse(message.result?.structuredContent?.task_id).data ?? request.taskId
        : request.taskId;
      try { observe({rpc_method:request.method,rpc_request_id:request.traceId,tool:request.tool,outcome,error_kind:errorKind,task_id:taskId}); }
      catch { console.warn(JSON.stringify({event:'analytics_capture_failed'})); }
    };
    return connect(transport);
  };
  return server;
}

// HTTP volume includes discovery/auth challenges and throttles. Count requests,
// never service:mcp as a person. Tool outcomes remain a separate measurement.
export async function measureMcpRequest(request,env,ctx,handle,fetcher=fetch) {
  let identity, rpc = {method:'other'};
  const started=Date.now();
  const observe=(verified,description)=>{identity=verified;if(description)rpc=description;};
  const record=status=>{
    if(!env.POSTHOG_PROJECT_TOKEN)return;
    const task=(async()=>{
      try {
        const payload=capturePayload('mcp_request_completed',identity?.userId ? `account:${identity.userId}` : 'service:mcp',{
          http_method:request.method,status_code:status,duration_ms:Math.max(0,Date.now()-started),authenticated:!!identity,client:identity ? clientName(identity.clientId) : 'unauthenticated',rpc_method:rpc.method,rpc_request_id:rpc.traceId,tool:rpc.tool,task_id:rpc.taskId
        },{key:env.POSTHOG_PROJECT_TOKEN,source:'mcp_http',identified:!!identity,isTest:internalAccount(env,identity)||request.headers.get('X-Serena-Analytics-Test')==='1'});
        const response=await fetcher('https://us.i.posthog.com/i/v0/e/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(3000)});
        if(!response.ok)console.warn(JSON.stringify({event:'analytics_capture_failed',status:response.status}));
      } catch { console.warn(JSON.stringify({event:'analytics_capture_failed'})); }
    })();
    ctx.waitUntil?.(task);
  };
  try {const response=await handle(observe);record(response.status);return response;}
  catch(error){record(500);throw error;}
}

// Analytics reports, not jobs. Retried account/task/status reports deduplicate.
export async function reportLaunchTask(env,identity,args,fetcher=fetch,{isTest=false,rpcRequestId}={}) {
  if (!identity?.userId) return {recorded:false,reason:'Sign in to report a task'};
  if (args.status!=='started' && args.status!=='feedback' && !args.task_id) return {recorded:false,reason:'Reuse the task_id returned at start'};
  if (args.status==='feedback' && (!args.rating || !args.reference_ids?.length)) return {recorded:false,reason:'Explicit feedback needs a rating and reference ID'};
  const taskId=args.task_id ?? crypto.randomUUID();
  const {source:sourceCode,...checks}=args.checks ?? {};
  const name=args.status==='feedback' ? 'reference_feedback' : `launch_task_${args.status}`;
  const base={task_id:taskId,reference_ids:args.reference_ids?.join(','),...checks,source_code:sourceCode,checks_passed:!!args.checks && Object.values(args.checks).every(value=>value===true),reason:args.reason,rpc_request_id:rpcRequestId};
  const records=args.status==='feedback' ? [...new Set(args.reference_ids)].map(reference_id=>({reference_id,...(args.task_id ? {task_id:taskId} : {}),rating:args.rating,reason:args.reason,rpc_request_id:rpcRequestId})) : [base];
  const recorded=await Promise.all(records.map(async event=>{
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${identity.userId}:${taskId}:${args.status}:${event.reference_id ?? ''}`));
    const hex=Array.from(new Uint8Array(digest)).slice(0,16).map(b=>b.toString(16).padStart(2,'0')).join('');
    const uuid=`${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20)}`;
    return captureEvent(env,identity,name,event,fetcher,{uuid,isTest});
  }));
  return {recorded:recorded.every(Boolean),task_id:taskId,measurement:'agent_reported',...(args.status==='completed' ? {checks_passed:base.checks_passed} : {})};
}
