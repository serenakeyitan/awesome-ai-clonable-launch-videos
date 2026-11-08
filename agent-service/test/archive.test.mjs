import test from 'node:test';
import assert from 'node:assert/strict';
import {Client, InMemoryTransport} from '@modelcontextprotocol/client';
import {createServer} from '../worker.mjs';
import {loadArchive, search, findVideo, record, readBounded} from '../catalog.mjs';

function fixture() {
  const state = {videos:[{id:1, slug:'demo', title:'Demo UI', account:'@demo', category:'AI launch', styles:['UI motion'], ratio:'16:9', source:'https://x.com/demo/status/123', date:'2026-11-03', snapshotDate:'2026-11-03', impressions:100, views:null, poster:'previews/demo.jpg', watchUrl:'https://serenatan.org/launchvideo/assets/01.mp4', notes:['A cursor moves.']}], manifest:{schemaVersion:1,formats:[{id:'ui',name:'UI'}]}, workflow:'First workflow'};
  state.revision = 'a'.repeat(40);
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({url,options});
    if (url.includes('info/refs')) return new Response(`003f${state.revision} refs/heads/main\n`);
    return new Response(url.includes('videos.json') ? JSON.stringify(state.videos) : url.includes('manifest.json') ? JSON.stringify(state.manifest) : state.workflow);
  };
  return {state,requests,load:() => loadArchive(fetcher)};
}

test('an existing MCP connection sees new videos, formats and workflow without reinstalling', async () => {
  const f = fixture();
  const server = createServer(f.load);
  const client = new Client({name:'returning-user-test',version:'1.0.0'});
  const [a,b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try {
    const toolsBefore = await client.listTools();
    assert.equal(toolsBefore.tools.length,3);
    for (const tool of toolsBefore.tools) {
      assert.equal(typeof tool.title,'string');
      assert.ok(tool.title.length > 0);
      assert.equal(tool.annotations.title,tool.title);
      assert.equal(tool.annotations.readOnlyHint,true);
      assert.equal(tool.annotations.destructiveHint,false);
      assert.equal(tool.annotations.idempotentHint,true);
      assert.equal(tool.annotations.openWorldHint,true);
    }
    const before = (await client.callTool({name:'get_launch_context',arguments:{}})).structuredContent;
    assert.equal(before.totalVideos,1);
    f.state.videos.push({...f.state.videos[0],id:2,slug:'new-demo',title:'Fresh illustrated launch',styles:['New style'],source:'https://x.com/demo/status/456'});
    f.state.manifest.formats.push({id:'fresh-format',name:'Fresh format'});
    f.state.workflow = 'Updated workflow from the owner';
    f.state.revision = 'b'.repeat(40);
    const after = (await client.callTool({name:'search_launch_videos',arguments:{style:'New style'}})).structuredContent;
    assert.equal(after.totalVideos,2);
    assert.equal(after.videos[0].id,2);
    assert.equal(after.workflow,f.state.workflow);
    assert.ok(after.facets.styles.includes('New style'));
    assert.ok(after.facets.formats.some(v=>v.id==='fresh-format'));
    assert.notEqual(before.version,after.version);
    assert.deepEqual((await client.listTools()).tools,toolsBefore.tools);
    assert.equal(f.requests.length,8);
    assert.ok(f.requests.slice(1,4).every(r=>r.url.includes('/'+ 'a'.repeat(40)+'/')));
    assert.ok(f.requests.slice(5,8).every(r=>r.url.includes('/'+ 'b'.repeat(40)+'/')));
    assert.notEqual(f.requests[1].url,f.requests[5].url);
    assert.ok(f.requests.every(r=>r.options.cache==='no-store'));
  } finally {await client.close();await server.close();}
});

test('search preserves missing metrics, bounded results and canonical source lookup', async () => {
  const f = fixture(); const a = await f.load();
  assert.equal(search(a,{query:'cursor'}).totalMatches,1);
  assert.equal(search(a,{query:'nonexistent'}).totalMatches,0);
  assert.equal(search(a,{style:'new style'}).totalMatches,0);
  assert.equal(record(a.videos[0]).views,null);
  assert.equal(findVideo(a,'https://twitter.com/demo/status/123/video/1?s=46').id,1);
  assert.equal(findVideo(a,'https://evil.example/private'),undefined);
  assert.equal(record(a.videos[0]).remakePrompt,'clone this video 1:1 for my product https://x.com/demo/status/123');
});

test('upstream failures and oversized bodies never return a stale snapshot', async () => {
  const f = fixture(); await f.load();
  await assert.rejects(loadArchive(async()=>new Response('down',{status:503})), /unavailable/);
  await assert.rejects(readBounded(new Response('oversized'),3), /size limit/);
  const server = createServer(()=>loadArchive(async()=>new Response('down',{status:503})));
  const client = new Client({name:'failure-test',version:'1.0.0'});
  const [a,b] = InMemoryTransport.createLinkedPair(); await server.connect(a);await client.connect(b);
  try {
    const error = await client.callTool({name:'get_launch_context',arguments:{}});
    assert.equal(error.isError,true);
    assert.match(error.content[0].text,/unavailable/);
    const invalid = await client.callTool({name:'search_launch_videos',arguments:{limit:1000}});
    assert.equal(invalid.isError,true);
  } finally {await client.close();await server.close();}
});
