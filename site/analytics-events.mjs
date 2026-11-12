// Explicit event allowlists keep prompts, email addresses and OAuth parameters
// out of analytics. Shared by the browser and authenticated MCP service.
const fields = {
  community_tab_viewed:[],
  community_post_opened:['post_id','kind'],
  community_post_played:['post_id','kind'],
  community_post_engaged:['post_id','kind'],
  community_product_clicked:['post_id','kind'],
  community_post_published:['post_id','kind','task_id','reference_ids','client'],
  community_video_replaced:['post_id','kind','task_id','reference_ids','client'],
  community_post_updated:['post_id','kind','client'],
  community_post_deleted:['post_id','client'],
  page_viewed:['page','referrer_host','utm_source','utm_medium','utm_campaign'],
  mcp_request_completed:['http_method','status_code','duration_ms','authenticated','client','rpc_method','rpc_request_id','tool','task_id'],
  mcp_rpc_completed:['rpc_method','rpc_request_id','tool','outcome','error_kind','duration_ms','client','task_id'],
  conversation_sharing_changed:['enabled'],
  conversation_started:['session_id','client','task_id'],
  conversation_finished:['session_id','status','client'],
  conversation_deleted:['session_id'],
  collection_viewed:['entry','referrer_host','utm_source','utm_medium','utm_campaign'],
  reference_opened:['reference_id','surface'],
  reference_played:['reference_id','surface'],
  reference_engaged:['reference_id','surface'],
  reference_prompt_copied:['reference_id'],
  collection_filtered:['query_length','result_count','category','style','sort'],
  setup_prompt_copied:['placement','client'],
  quick_connect_clicked:['client','destination'],
  consent_viewed:['client'],
  consent_submitted:['client','decision'],
  consent_failed:['reason'],
  mcp_tool_completed:['tool','outcome','reference_found','reference_id','duration_ms','client','query_length','result_count','category','style','task_id','rpc_request_id'],
  reference_feedback:['reference_id','task_id','rating','reason','client','rpc_request_id'],
  reference_failed:['reference_id','surface','reason','error_code'],
  launch_task_started:['task_id','reference_ids','client','rpc_request_id'],
  launch_task_completed:['task_id','reference_ids','checks_passed','html','source_code','mp4','music','playback','download','client','rpc_request_id'],
  launch_task_failed:['task_id','reference_ids','reason','client','rpc_request_id']
};

export function eventProperties(name, input = {}) {
  if (!Object.hasOwn(fields,name)) throw new Error('Unknown analytics event');
  return Object.fromEntries(fields[name].flatMap(key => {
    const value = input[key];
    if (typeof value === 'boolean') return [[key,value]];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return [[key,Math.round(value)]];
    if (typeof value !== 'string' || !value || value.length > 100 || /[@?#]|:\/\//.test(value)) return [];
    return [[key,value]];
  }));
}

export function capturePayload(name, distinctId, properties, {key,source,isTest = false,identified = false,now = new Date(),uuid = crypto.randomUUID()} = {}) {
  if (!key || !distinctId || distinctId.length > 200) throw new Error('Missing analytics configuration');
  return {api_key:key,event:name,distinct_id:distinctId,uuid,timestamp:now.toISOString(),properties:{
    ...eventProperties(name,properties),app:'serena-launch',source,is_test:isTest,
    $process_person_profile:identified,$ip:null,$geoip_disable:true
  }};
}

export function clientName(clientId = '') {
  try {
    const url = new URL(clientId), host=url.hostname;
    if(host==='chatgpt.com' && url.pathname==='/oauth/codex/client.json')return 'codex';
    return ['claude.ai','chatgpt.com','cursor.com','grok.com'].includes(host) ? host : 'other';
  } catch { return 'other'; }
}
