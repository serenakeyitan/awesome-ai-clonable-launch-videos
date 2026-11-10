import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{frontendResponse,videoResponse} from './worker.ts';
test('shared UI forwarding strips OAuth query strings and credentials while preserving response policy',async()=>{
 let seen;
 const request=new Request('https://serenatan.org/launchvideo/consent.html?state=private',{headers:{Authorization:'Bearer private',Cookie:'private'}});
 const response=await frontendResponse(request,'/consent',async(url,options)=>{seen={url:String(url),options};return new Response('<html>UI</html>',{headers:{'Content-Type':'text/html','Content-Security-Policy':"default-src 'self'"}});});
 assert.equal(seen.url,'https://serena-portfolio-bzs.pages.dev/consent');assert.ok(!JSON.stringify(seen).includes('private'));assert.equal(seen.options.redirect,'manual');assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Content-Security-Policy'),"default-src 'self'");
});
test('missing frontend yields an explicit error and no alternate page',async()=>{const response=await frontendResponse(new Request('https://serenatan.org/launchvideo/'),'/launch.html',async()=>new Response('missing',{status:404}));assert.equal(response.status,503);assert.equal(response.headers.get('Retry-After'),'10');assert.match(await response.text(),/temporarily unavailable/);});
test('HEAD frontend reads remain empty',async()=>{const response=await frontendResponse(new Request('https://serenatan.org/launchvideo/',{method:'HEAD'}),'/launch.html',async()=>new Response(null,{headers:{'Content-Type':'text/html'}}));assert.equal(await response.text(),'');});
test('video byte ranges preserve seeking and reject unsatisfiable offsets',async()=>{for(const [range,status,expected] of [['bytes=10-19',206,10],['bytes=-10',206,10],['bytes=100-',416,0]]){const response=await videoResponse(new Request('https://serenatan.org/launchvideo/assets/34.mp4',{headers:{Range:range}}),new Response(new Uint8Array(100),{headers:{'Content-Length':'100','Content-Type':'video/mp4'}}),'/assets/34.mp4');assert.equal(response.status,status);assert.equal((await response.arrayBuffer()).byteLength,expected);}});

test('consent refuses an origin without its security policy',async()=>{const response=await frontendResponse(new Request('https://serenatan.org/launchvideo/consent.html'),'/consent',async()=>new Response('<html>UI</html>',{headers:{'Content-Type':'text/html'}}));assert.equal(response.status,503);});
test('public gallery and consent routes use canonical Pages URLs without redirects',async(t)=>{
 const targets=[];
 t.mock.method(globalThis,'fetch',async(url)=>{targets.push(String(url));return new Response('<html>Shared UI</html>',{headers:{'Content-Type':'text/html','Content-Security-Policy':"default-src 'self'"}});});
 const env={ASSETS:{fetch(){throw Error('HTML must use the shared frontend');}}};
 for(const path of ['/launchvideo/','/launchvideo/consent.html?state=private']){const response=await worker.fetch(new Request('https://serenatan.org'+path),env);assert.equal(response.status,200);}
 assert.deepEqual(targets,['https://serena-portfolio-bzs.pages.dev/launch','https://serena-portfolio-bzs.pages.dev/consent']);
});

test('redirecting origins are rejected instead of followed',async()=>{const response=await frontendResponse(new Request('https://serenatan.org/launchvideo/'),'/launch',async(_url,options)=>{assert.equal(options.redirect,'manual');return new Response(null,{status:308,headers:{Location:'https://unrelated.example/'}});});assert.equal(response.status,503);});
test('MP4s are read from the prefixed asset path and keep byte ranges',async()=>{
 const seen=[];
 const env={ASSETS:{async fetch(req){seen.push(new URL(req.url).pathname);return new Response(new Uint8Array(100),{headers:{'Content-Length':'100','Content-Type':'video/mp4'}});}}};
 const response=await worker.fetch(new Request('https://serenatan.org/launchvideo/assets/34.mp4',{headers:{Range:'bytes=0-9'}}),env);
 assert.deepEqual(seen,['/launchvideo/assets/34.mp4']);assert.equal(response.status,206);assert.equal(response.headers.get('Content-Range'),'bytes 0-9/100');
});
function fakeBucket(size){
 const etag='"r2etag"';
 const meta={size,httpEtag:etag,uploaded:new Date(0)};
 return {calls:[],async head(){return meta;},async get(key,opts){this.calls.push(key);const m=opts?.range?.get('range')?.match(/^bytes=(\d*)-(\d*)$/);if(!m)return{...meta,body:new Response(new Uint8Array(size)).body};
  let range;if(!m[1])range={suffix:Number(m[2])};else{const off=Number(m[1]);if(off>=size)return{...meta,range:{offset:0,length:size},body:new Response(new Uint8Array(size)).body};range=m[2]?{offset:off,length:Math.min(size-1,Number(m[2]))-off+1}:{offset:off};}
  const off=range.suffix!==undefined?size-range.suffix:range.offset;const len=range.suffix??range.length??size-off;return{...meta,range,body:new Response(new Uint8Array(len)).body};}};
}
test('MP4s come from R2 with native ranges, If-Range and 416 handling',async()=>{
 const bucket=fakeBucket(100);const env={MEDIA:bucket,ASSETS:{fetch(){throw Error('assets must not serve R2 media');}}};
 const get=(h)=>worker.fetch(new Request('https://serenatan.org/launchvideo/assets/34.mp4',{headers:h}),env);
 let r=await get({Range:'bytes=10-19'});assert.equal(r.status,206);assert.equal(r.headers.get('Content-Range'),'bytes 10-19/100');assert.equal((await r.arrayBuffer()).byteLength,10);
 r=await get({Range:'bytes=-10'});assert.equal(r.status,206);assert.equal(r.headers.get('Content-Range'),'bytes 90-99/100');
 r=await get({Range:'bytes=90-'});assert.equal(r.headers.get('Content-Range'),'bytes 90-99/100');assert.equal(r.headers.get('Content-Length'),'10');
 r=await get({Range:'bytes=100-'});assert.equal(r.status,416);assert.equal(r.headers.get('Content-Range'),'bytes */100');
 r=await get({Range:'bytes=0-9','If-Range':'"stale"'});assert.equal(r.status,200);assert.equal(r.headers.get('Content-Length'),'100');
 r=await get({});assert.equal(r.status,200);assert.equal(r.headers.get('Content-Type'),'video/mp4');assert.equal(r.headers.get('Accept-Ranges'),'bytes');
 assert.deepEqual(new Set(bucket.calls),new Set(['assets/34.mp4']));
});
test('a video missing from R2 falls back to the asset copy',async()=>{
 const env={MEDIA:{async head(){return null;},async get(){return null;}},ASSETS:{async fetch(){return new Response(new Uint8Array(100),{headers:{'Content-Length':'100','Content-Type':'video/mp4'}});}}};
 const r=await worker.fetch(new Request('https://serenatan.org/launchvideo/assets/34.mp4',{headers:{Range:'bytes=0-9'}}),env);assert.equal(r.status,206);assert.equal(r.headers.get('Content-Range'),'bytes 0-9/100');
});
