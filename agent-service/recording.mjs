import {createClerkClient} from '@clerk/backend';
import {captureEvent} from './analytics.mjs';

const BASE='/launchvideo/agent/recording';
export const CONSENT_VERSION='2026-11-09-v1';
const DAY=86400000, MAX_BODY=512*1024;
// Kept only for compatibility with the original NOT NULL schema and older
// deployments. Conversation reads and cleanup do not use an expiry date.
const LEGACY_NO_EXPIRY=Number.MAX_SAFE_INTEGER;
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
export const digest=async value=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
const randomSecret=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
function reply(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Vary':'Authorization, Cookie','X-Robots-Tag':'noindex, nofollow'}});}
class HttpError extends Error {constructor(status,message){super(message);this.status=status;}}
const fail=(status,message)=>{throw new HttpError(status,message);};
export async function readJson(request){
 if(!request.headers.get('Content-Type')?.startsWith('application/json')) fail(415,'JSON required');
 if(Number(request.headers.get('Content-Length'))>MAX_BODY) fail(413,'Request too large');
 const reader=request.body?.getReader(); if(!reader) fail(400,'Missing body');
 const chunks=[];let bytes=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>MAX_BODY)fail(413,'Request too large');chunks.push(value);}}
 finally{await reader.cancel().catch(()=>{});}
 const all=new Uint8Array(bytes);let offset=0;for(const value of chunks){all.set(value,offset);offset+=value.length;}
 try{const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all));if(!value||Array.isArray(value)||typeof value!=='object')fail(400,'JSON object required');return value;}catch(error){if(error instanceof HttpError)throw error;fail(400,'Invalid JSON');}
}
export async function browserIdentity(request,env,createClient=createClerkClient){
 const origin=request.headers.get('Origin');
 const allowed=['https://serenatan.org',...(env.RECORDING_DEV_ORIGIN?[env.RECORDING_DEV_ORIGIN]:[])];
 if(origin&&!allowed.includes(origin))fail(403,'Untrusted origin');
 if(!['GET','HEAD'].includes(request.method)&&!allowed.includes(origin))fail(403,'Same-origin request required');
 if(!/^Bearer \S+$/i.test(request.headers.get('Authorization')||''))fail(401,'Sign in to manage conversation sharing');
 if(!env.CLERK_SECRET_KEY)fail(503,'Sign-in unavailable');
 try{
  const clerk=createClient({secretKey:env.CLERK_SECRET_KEY,publishableKey:env.CLERK_PUBLISHABLE_KEY});
  const state=await clerk.authenticateRequest(request,{acceptsToken:'session_token',authorizedParties:allowed});
  const auth=state.isAuthenticated?state.toAuth():null;
  if(!auth?.userId||!auth.sessionId||auth.tokenType!=='session_token')fail(401,'Sign in again');
  return {userId:auth.userId,clientId:'recording-browser',admin:auth.userId===env.ANALYTICS_INTERNAL_USER_ID};
 }catch(error){if(error instanceof HttpError)throw error;fail(401,'Sign in again');}
}
const preference=(env,userId)=>env.RECORDING_DB.prepare('SELECT * FROM recording_preferences WHERE user_id=?').bind(userId).first();
async function requireConsent(env,userId){const pref=await preference(env,userId);if(!pref?.enabled||pref.consent_version!==CONSENT_VERSION)fail(403,'Conversation sharing is off');return pref;}
const publicPreference=pref=>({enabled:!!pref?.enabled&&pref.consent_version===CONSENT_VERSION,consent_version:CONSENT_VERSION,updated_at:pref?.updated_at??null});
async function collectorIdentity(request,env){
 const match=/^Bearer rec_([a-f0-9-]{36})\.([a-f0-9]{64})$/i.exec(request.headers.get('Authorization')||'');
 if(!match)fail(401,'Connect the recorder in your browser');
 const device=await env.RECORDING_DB.prepare('SELECT * FROM recording_devices WHERE id=? AND revoked_at IS NULL AND expires_at>?').bind(match[1],Date.now()).first();
 if(!device||device.secret_hash!==await digest(match[2]))fail(401,'Recorder authorization expired');
 return device;
}
function validateMessage(value){
 if(!value||!['user','assistant'].includes(value.role)||!Array.isArray(value.content)||!value.content.length||value.content.length>100)fail(400,'Invalid message');
 if(typeof value.id!=='string'||value.id.length>200||typeof value.source_offset!=='number'||!Number.isSafeInteger(value.source_offset)||value.source_offset<0)fail(400,'Invalid source position');
 const content=value.content.map(block=>{if(block?.type!=='text'||typeof block.text!=='string'||block.text.length>200000)fail(400,'Text blocks required');return {type:'text',text:block.text};});
 const timestamp=typeof value.timestamp==='string'&&value.timestamp.length<=50?value.timestamp:null;
 return {id:value.id,role:value.role,content,timestamp,source_offset:value.source_offset};
}
async function ownedSession(env,id,identity,allowAdmin=false){
 if(!uuid(id))fail(404,'Session not found');
 const row=await env.RECORDING_DB.prepare('SELECT * FROM recording_sessions WHERE id=? AND deleted_at IS NULL').bind(id).first();
 if(!row||(!allowAdmin||!identity.admin)&&row.user_id!==identity.userId)fail(404,'Session not found');
 return row;
}
async function purge(env,row){
 await env.RECORDING_DB.prepare("UPDATE recording_sessions SET deleted_at=?,status='deleted' WHERE id=?").bind(Date.now(),row.id).run();
 // Include unindexed objects left by interrupted uploads, not just D1 rows.
 for(;;){const listed=await env.RECORDING_TEXT.list({prefix:`sessions/${row.id}/`,limit:100});if(!listed.objects.length)break;await env.RECORDING_TEXT.delete(listed.objects.map(object=>object.key));}
 await env.RECORDING_DB.batch([
  env.RECORDING_DB.prepare('DELETE FROM recording_chunks WHERE session_id=?').bind(row.id),
  env.RECORDING_DB.prepare('DELETE FROM recording_sessions WHERE id=?').bind(row.id)
 ]);
}
export async function cleanupDeletedRecordings(env){
 if(!env.RECORDING_DB||!env.RECORDING_TEXT)return;
 const rows=await env.RECORDING_DB.prepare('SELECT id FROM recording_sessions WHERE deleted_at IS NOT NULL LIMIT 100').all();
 for(const row of rows.results)await purge(env,row);
 await env.RECORDING_DB.prepare('DELETE FROM recording_devices WHERE expires_at<?').bind(Date.now()-DAY).run();
}
export async function recordingRoutes(request,env,ctx={},authenticate=browserIdentity){
 const url=new URL(request.url);if(!url.pathname.startsWith(BASE+'/'))return null;
 try{
  if(!env.RECORDING_DB||!env.RECORDING_TEXT)fail(503,'Conversation sharing unavailable');
  const path=url.pathname.slice(BASE.length), method=request.method;
  const observe=(identity,name,properties)=>ctx.waitUntil?.(captureEvent(env,identity,name,properties));
  if(path==='/pair'&&method==='POST'){
   const body=await readJson(request);
   if(!['claude-code','codex'].includes(body.client))fail(400,'Unsupported client');
   const id=crypto.randomUUID(),secret=randomSecret(),code=randomSecret().slice(0,16).toUpperCase(),now=Date.now();
   await env.RECORDING_DB.prepare('INSERT INTO recording_devices (id,secret_hash,code,label,created_at,expires_at) VALUES (?,?,?,?,?,?)').bind(id,await digest(secret),code,body.client,now,now+10*60000).run();
   return reply({token:`rec_${id}.${secret}`,code,url:`https://serenatan.org/launchvideo/sharing?code=${code}`,expires_in:600},201);
  }
  if(path==='/device'&&method==='GET'){
   const device=await collectorIdentity(request,env);
   if(!device.user_id)return reply({approved:false});
   const pref=await preference(env,device.user_id);
   return reply({approved:true,...publicPreference(pref)});
  }
  if(path==='/sessions'&&method==='POST'){
   const device=await collectorIdentity(request,env);if(!device.user_id)fail(403,'Approve the recorder first');
   const pref=await requireConsent(env,device.user_id),body=await readJson(request);
   if(body.client!==device.label||typeof body.source_session_id!=='string'||!body.source_session_id||body.source_session_id.length>200)fail(400,'Invalid session');
   const refs=body.reference_ids??[];if(!Array.isArray(refs)||refs.length>3||refs.some(id=>!Number.isSafeInteger(id)||id<=0))fail(400,'Invalid references');
   if(body.task_id!==undefined&&!uuid(body.task_id))fail(400,'Invalid task ID');
   const now=Date.now(),id=crypto.randomUUID();
   await env.RECORDING_DB.prepare('INSERT OR IGNORE INTO recording_sessions (id,user_id,device_id,client,source_session_id,consent_revision,task_id,reference_ids,created_at,updated_at,expires_at) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM recording_preferences WHERE user_id=? AND enabled=1 AND revision=?)').bind(id,device.user_id,device.id,body.client,body.source_session_id,pref.revision,body.task_id??null,JSON.stringify(refs),now,now,LEGACY_NO_EXPIRY,device.user_id,pref.revision).run();
   const row=await env.RECORDING_DB.prepare('SELECT * FROM recording_sessions WHERE device_id=? AND source_session_id=? AND consent_revision=? AND deleted_at IS NULL').bind(device.id,body.source_session_id,pref.revision).first();
   if(!row)fail(403,'Sharing was turned off');
   if(row.id===id)observe({userId:device.user_id},'conversation_started',{session_id:id,client:body.client,task_id:body.task_id});
   return reply({session_id:row.id,last_seq:row.last_seq,status:row.status},201);
  }
  const upload=/^\/sessions\/([^/]+)\/(chunks|finish|metadata)$/.exec(path);
  if(upload&&method==='POST'){
   const device=await collectorIdentity(request,env);if(!device.user_id)fail(403,'Approve the recorder first');
   const pref=await requireConsent(env,device.user_id),row=await ownedSession(env,upload[1],{userId:device.user_id});
   if(row.device_id!==device.id||row.consent_revision!==pref.revision)fail(403,'Start a new sharing session');
   const body=await readJson(request);
   if(upload[2]==='metadata'){
    if(body.task_id!==undefined&&!uuid(body.task_id))fail(400,'Invalid task ID');
    if(!Array.isArray(body.reference_ids)||body.reference_ids.length>3||body.reference_ids.some(id=>!Number.isSafeInteger(id)||id<=0))fail(400,'Invalid reference IDs');
    await env.RECORDING_DB.prepare('UPDATE recording_sessions SET task_id=COALESCE(?,task_id),reference_ids=?,updated_at=? WHERE id=?').bind(body.task_id??null,JSON.stringify(body.reference_ids),Date.now(),row.id).run();return reply({updated:true});
   }
   if(upload[2]==='finish'){
    if(!Number.isSafeInteger(body.last_seq)||body.last_seq!==row.last_seq||!['source_complete','stopped','incomplete'].includes(body.status))fail(409,'Source sequence does not match');
    const status=body.status==='source_complete'?'source_complete':body.status;
    await env.RECORDING_DB.prepare('UPDATE recording_sessions SET status=?,updated_at=? WHERE id=? AND last_seq=?').bind(status,Date.now(),row.id,row.last_seq).run();
    observe({userId:device.user_id},'conversation_finished',{session_id:row.id,status,client:row.client});
    return reply({status,last_seq:row.last_seq,coverage:'visible_text'});
   }
   if(row.status!=='recording')fail(409,'Session is closed');
   if(!Number.isSafeInteger(body.seq)||body.seq<1||body.seq>10000||!Array.isArray(body.messages)||body.messages.length<1||body.messages.length>100)fail(400,'Invalid chunk');
   const messages=body.messages.map(validateMessage),json=JSON.stringify({seq:body.seq,messages}),hash=await digest(json);
   if(hash!==body.sha256)fail(400,'Content checksum mismatch');
   const existing=await env.RECORDING_DB.prepare('SELECT hash FROM recording_chunks WHERE session_id=? AND seq=?').bind(row.id,body.seq).first();
   if(existing){if(existing.hash!==hash)fail(409,'Sequence already contains different text');return reply({accepted:true,seq:body.seq,sha256:hash,duplicate:true});}
   if(body.seq!==row.last_seq+1)fail(409,'Missing source chunk');
   const key=`sessions/${row.id}/${String(body.seq).padStart(6,'0')}-${hash}.json`;
   // R2 first, then a conditional D1 batch. A losing write is deleted. Readers
   // only see indexed objects, never arbitrary R2 keys or public bucket URLs.
   await env.RECORDING_TEXT.put(key,json,{httpMetadata:{contentType:'application/json'}});
   await env.RECORDING_DB.batch([
    env.RECORDING_DB.prepare("INSERT OR IGNORE INTO recording_chunks SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM recording_sessions s JOIN recording_preferences p ON p.user_id=s.user_id WHERE s.id=? AND s.last_seq=? AND s.status='recording' AND s.deleted_at IS NULL AND p.enabled=1 AND p.revision=s.consent_revision)").bind(row.id,body.seq,hash,key,messages.length,Date.now(),row.id,body.seq-1),
    env.RECORDING_DB.prepare('UPDATE recording_sessions SET last_seq=?,updated_at=? WHERE id=? AND last_seq=? AND EXISTS (SELECT 1 FROM recording_chunks WHERE session_id=? AND seq=? AND hash=?)').bind(body.seq,Date.now(),row.id,body.seq-1,row.id,body.seq,hash)
   ]);
   const accepted=await env.RECORDING_DB.prepare('SELECT hash FROM recording_chunks WHERE session_id=? AND seq=?').bind(row.id,body.seq).first();
   if(accepted?.hash!==hash){await env.RECORDING_TEXT.delete(key);fail(409,'Sharing changed; upload not accepted');}
   return reply({accepted:true,seq:body.seq,sha256:hash});
  }
  const identity=await authenticate(request,env);
  if(path==='/preference'&&method==='GET')return reply({...publicPreference(await preference(env,identity.userId)),admin:!!identity.admin});
  if(path==='/preference'&&method==='PUT'){
   const body=await readJson(request);if(typeof body.enabled!=='boolean'||body.consent_version!==CONSENT_VERSION)fail(400,'Confirm the current sharing notice');
   const prev=await preference(env,identity.userId),changed=prev?.enabled!==Number(body.enabled)||prev.consent_version!==CONSENT_VERSION;
   const revision=changed?crypto.randomUUID():prev.revision;
   await env.RECORDING_DB.batch([
    env.RECORDING_DB.prepare('INSERT INTO recording_preferences VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,revision=excluded.revision,updated_at=excluded.updated_at,consent_version=excluded.consent_version').bind(identity.userId,Number(body.enabled),revision,Date.now(),CONSENT_VERSION),
    ...(!body.enabled?[env.RECORDING_DB.prepare("UPDATE recording_sessions SET status='stopped' WHERE user_id=? AND status='recording'").bind(identity.userId)]:[])
   ]);
   if(changed)observe(identity,'conversation_sharing_changed',{enabled:body.enabled});
   return reply(publicPreference(await preference(env,identity.userId)));
  }
  if(path==='/pair'&&method==='GET'){
   const code=url.searchParams.get('code');if(!/^[A-F0-9]{16}$/.test(code||''))fail(400,'Invalid connection code');
   const row=await env.RECORDING_DB.prepare('SELECT label FROM recording_devices WHERE code=? AND user_id IS NULL AND expires_at>? AND revoked_at IS NULL').bind(code,Date.now()).first();
   if(!row)fail(404,'Code expired or already used');return reply({client:row.label});
  }
  if(path==='/pair/approve'&&method==='POST'){
   const body=await readJson(request);await requireConsent(env,identity.userId);
   if(typeof body.code!=='string'||!/^[A-F0-9]{16}$/.test(body.code))fail(400,'Invalid connection code');
   const row=await env.RECORDING_DB.prepare('UPDATE recording_devices SET user_id=?,expires_at=? WHERE code=? AND user_id IS NULL AND expires_at>? AND revoked_at IS NULL RETURNING id,label').bind(identity.userId,Date.now()+90*DAY,body.code,Date.now()).first();
   if(!row)fail(409,'Code expired or already used');
   return reply({approved:true,client:row.label});
  }
  if(path==='/devices'&&method==='GET'){
   const data=await env.RECORDING_DB.prepare('SELECT id,label,created_at,expires_at FROM recording_devices WHERE user_id=? AND revoked_at IS NULL AND expires_at>?').bind(identity.userId,Date.now()).all();return reply({devices:data.results});
  }
  if(path.startsWith('/devices/')&&method==='DELETE'){
   const id=path.slice('/devices/'.length);if(!uuid(id))fail(404,'Recorder not found');
   await env.RECORDING_DB.batch([env.RECORDING_DB.prepare('UPDATE recording_devices SET revoked_at=? WHERE id=? AND user_id=?').bind(Date.now(),id,identity.userId),env.RECORDING_DB.prepare("UPDATE recording_sessions SET status='stopped' WHERE device_id=? AND user_id=? AND status='recording'").bind(id,identity.userId)]);return reply({revoked:true});
  }
  if(path==='/sessions'&&method==='GET'){
   const admin=url.searchParams.get('scope')==='all';if(admin&&!identity.admin)fail(403,'Owner access required');
   const before=Number(url.searchParams.get('before'))||Date.now()+1;
   const data=await env.RECORDING_DB.prepare(`SELECT id,client,task_id,reference_ids,created_at,updated_at,last_seq,status,coverage FROM recording_sessions WHERE deleted_at IS NULL AND created_at<? ${admin?'':'AND user_id=?'} ORDER BY created_at DESC LIMIT 50`).bind(before,...(admin?[]:[identity.userId])).all();
   return reply({sessions:data.results,next_before:data.results.length===50?data.results.at(-1).created_at:null});
  }
  const session=/^\/sessions\/([^/]+)$/.exec(path);
  if(session&&method==='DELETE'){
   const row=await ownedSession(env,session[1],identity);await purge(env,row);observe(identity,'conversation_deleted',{session_id:row.id});return reply({deleted:true});
  }
  const chunk=/^\/sessions\/([^/]+)\/chunks\/(\d+)$/.exec(path);
  if(chunk&&method==='GET'){
   await ownedSession(env,chunk[1],identity,true);
   const row=await env.RECORDING_DB.prepare('SELECT object_key,hash FROM recording_chunks WHERE session_id=? AND seq=?').bind(chunk[1],Number(chunk[2])).first();
   if(!row)fail(404,'Chunk not found');const object=await env.RECORDING_TEXT.get(row.object_key);if(!object)fail(503,'Stored text unavailable');
   return new Response(object.body,{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Content-SHA256':row.hash,'X-Robots-Tag':'noindex, nofollow'}});
  }
  fail(404,'Not found');
 }catch(error){
  if(!(error instanceof HttpError))console.error(JSON.stringify({event:'recording_request_failed'}));
  return reply({error:error instanceof HttpError?error.message:'Conversation sharing unavailable'},error instanceof HttpError?error.status:503);
 }
}
