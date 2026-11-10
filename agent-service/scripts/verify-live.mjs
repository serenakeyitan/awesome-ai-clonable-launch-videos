import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Client as Modern, StreamableHTTPClientTransport as ModernHTTP} from '@modelcontextprotocol/client';
import {Client as Legacy} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport as LegacyHTTP} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const url = process.argv[2] ?? 'https://serenatan.org/launchvideo/mcp';
// Optional protected local token file for the authenticated rollout. Never put
// tokens in command arguments, console output or source control.
const tokenFile = process.env.LAUNCH_ARCHIVE_TOKEN_FILE;
const token = tokenFile ? (await readFile(tokenFile,'utf8')).trim() : null;
const transportOptions = token ? {requestInit:{headers:{Authorization:`Bearer ${token}`}}} : undefined;
for (const [name, Client, Transport] of [['modern',Modern,ModernHTTP],['legacy',Legacy,LegacyHTTP]]) {
 const c = new Client({name:`launch-archive-${name}-verification`,version:'1.0.0'});
 try {
  await c.connect(new Transport(new URL(url),transportOptions));
  const tools=await c.listTools();assert.equal(tools.tools.length,4);
  const initial=await c.callTool({name:'get_launch_context',arguments:{}});assert.ok(!initial.isError,initial.content?.[0]?.text);const context=initial.structuredContent;
  assert.ok(context.totalVideos>0);assert.ok(Array.isArray(context.facets.styles));
  const search=(await c.callTool({name:'search_launch_videos',arguments:{limit:1}})).structuredContent;
  assert.equal(search.videos.length,1);
  const detail=(await c.callTool({name:'get_launch_video',arguments:{reference:String(search.videos[0].id)}})).structuredContent;
  assert.equal(detail.video.id,search.videos[0].id);assert.equal(detail.video.remakePrompt,`Remake this video's motion and vibe for my product: ${detail.video.source}`);assert.ok(detail.video.githubVideoUrl.includes('github.com/user-attachments/'));
  const again=(await c.callTool({name:'get_launch_context',arguments:{}})).structuredContent;
  assert.equal(again.version,context.version);assert.notEqual(again.fetchedAt,context.fetchedAt);
  console.log(JSON.stringify({client:name,tools:tools.tools.map(t=>t.name),videos:context.totalVideos,version:context.version,latestVideo:detail.video.title,freshFetchOnSameConnection:true}));
 } finally {await c.close();}
}

if (token) {
 const base=new URL('/launchvideo/agent/',url);
 for(const path of ['manifest.json','catalog.json','workflow.md']) {
  const endpoint=new URL(path,base);
  for(const method of ['GET','HEAD']) {
   const anonymous=await fetch(endpoint,{method});
   assert.equal(anonymous.status,401);assert.ok(anonymous.headers.get('WWW-Authenticate'));
  }
  const authorized=await fetch(endpoint,{headers:{Authorization:`Bearer ${token}`}});
  assert.equal(authorized.status,200);assert.match(authorized.headers.get('Cache-Control'),/no-store/);
  if(path==='workflow.md')assert.match(await authorized.text(),/^# Serena Launch workflow/);
  else {
   const data=await authorized.json();assert.ok(data.totalVideos>0);assert.ok(data.workflow);
   if(path==='catalog.json')assert.equal(data.videos.length,data.totalVideos);
  }
 }
 const skill=await fetch(new URL('SKILL.md',base));assert.equal(skill.status,200);
 const text=await skill.text();assert.match(text,/401\/403, stop and guide connection or reauthorization/);
 assert.doesNotMatch(text,/If MCP is unsupported or unavailable, fetch/);
 console.log(JSON.stringify({authenticatedHttpRoutes:3,anonymousAgentRoutes:401,publicConnectionGuide:200}));
}
