// Opt-in manual production QA: posts the owner's temporary test video.
// Requires a protected local OAuth token and explicit authorization to publish.
import {readFile,writeFile,stat} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
const token=(await readFile(process.env.LAUNCH_ARCHIVE_TOKEN_FILE,'utf8')).trim();
const client=new Client({name:'community-production-qa',version:'1.0.0'});
const videoPath=process.env.COMMUNITY_QA_VIDEO,coverPath=process.env.COMMUNITY_QA_COVER;
if(process.env.COMMUNITY_QA_PUBLIC_POST!=='authorized')throw Error('Explicit test publication authorization required');
const task=crypto.randomUUID();
const call=async(name,args)=>{const reply=await client.callTool({name,arguments:args});if(reply.isError)throw Error(`Tool failed: ${name}`);return reply.structuredContent;};
try{
 await client.connect(new StreamableHTTPClientTransport(new URL('https://serenatan.org/launchvideo/mcp'),{requestInit:{headers:{Authorization:`Bearer ${token}`,'X-Serena-Analytics-Test':'1'}}}));
 const tools=await client.listTools();assert.equal(tools.tools.length,6);
 const context=await call('get_launch_context',{});assert.match(context.workflow,/ask once/i);
 await call('report_launch_task',{status:'started',task_id:task,reference_ids:[87]});
 const complete=await call('report_launch_task',{status:'completed',task_id:task,reference_ids:[87],checks:{html:false,source:false,mp4:true,music:true,playback:false,download:false}});
 assert.match(complete.community_offer.question,/extra exposure/);
 const args={title:'Temporary Community QA — Coach',creator_name:'Serena Launch QA',description:'Temporary production test; removed after upload, playback, replacement and deletion checks.',reference_ids:[87],user_confirmed:true,task_id:task,video_bytes:(await stat(videoPath)).size,cover_bytes:(await stat(coverPath)).size,cover_type:'image/jpeg'};
 const upload=await call('create_community_upload',args);
 await writeFile('/tmp/serena-community-qa-post.json',JSON.stringify({post_id:upload.post_id,upload_id:upload.upload_id,task_id:task}),{mode:0o600});
 assert.equal((await fetch(`https://serenatan.org/launchvideo/community/media/${upload.upload_id}/video`)).status,404);
 for(const [path,url,type] of [[videoPath,upload.video_upload_url,'video/mp4'],[coverPath,upload.cover_upload_url,'image/jpeg']]){
  const bytes=await readFile(path),response=await fetch(url,{method:'PUT',headers:{'Content-Type':type,'Content-Length':String(bytes.length)},body:bytes});assert.equal(response.status,200);
 }
 const published=await call('publish_community_video',{upload_id:upload.upload_id});assert.equal(published.published,true);
 const duplicate=await call('create_community_upload',args);assert.equal(duplicate.already_published,true);
 const feed=await (await fetch('https://serenatan.org/launchvideo/community/posts')).json();assert.equal(feed.posts.filter(p=>p.id===published.post.id).length,1);
 const response=await fetch('https://serenatan.org'+published.post.media_url),remote=Buffer.from(await response.arrayBuffer()),local=await readFile(videoPath);
 assert.equal(response.status,200);assert.equal(createHash('sha256').update(remote).digest('hex'),createHash('sha256').update(local).digest('hex'));
 const range=await fetch('https://serenatan.org'+published.post.media_url,{headers:{Range:'bytes=0-1023'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,1024);
 await writeFile('/tmp/serena-community-qa-post.json',JSON.stringify({post_id:published.post.id,upload_id:upload.upload_id,task_id:task,post:published.post}),{mode:0o600});
 console.log(JSON.stringify({tools:tools.tools.length,completionOffer:complete.community_offer.question,unpublishedMedia:404,actualFileBytes:remote.length,sha256Matches:true,range:206,retryDeduplicated:true,postId:published.post.id,shareUrl:published.post.url}));
}finally{await client.close();}
