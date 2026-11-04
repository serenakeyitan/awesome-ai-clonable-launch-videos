import assert from 'node:assert/strict';
import {Client as Modern, StreamableHTTPClientTransport as ModernHTTP} from '@modelcontextprotocol/client';
import {Client as Legacy} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport as LegacyHTTP} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const url = process.argv[2] ?? 'https://serenatan.org/launchvideo/mcp';
for (const [name, Client, Transport] of [['modern',Modern,ModernHTTP],['legacy',Legacy,LegacyHTTP]]) {
 const c = new Client({name:`launch-archive-${name}-verification`,version:'1.0.0'});
 try {
  await c.connect(new Transport(new URL(url)));
  const tools=await c.listTools();assert.equal(tools.tools.length,3);
  const initial=await c.callTool({name:'get_launch_context',arguments:{}});assert.ok(!initial.isError,initial.content?.[0]?.text);const context=initial.structuredContent;
  assert.ok(context.totalVideos>0);assert.ok(Array.isArray(context.facets.styles));
  const search=(await c.callTool({name:'search_launch_videos',arguments:{limit:1}})).structuredContent;
  assert.equal(search.videos.length,1);
  const detail=(await c.callTool({name:'get_launch_video',arguments:{reference:String(search.videos[0].id)}})).structuredContent;
  assert.equal(detail.video.id,search.videos[0].id);assert.equal(detail.video.remakePrompt,`clone this video 1:1 for my product ${detail.video.source}`);assert.ok(detail.video.githubVideoUrl.includes('github.com/user-attachments/'));
  const again=(await c.callTool({name:'get_launch_context',arguments:{}})).structuredContent;
  assert.equal(again.version,context.version);assert.notEqual(again.fetchedAt,context.fetchedAt);
  console.log(JSON.stringify({client:name,tools:tools.tools.map(t=>t.name),videos:context.totalVideos,version:context.version,latestVideo:detail.video.title,freshFetchOnSameConnection:true}));
 } finally {await c.close();}
}
