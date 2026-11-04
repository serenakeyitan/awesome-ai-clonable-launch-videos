import test from 'node:test';
import assert from 'node:assert/strict';
import {Client, InMemoryTransport} from '@modelcontextprotocol/client';
import {Client as LegacyClient} from '@modelcontextprotocol/sdk/client/index.js';
import {createServer} from '../worker.mjs';
import {loadArchive, publicManifest} from '../catalog.mjs';

function fixture() {
  const state = {
    revision:'a'.repeat(40), wrapped:false,
    videos:[{id:1,slug:'original',title:'Original reference',account:'@creator',category:'AI launch',styles:['UI motion'],ratio:'16:9',source:'https://x.com/creator/status/123',date:'2026-11-03',snapshotDate:'2026-11-03',impressions:100,views:null,poster:'previews/original.jpg',watchUrl:'https://serenatan.org/launchvideo/assets/01.mp4',notes:['Original note']}],
    manifest:{schemaVersion:1,formats:[{id:'ui',name:'UI'}],workflowUrl:'https://serenatan.org/launchvideo/agent/workflow.md',catalogUrl:'https://serenatan.org/launchvideo/agent/catalog.json',skillUrl:'https://serenatan.org/launchvideo/agent/SKILL.md',mcpUrl:'https://serenatan.org/launchvideo/mcp'},
    workflow:'Original workflow'
  };
  const fetcher = async url => {
    if(url.includes('info/refs'))return new Response(`003f${state.revision} refs/heads/main\n`);
    if(url.endsWith('videos.json'))return Response.json(state.wrapped?{schemaVersion:1,collection:{groupBy:'format'},videos:state.videos}:state.videos);
    if(url.endsWith('manifest.json'))return Response.json(state.manifest);
    return new Response(state.workflow);
  };
  return {state,load:()=>loadArchive(fetcher)};
}

for (const [name, ClientType] of [['modern',Client],['legacy',LegacyClient]]) {
  test(`${name}: an old connection receives additions, edits, new metadata and a catalog envelope`, async () => {
    const f=fixture();const server=createServer(f.load);
    const client=new ClientType({name:'unchanged-installed-client',version:'0.1.0'},{capabilities:{}});
    const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
    try{
      const toolsBefore=await client.listTools();
      const initial=(await client.callTool({name:'get_launch_video',arguments:{reference:'1'}})).structuredContent;
      assert.equal(initial.video.title,'Original reference');
      f.state.videos[0]={...f.state.videos[0],title:'Updated reference',views:250,watchUrl:'https://serenatan.org/launchvideo/assets/revised.mp4',styles:['New editorial style'],hookAnalysis:{opening:'A new product hook',durationSeconds:2}};
      f.state.videos.push({...f.state.videos[0],id:2,slug:'added-reference',title:'New reference',source:'https://x.com/creator/status/456'});
      f.state.manifest.formats.push({id:'new-format',name:'New format',layout:{sceneCount:4}});
      f.state.manifest.rendering={preferredEngine:'Remotion',delivery:['editable source','MP4']};
      f.state.workflow='Updated workflow: use the newly published hookAnalysis and format layout.';
      f.state.wrapped=true;f.state.revision='b'.repeat(40);
      const edited=(await client.callTool({name:'get_launch_video',arguments:{reference:'1'}})).structuredContent;
      assert.equal(edited.video.title,'Updated reference');assert.equal(edited.video.views,250);
      assert.equal(edited.video.watchUrl,'https://serenatan.org/launchvideo/assets/revised.mp4');
      assert.ok(edited.video.poster.includes('/'+'b'.repeat(40)+'/'));
      assert.deepEqual(edited.video.additionalMetadata.hookAnalysis,{opening:'A new product hook',durationSeconds:2});
      assert.equal(edited.catalogMetadata.collection.groupBy,'format');
      assert.equal(edited.manifest.rendering.preferredEngine,'Remotion');
      assert.deepEqual(edited.facets.formats.at(-1).layout,{sceneCount:4});
      assert.equal(edited.workflow,f.state.workflow);assert.notEqual(edited.version,initial.version);
      const added=(await client.callTool({name:'get_launch_video',arguments:{reference:'2'}})).structuredContent;
      assert.equal(added.video.title,'New reference');assert.equal(added.totalVideos,2);
      const found=(await client.callTool({name:'search_launch_videos',arguments:{style:'New editorial style'}})).structuredContent;
      assert.equal(found.totalMatches,2);assert.deepEqual((await client.listTools()).tools,toolsBefore.tools);
      f.state.videos.shift();f.state.revision='c'.repeat(40);
      const removed=(await client.callTool({name:'get_launch_video',arguments:{reference:'1'}})).structuredContent;
      assert.equal(removed.found,false);assert.equal(removed.video,null);assert.equal(removed.totalVideos,1);
    }finally{await client.close();await server.close();}
  });
}

test('HTTP discovery exposes current links and arbitrary additive manifest fields at the root',async()=>{
  const f=fixture();f.state.manifest.rendering={engine:'New engine'};
  const m=publicManifest(await f.load());
  assert.equal(m.workflowUrl,f.state.manifest.workflowUrl);assert.equal(m.catalogUrl,f.state.manifest.catalogUrl);
  assert.equal(m.skillUrl,f.state.manifest.skillUrl);assert.equal(m.mcpUrl,f.state.manifest.mcpUrl);
  assert.deepEqual(m.rendering,{engine:'New engine'});assert.deepEqual(m.manifest.rendering,m.rendering);
});

test('an unsupported breaking manifest version fails explicitly instead of serving an old catalog',async()=>{
  const f=fixture();await f.load();f.state.manifest.schemaVersion=99;
  await assert.rejects(f.load(),/schema unavailable/);
});
