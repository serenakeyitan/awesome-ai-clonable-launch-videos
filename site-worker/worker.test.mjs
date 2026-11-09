import test from 'node:test';
import assert from 'node:assert/strict';
import {frontendResponse,videoResponse} from './worker.ts';
test('shared UI forwarding strips OAuth query strings and credentials while preserving response policy',async()=>{
 let seen;
 const request=new Request('https://serenatan.org/launchvideo/consent.html?state=private',{headers:{Authorization:'Bearer private',Cookie:'private'}});
 const response=await frontendResponse(request,'/consent.html',async(url,options)=>{seen={url:String(url),options};return new Response('<html>UI</html>',{headers:{'Content-Type':'text/html','Content-Security-Policy':"default-src 'self'"}});});
 assert.equal(seen.url,'https://serenatan.org/consent.html');assert.ok(!JSON.stringify(seen).includes('private'));assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Content-Security-Policy'),"default-src 'self'");
});
test('missing frontend yields an explicit error and no alternate page',async()=>{const response=await frontendResponse(new Request('https://serenatan.org/launchvideo/'),'/launch.html',async()=>new Response('missing',{status:404}));assert.equal(response.status,503);assert.equal(response.headers.get('Retry-After'),'10');assert.match(await response.text(),/temporarily unavailable/);});
test('HEAD frontend reads remain empty',async()=>{const response=await frontendResponse(new Request('https://serenatan.org/launchvideo/',{method:'HEAD'}),'/launch.html',async()=>new Response(null,{headers:{'Content-Type':'text/html'}}));assert.equal(await response.text(),'');});
test('video byte ranges preserve seeking and reject unsatisfiable offsets',async()=>{for(const [range,status,expected] of [['bytes=10-19',206,10],['bytes=-10',206,10],['bytes=100-',416,0]]){const response=await videoResponse(new Request('https://serenatan.org/launchvideo/assets/34.mp4',{headers:{Range:range}}),new Response(new Uint8Array(100),{headers:{'Content-Length':'100','Content-Type':'video/mp4'}}),'/assets/34.mp4');assert.equal(response.status,status);assert.equal((await response.arrayBuffer()).byteLength,expected);}});
