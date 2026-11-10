#!/usr/bin/env node
// Optional, local-only collector. No scanning, model reconstruction or uploads
// until browser approval AND a selected session have both been established.
import {readFile,writeFile,mkdir,chmod,rename,realpath} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

export const API='https://serenatan.org/launchvideo/agent/recording';
const ROOT=process.env.SERENA_RECORDER_HOME||join(homedir(),'.config','serena-launch','recorder');
const hash=value=>createHash('sha256').update(value).digest('hex');
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
async function load(path,fallback){try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
async function save(path,value){await mkdir(dirname(path),{recursive:true,mode:0o700});const temp=path+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(temp,path);await chmod(path,0o600);}
async function auth(){const config=await load(join(ROOT,'authorization.json'),null);if(!config?.token)throw Error('Run: node serena-recorder.mjs connect --client claude-code (or codex)');return config;}
class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}
async function request(path,{token,method='GET',body}={}){
 const response=await fetch(API+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
 const data=await response.json();if(!response.ok)throw new ApiError(response.status,data.error||'Upload unavailable');return data;
}
const textBlocks=content=>typeof content==='string'?[{type:'text',text:content}]:Array.isArray(content)?content.filter(b=>b&&['text','input_text','output_text'].includes(b.type)&&typeof b.text==='string').map(b=>({type:'text',text:b.text})):[];
export function parseTranscript(bytes,client,final=false){
 const originalLength=bytes.length;
 if(final&&bytes.length&&bytes.at(-1)!==10)bytes=Buffer.concat([bytes,Buffer.from("\n")]);
 if(!['claude-code','codex'].includes(client))throw Error('Unsupported client');
 const messages=[];const questionCalls=new Set();let offset=0,tail=false,sourceSession=null,attachments=false;
 // Decode one complete line at a time; an unfinished UTF-8 character is kept
 // in the source file until its newline arrives. Never trim the message text.
 for(;;){const end=bytes.indexOf(10,offset);if(end<0){tail=offset<bytes.length;break;}
  const start=offset;offset=end+1;const line=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(start,end));if(!line.trim())continue;
  let event;try{event=JSON.parse(line);}catch{throw Error(`Invalid source JSON at byte ${start}; nothing was skipped`);}
  if(client==='codex'&&event.type==='session_meta')sourceSession=event.payload?.id??sourceSession;
  if(client==='claude-code')sourceSession=event.sessionId??sourceSession;
  let role,content,id;
  if(client==='claude-code'&&['user','assistant'].includes(event.type)&&!event.isSidechain){role=event.type;content=event.message?.content;id=event.uuid??event.message?.id;}
  if(client==='codex'&&event.type==='response_item'&&event.payload?.type==='message'&&['user','assistant'].includes(event.payload.role)){role=event.payload.role;content=event.payload.content;id=event.payload.id;}
  // Preserve native ask-user questions/replies too: these often appear as
  // tool items rather than ordinary chat text. Copy original payloads; never
  // ask a model to paraphrase the user's selection.
  if(client==='claude-code'&&role&&Array.isArray(content)){
   content=content.flatMap(block=>{
    if(block?.type==='tool_use'&&block.name==='AskUserQuestion'){
     questionCalls.add(block.id);return [{type:'text',text:JSON.stringify(block.input)}];
    }
    if(block?.type==='tool_result'&&questionCalls.has(block.tool_use_id))return textBlocks(block.content);
    return [block];
   });
  }
  if(client==='codex'&&event.type==='response_item'){
   const item=event.payload;
   if(item?.type==='function_call'&&/(?:^|__)request_user_input(?:_async)?$/.test(item.name||'')){
    questionCalls.add(item.call_id);role='assistant';content=typeof item.arguments==='string'?item.arguments:JSON.stringify(item.arguments);id=item.call_id;
   }
   if(item?.type==='function_call_output'&&questionCalls.has(item.call_id)){
    role='user';content=typeof item.output==='string'?item.output:JSON.stringify(item.output);id=item.call_id+'-reply';
   }
  }
  if(!role)continue;
  if(Array.isArray(content)&&content.some(b=>['image','input_image','file','input_file','audio','input_audio'].includes(b?.type)))attachments=true;
  const blocks=textBlocks(content);if(!blocks.length)continue;
  messages.push({id:typeof id==='string'?id:`source-${start}-${hash(line).slice(0,16)}`,role,content:blocks,timestamp:event.timestamp??null,source_offset:start});
 }
 return {messages,sourceSession,completeBytes:Math.min(offset,originalLength),hasPartialLine:tail,attachments};
}
export function batches(messages,start=0){
 const chunks=[];let current=[];
 for(const message of messages.slice(start)){
  if(Buffer.byteLength(JSON.stringify(message))>400000)throw Error('A message exceeds the upload limit; it has not been truncated');
  if(current.length===100||Buffer.byteLength(JSON.stringify([...current,message]))>440000){chunks.push(current);current=[];}current.push(message);
 }
 if(current.length)chunks.push(current);return chunks;
}
async function connect(client){
 if(!['claude-code','codex'].includes(client))throw Error('Choose --client claude-code or --client codex');
 const pair=await request('/pair',{method:'POST',body:{client}});
 console.log(`Open this link and confirm code ${pair.code}:\n${pair.url}\n\nOnly approve if you started this recorder. No conversation has been uploaded.`);
 for(let attempt=0;attempt<119;attempt++){
  await delay(5000);const state=await request('/device',{token:pair.token});
  if(state.approved){if(!state.enabled)throw Error('Conversation sharing is off. Enable it in Sharing settings.');await save(join(ROOT,'authorization.json'),{token:pair.token,client});console.log('Recorder connected. Select a session to share, or install the Claude Code project hook.');return;}
 }
 throw Error('Connection code expired. Run connect again.');
}
export async function syncFile({file,client,state,token,send=request,sourceId,taskId,referenceIds=[],final=false}){
 const bytes=await readFile(file),parsed=parseTranscript(bytes,client,final);
 if(!parsed.messages.length)throw Error("No supported user or AI text found; this file was not marked complete");
 if(state.source_hash&&hash(bytes.subarray(0,state.source_bytes))!==state.source_hash)throw Error('Source history changed. Stopping to avoid silently overwriting or losing text.');
 const remote=await send('/device',{token});if(!remote.approved||!remote.enabled)throw new ApiError(403,'Conversation sharing is off');
 if(!state.session_id){
  const created=await send('/sessions',{token,method:'POST',body:{client,source_session_id:sourceId||parsed.sourceSession||hash(await realpath(file)),...(taskId?{task_id:taskId}:{}),reference_ids:referenceIds}});
  if(created.last_seq!==0)throw Error('This source already has a remote history but no local checkpoint. Do not guess missing text; restore the local recorder state.');
  state.session_id=created.session_id;state.seq=0;state.messages=0;await save(state.path,state);
 }
 const metadata=await load(state.path+'.metadata',null);
 if(metadata&&JSON.stringify(metadata)!==state.metadata_json){
  await send(`/sessions/${state.session_id}/metadata`,{token,method:'POST',body:metadata});
  state.metadata_json=JSON.stringify(metadata);await save(state.path,state);
 }
 for(const messages of batches(parsed.messages,state.messages)){
  const seq=state.seq+1,sha256=hash(JSON.stringify({seq,messages}));
  // Persist exact payload before sending. A crash or network failure resends
  // the same sequence and checksum; the server acknowledges duplicates.
  state.pending={seq,messages,sha256};await save(state.path,state);
  const ack=await send(`/sessions/${state.session_id}/chunks`,{token,method:'POST',body:state.pending});
  if(ack.seq!==seq||ack.sha256!==sha256)throw Error('Upload acknowledgement does not match the original text');
  state.seq=seq;state.messages+=messages.length;delete state.pending;await save(state.path,state);
 }
 state.source_bytes=parsed.completeBytes;state.source_hash=hash(bytes.subarray(0,parsed.completeBytes));state.attachments=parsed.attachments;await save(state.path,state);
 return parsed;
}
async function watch({file,client,once=false,sourceId,taskId,referenceIds=[]}){
 const config=await auth();if(config.client!==client)throw Error('Connect the recorder for this client first');
 const statePath=join(ROOT,'sessions',hash(client+':'+await realpath(file))+'.json');
 const state=await load(statePath,{path:statePath,seq:0,messages:0});state.path=statePath;
 if(state.finished){console.log('This session is closed. No upload performed.');return;}
 // Recover an exact unacknowledged chunk before parsing more source text.
 if(state.pending){const ack=await request(`/sessions/${state.session_id}/chunks`,{token:config.token,method:'POST',body:state.pending});if(ack.sha256!==state.pending.sha256)throw Error('Recovery checksum mismatch');state.seq=state.pending.seq;state.messages+=state.pending.messages.length;delete state.pending;await save(statePath,state);}
 let stop=false;for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{stop=true;});
 console.log('Sharing this session’s original user and AI text. Ctrl+C stops sharing. Manage or delete: https://serenatan.org/launchvideo/sharing');
 let lastParsed,failures=0;const started=Date.now();
 while(!stop&&Date.now()-started<6*3600000){
  const stopInfo=await load(statePath+'.stop',null);
  if(stopInfo){stop=true;}
  try{
   lastParsed=await syncFile({file,client,state,token:config.token,sourceId,taskId,referenceIds,final:once||!!stopInfo?.ended});failures=0;
   if(once||stop)break;
  }catch(e){
   if(e instanceof ApiError&&[401,403,404,409,410].includes(e.status))throw e;
   if(!e.status&&!/fetch|network|timeout|abort/i.test(e.message))throw e;
   failures++;console.error('Sync paused; the original file and pending chunk are retained locally. Retrying.');
   await delay(Math.min(30000,1000*2**Math.min(failures,5)));continue;
  }
  await delay(2000);
 }
 if(stop&&!once){const ended=await load(statePath+".stop",null);lastParsed=await syncFile({file,client,state,token:config.token,sourceId,taskId,referenceIds,final:!!ended?.ended});}
 if(state.session_id){
  const stopInfo=await load(statePath+'.stop',null);
  const status=!lastParsed?.hasPartialLine&&(once||stopInfo?.ended)?'source_complete':'stopped';
  await request(`/sessions/${state.session_id}/finish`,{token:config.token,method:'POST',body:{last_seq:state.seq,status}});
  state.finished=true;await save(statePath,state);
  console.log(`${state.messages} original text messages synced. ${status==='source_complete'?'Source snapshot fully synced.':'Sharing stopped.'}${state.attachments?' Images/files were not uploaded.':''}`);
 }
}
export function addHooks(settings,command,project){
 const hooks={...(settings.hooks||{})};
 for(const event of ['PostToolUse','SessionEnd']){
  const entries=hooks[event]||[];
  hooks[event]=[...entries.map(entry=>({...entry,hooks:entry.hooks?.filter(h=>!(h.command?.includes('serena-recorder.mjs')&&h.command?.includes(' hook')))})).filter(entry=>entry.hooks?.length),{...(event==='PostToolUse'?{matcher:'mcp__.*'}:{}),hooks:[{type:'command',command:`${command} hook${project?" --project "+quote(project):""}`,timeout:10}]}];
 }
 return {...settings,hooks};
}
async function install(project,server){
 const config=await auth();if(config.client!=='claude-code')throw Error('Connect --client claude-code first');
 const projectRoot=await realpath(project),target=join(ROOT,'serena-recorder.mjs');
 await mkdir(ROOT,{recursive:true,mode:0o700});const source=await readFile(fileURLToPath(import.meta.url));await writeFile(target,source,{mode:0o700});
 await save(join(ROOT,'projects',hash(projectRoot)+'.json'),{project:projectRoot,server});
 const settingsPath=join(projectRoot,'.claude','settings.local.json');
 const settings=await load(settingsPath,{});await save(settingsPath,addHooks(settings,`${quote(process.execPath)} ${quote(target)}`,projectRoot));
 console.log('Project hook installed. Only sessions using the configured Serena Launch MCP server will start sharing. Other projects and chats are not selected.');
}
async function hook(projectRoot){
 let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>1024*1024)throw Error('Hook input too large');}
 const event=JSON.parse(input),project=await realpath(projectRoot||event.cwd||process.cwd());
 const config=await load(join(ROOT,'projects',hash(project)+'.json'),null);if(!config)return;
 if(!event.transcript_path||!event.session_id)return;
 const file=await realpath(event.transcript_path),statePath=join(ROOT,'sessions',hash('claude-code:'+file)+'.json');
 if(event.hook_event_name==='SessionEnd'){await save(statePath+'.stop',{ended:true});return;}
 const prefix=`mcp__${config.server}__`;
 if(typeof event.tool_name!=='string'||!event.tool_name.startsWith(prefix)||!['get_launch_context','search_launch_videos','get_launch_video','report_launch_task'].includes(event.tool_name.slice(prefix.length)))return;
 // Pin to the transcript belonging to this exact session; never list or glob
 // the transcript directory. The child exits on revocation, end, or six hours.
 const priorMetadata=await load(statePath+'.metadata',{reference_ids:[]});
 const reference=event.tool_input?.reference,referenceId=event.tool_response?.structuredContent?.video?.id;
 const referenceIds=/^\d+$/.test(reference||'')?[Number(reference)]:referenceId?[referenceId]:event.tool_input?.reference_ids||[];
 const taskId=event.tool_input?.task_id||event.tool_response?.structuredContent?.task_id;
 await save(statePath+'.metadata',{...(priorMetadata.task_id?{task_id:priorMetadata.task_id}:{}),...(taskId?{task_id:taskId}:{}),reference_ids:[...new Set([...priorMetadata.reference_ids,...referenceIds])].slice(-3)});
 const marker=statePath+'.process',previous=await load(marker,null);
 if(previous){try{process.kill(previous.pid,0);return;}catch{}}
 if((await load(statePath,null))?.finished)return;
 const args=[fileURLToPath(import.meta.url),'record','--client','claude-code','--file',file,'--source-id',event.session_id,...(taskId?['--task-id',taskId]:[]),...(referenceIds.length?['--references',referenceIds.join(',')]:[])];
 const child=spawn(process.execPath,args,{detached:true,stdio:'ignore',env:process.env});child.unref();await save(marker,{pid:child.pid});
}
function flags(args){const values={};for(let i=0;i<args.length;i++){if(args[i]==='--once'){values.once=true;continue;}if(!args[i].startsWith('--')||!args[i+1])throw Error('Invalid arguments');values[args[i].slice(2)]=args[++i];}return values;}
export async function main(args=process.argv.slice(2)){
 const [command,...rest]=args,opts=flags(rest);
 if(command==='connect')return connect(opts.client);
 if(command==='record'){
  if(!opts.file)throw Error('Provide --file pointing to the one native JSONL conversation you want to share');
  return watch({file:resolve(opts.file),client:opts.client,once:!!opts.once,sourceId:opts['source-id'],taskId:opts['task-id'],referenceIds:opts.references?opts.references.split(',').map(Number):[]});
 }
 if(command==='install-claude')return install(resolve(opts.project||'.'),opts.server||'serena-launch');
 if(command==='hook')return hook(opts.project);
 console.log('Optional Serena Launch conversation recorder (Node 22+)\n\nconnect --client claude-code|codex\ninstall-claude --project . [--server serena-launch]\nrecord --client claude-code|codex --file /path/to/selected-session.jsonl [--once]\n\nOnly original visible text from selected sessions is uploaded. Hidden reasoning, images and files are excluded. Message text is stored verbatim and may itself contain sensitive information. Turn sharing off or delete recordings at https://serenatan.org/launchvideo/sharing');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error instanceof ApiError?error.message:'Recorder stopped: '+error.message);process.exitCode=1;});
