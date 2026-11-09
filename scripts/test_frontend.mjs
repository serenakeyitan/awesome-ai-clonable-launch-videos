import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SourceTextModule,createContext} from 'node:vm';

async function boot(file) {
  const nodes=new Map();
  function node(selector) {
    const key=selector.startsWith('#')?selector.slice(1):selector;
    if(!nodes.has(key))nodes.set(key,{value:key==='search'?'':key==='sort'?'impressions':'all',dataset:{},innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}},addEventListener(){},setAttribute(){},pause(){}});
    return nodes.get(key);
  }
  const video={id:3,title:'Test reference',account:'test',date:'2026-11-09',category:'Demo',styles:['UI motion'],notes:[],originalNotes:[],video:'https://serenatan.org/launchvideo/assets/03.mp4',poster:'https://example.com/poster.jpg',clipSeconds:12,originalSeconds:12,impressions:1};
  const context=createContext({document:{querySelector:node,getElementById:id=>node('#'+id),querySelectorAll:()=>[],addEventListener(){}},location:{href:'https://serenatan.org/launchvideo/',hash:''},URL,URLSearchParams,setTimeout,clearTimeout,console,
    fetch:async url=>({ok:true,json:async()=>url==='videos.json'?[video]:{timeZone:'America/Los_Angeles',snapshots:[]}})});
  const module=new SourceTextModule(await readFile(new URL('../site/'+file,import.meta.url),'utf8'),{context,
    importModuleDynamically:async()=>{throw new Error('Analytics module 404 (regression fixture)');}});
  await module.link(async specifier=>{
    if(specifier==='./daily-stats.mjs')return new SourceTextModule(await readFile(new URL('../site/daily-stats.mjs',import.meta.url),'utf8'),{context});
    throw new Error('Analytics module 404 (regression fixture)');
  });
  await module.evaluate();
  for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));
  return nodes;
}

test('video collection renders when the analytics module is missing',async()=>{
  const nodes=await boot('app.js');
  assert.match(nodes.get('collection').innerHTML,/Test reference/);
  assert.match(nodes.get('collection').innerHTML,/video-card/);
  assert.equal(nodes.get('total-videos').textContent,1);
});
test('desktop quick connect still initializes when analytics is missing',async()=>{
  const nodes=await boot('connect.js');
  assert.match(nodes.get('[data-client="claude"]').href,/^claude:\/\/claude.ai\/new\?/);
  assert.match(nodes.get('[data-client="claude-code"]').href,/^claude:\/\/code\/new\?/);
  assert.match(nodes.get('[data-client="codex"]').href,/^codex:\/\/new\?/);
});
