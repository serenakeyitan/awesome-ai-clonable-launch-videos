import {capturePayload,clientName} from '../site/analytics-events.mjs';

export async function captureEvent(env, identity, name, event, fetcher = fetch, uuid) {
  if (!env.POSTHOG_PROJECT_TOKEN || !identity?.userId) return false;
  try {
    const payload=capturePayload(name,`account:${identity.userId}`,{...event,client:name.startsWith('conversation_') ? event.client : clientName(identity.clientId)},
      {key:env.POSTHOG_PROJECT_TOKEN,source:name.startsWith('conversation_') ? 'recording' : 'mcp',identified:true,isTest:identity.userId===env.ANALYTICS_INTERNAL_USER_ID,...(uuid ? {uuid} : {})});
    const response=await fetcher('https://us.i.posthog.com/i/v0/e/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(3000)});
    if (!response.ok) console.warn(JSON.stringify({event:'analytics_capture_failed',status:response.status}));
    return response.ok;
  } catch {console.warn(JSON.stringify({event:'analytics_capture_failed'}));return false;}
}
export const captureMcpEvent=(env,identity,event,fetcher)=>captureEvent(env,identity,'mcp_tool_completed',event,fetcher);

// Analytics reports, not jobs. Retried account/task/status reports deduplicate.
export async function reportLaunchTask(env,identity,args,fetcher=fetch) {
  if (!identity?.userId) return {recorded:false,reason:'Sign in to report a task'};
  if (args.status!=='started' && args.status!=='feedback' && !args.task_id) return {recorded:false,reason:'Reuse the task_id returned at start'};
  if (args.status==='feedback' && (!args.rating || !args.reference_ids?.length)) return {recorded:false,reason:'Explicit feedback needs a rating and reference ID'};
  const taskId=args.task_id ?? crypto.randomUUID();
  const {source:sourceCode,...checks}=args.checks ?? {};
  const name=args.status==='feedback' ? 'reference_feedback' : `launch_task_${args.status}`;
  const base={task_id:taskId,reference_ids:args.reference_ids?.join(','),...checks,source_code:sourceCode,checks_passed:!!args.checks && Object.values(args.checks).every(value=>value===true),reason:args.reason};
  const records=args.status==='feedback' ? [...new Set(args.reference_ids)].map(reference_id=>({reference_id,...(args.task_id ? {task_id:taskId} : {}),rating:args.rating,reason:args.reason})) : [base];
  const recorded=await Promise.all(records.map(async event=>{
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${identity.userId}:${taskId}:${args.status}:${event.reference_id ?? ''}`));
    const hex=Array.from(new Uint8Array(digest)).slice(0,16).map(b=>b.toString(16).padStart(2,'0')).join('');
    const uuid=`${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20)}`;
    return captureEvent(env,identity,name,event,fetcher,uuid);
  }));
  return {recorded:recorded.every(Boolean),task_id:taskId,measurement:'agent_reported',...(args.status==='completed' ? {checks_passed:base.checks_passed} : {})};
}
