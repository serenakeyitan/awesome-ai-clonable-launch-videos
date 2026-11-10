import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseTranscript,batches,addHooks,syncFile} from '../../agent/recorder.mjs';
const text='  中文 🍿\n\n**text**\t  ';
const claude=[{type:'user',uuid:'u',sessionId:'selected-session',message:{content:[{type:'text',text},{type:'image',source:{data:'DO_NOT_UPLOAD'}}]}},{type:'assistant',uuid:'a',message:{content:[{type:'thinking',thinking:'HIDDEN'},{type:'text',text:'Reply\n'}]}},{type:'assistant',uuid:'side',isSidechain:true,message:{content:'other agent'}},{type:'system',content:'hidden system'}];
const fileBytes=events=>Buffer.from(events.map(e=>JSON.stringify(e)).join('\n')+'\n');
test('Claude adapter preserves every character and excludes hidden data and side branches',()=>{
 const result=parseTranscript(fileBytes(claude),'claude-code');assert.equal(result.messages.length,2);assert.equal(result.messages[0].content[0].text,text);assert.equal(result.sourceSession,'selected-session');assert.equal(result.attachments,true);
 for(const secret of ['DO_NOT_UPLOAD','HIDDEN','hidden system','other agent'])assert.ok(!JSON.stringify(result.messages).includes(secret));
 const incomplete=Buffer.concat([fileBytes(claude),Buffer.from('{"type":"user","text":"🍿')]);assert.equal(parseTranscript(incomplete,'claude-code').hasPartialLine,true);assert.equal(parseTranscript(incomplete,'claude-code').messages.length,2);
 assert.throws(()=>parseTranscript(Buffer.from('broken\n'),'claude-code'),/nothing was skipped/);
});
test('Codex reads original messages, not duplicate event summaries or reasoning',()=>{
 const bytes=fileBytes([{type:'session_meta',payload:{id:'codex-session'}},{type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}]}},{type:'event_msg',payload:{type:'user_message',message:text}},{type:'response_item',payload:{type:'reasoning',summary:[{text:'HIDDEN'}]}},{type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'Answer'}]}}]);
 const parsed=parseTranscript(bytes,'codex');assert.equal(parsed.messages.length,2);assert.equal(parsed.messages[0].content[0].text,text);assert.equal(parsed.sourceSession,'codex-session');assert.ok(!JSON.stringify(parsed).includes('HIDDEN'));
});
test('hook installation preserves existing hooks and is idempotent',()=>{
 const existing={permissions:{allow:['Read']},hooks:{PostToolUse:[{matcher:'Bash',hooks:[{type:'command',command:'my-existing-hook'}]}]}};
 const first=addHooks(existing,"node '/safe/serena-recorder.mjs'",'/my project');assert.deepEqual(addHooks(first,"node '/safe/serena-recorder.mjs'",'/my project'),first);assert.equal(first.hooks.PostToolUse.length,2);assert.deepEqual(first.permissions,existing.permissions);assert.match(first.hooks.PostToolUse[1].hooks[0].command,/--project '\/my project'/);
});
test('network-loss retries preserve exact pending text and reject rewritten history',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'serena-recorder-test-'));const file=join(dir,'fixture.jsonl'),path=join(dir,'state.json');
 try{
  await writeFile(file,fileBytes(claude));const state={path,seq:0,messages:0};let attempts=0,drop=true;const payloads=[];
  const send=async(route,options)=>{if(route==='/device')return{approved:true,enabled:true};if(route==='/sessions')return{session_id:crypto.randomUUID(),last_seq:0};attempts++;payloads.push(options.body);if(drop){drop=false;throw Error('network disconnected');}return{seq:options.body.seq,sha256:options.body.sha256};};
  await assert.rejects(syncFile({file,client:'claude-code',state,token:'fixture',send}),/network/);assert.equal(JSON.parse(await readFile(path,'utf8')).pending.messages[0].content[0].text,text);
  await syncFile({file,client:'claude-code',state,token:'fixture',send});assert.equal(attempts,2);assert.deepEqual(payloads[0],payloads[1]);assert.equal(state.messages,2);assert.equal(state.seq,1);
  await syncFile({file,client:'claude-code',state,token:'fixture',send});assert.equal(attempts,2);
  await writeFile(file,fileBytes([{...claude[0],uuid:'rewritten'}]));await assert.rejects(syncFile({file,client:'claude-code',state,token:'fixture',send}),/history changed/);
  assert.throws(()=>batches([{content:[{text:'x'.repeat(500000)}]}]),/not been truncated/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('a final JSONL line without newline is preserved; invalid UTF-8 fails explicitly',()=>{
 const bytes=Buffer.from(JSON.stringify(claude[0]));
 assert.equal(parseTranscript(bytes,'claude-code').hasPartialLine,true);
 const final=parseTranscript(bytes,'claude-code',true);assert.equal(final.messages[0].content[0].text,text);assert.equal(final.completeBytes,bytes.length);assert.equal(final.hasPartialLine,false);
 assert.throws(()=>parseTranscript(Buffer.from([0xff,10]),'claude-code'),/encoded data/);
});
test('native ask-user tool questions and human selections are retained',()=>{
 const q={questions:[{question:'时长？',options:[{label:'15 秒'},{label:'30 秒'}]}]},answer='用户选择：30 秒 🍿';
 const c=parseTranscript(fileBytes([{type:'assistant',message:{content:[{type:'tool_use',id:'ask1',name:'AskUserQuestion',input:q}]}},{type:'user',message:{content:[{type:'tool_result',tool_use_id:'ask1',content:answer},{type:'tool_result',tool_use_id:'unrelated',content:'NOT_CHAT'}]}}]),'claude-code');
 assert.deepEqual(JSON.parse(c.messages[0].content[0].text),q);assert.equal(c.messages[1].content[0].text,answer);assert.ok(!JSON.stringify(c).includes('NOT_CHAT'));
 const d=parseTranscript(fileBytes([{type:'response_item',payload:{type:'function_call',name:'request_user_input',call_id:'ask2',arguments:JSON.stringify(q)}},{type:'response_item',payload:{type:'function_call_output',call_id:'ask2',output:answer}}]),'codex');
 assert.equal(d.messages[1].content[0].text,answer);
});
