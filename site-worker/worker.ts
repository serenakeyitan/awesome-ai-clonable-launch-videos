import VIDEO_SIZES from './asset-sizes.json' with {type:'json'};
interface MediaObject {size:number;httpEtag:string;uploaded:Date;range?:{offset?:number;length?:number;suffix?:number};body?:ReadableStream}
interface MediaBucket {head(key:string):Promise<MediaObject|null>;get(key:string,options?:{range:Headers}):Promise<MediaObject|null>}
interface Env {ASSETS:{fetch(request:Request):Promise<Response>};MEDIA?:MediaBucket}
const SIZES:Record<string,number>=VIDEO_SIZES;

const BASE_PATH = '/launchvideo';

export async function videoResponse(request:Request, response:Response, assetPath:string):Promise<Response> {
  const total = Number(response.headers.get('content-length') || SIZES[assetPath]);
  const knownMp4 = Object.hasOwn(SIZES, assetPath);
  if (response.status !== 200 || (!knownMp4 && !response.headers.get('content-type')?.startsWith('video/')) || !Number.isSafeInteger(total) || total <= 0) return response;

  const headers = new Headers(response.headers);
  if (knownMp4) headers.set('Content-Type', 'video/mp4');
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Length', String(total));
  const rangeHeader = request.headers.get('range');
  const match = rangeHeader?.match(/^bytes=(\d*)-(\d*)$/);
  const ifRange = request.headers.get('if-range');
  const validatorMatches = !ifRange || ifRange === response.headers.get('etag') || ifRange === response.headers.get('last-modified');
  if (request.method !== 'GET' || !match || (!match[1] && !match[2]) || !validatorMatches || !response.body) {
    return new Response(response.body, { status: response.status, headers });
  }

  const start = match[1] ? Number(match[1]) : Math.max(0, total - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(total - 1, Number(match[2])) : total - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= total || start > end || (!match[1] && Number(match[2]) === 0)) {
    await response.body.cancel();
    headers.set('Content-Range', `bytes */${total}`);
    headers.set('Content-Length', '0');
    return new Response(null, { status: 416, headers });
  }

  const reader = response.body.getReader();
  let offset = 0;
  const body = new ReadableStream({
    async pull(controller) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { controller.close(); return; }
        const chunkStart = offset;
        offset += value.byteLength;
        if (offset <= start) continue;
        const chunk = value.subarray(Math.max(0, start - chunkStart), Math.min(value.byteLength, end + 1 - chunkStart));
        if (chunk.byteLength) controller.enqueue(chunk);
        if (offset > end) {
          controller.close();
          await reader.cancel();
        }
        return;
      }
    },
    cancel(reason) { return reader.cancel(reason); }
  });
  headers.set('Content-Range', `bytes ${start}-${end}/${total}`);
  headers.set('Content-Length', String(end - start + 1));
  return new Response(body, { status: 206, headers });
}

// MP4s are read from R2, which slices byte ranges natively. Slicing the asset
// stream in JS cost 20-300 ms CPU per request, past the Workers Free 10 ms
// limit. Returns null when the object is missing so the asset copy serves.
export async function mediaResponse(request:Request, bucket:MediaBucket, key:string):Promise<Response|null> {
  const range = request.method === 'GET' ? request.headers.get('range') : null;
  const ifRange = request.headers.get('if-range');
  let head:MediaObject|null = null;
  let useRange = Boolean(range);
  if (useRange && ifRange) {
    head = await bucket.head(key);
    if (!head) return null;
    useRange = ifRange === head.httpEtag;
  }
  let object:MediaObject|null;
  try {
    object = request.method === 'HEAD' ? await bucket.head(key) : await bucket.get(key, useRange ? { range: request.headers } : undefined);
  } catch {
    head ??= await bucket.head(key);
    if (!head) return null;
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${head.size}`, 'Content-Length': '0' } });
  }
  if (!object) return null;
  const size = object.size;
  const start = useRange ? range!.match(/^bytes=(\d+)-/)?.[1] : undefined;
  if (start !== undefined && Number(start) >= size || useRange && /^bytes=-0+$/.test(range!)) {
    await object.body?.cancel();
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}`, 'Content-Length': '0' } });
  }
  const headers = new Headers({
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    'ETag': object.httpEtag,
    'Last-Modified': object.uploaded.toUTCString(),
    'Cache-Control': 'public, max-age=86400'
  });
  const r = useRange ? object.range : undefined;
  if (r && (r.suffix !== undefined || r.offset !== undefined)) {
    const offset = r.suffix !== undefined ? Math.max(0, size - r.suffix) : r.offset!;
    const length = r.suffix !== undefined ? size - offset : (r.length ?? size - offset);
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${size}`);
    headers.set('Content-Length', String(length));
    return new Response(object.body ?? null, { status: 206, headers });
  }
  headers.set('Content-Length', String(size));
  return new Response(request.method === 'HEAD' ? null : (object.body ?? null), { status: 200, headers });
}

const FRONTEND_PAGES:Record<string,string>={'/index.html':'/launch','/consent.html':'/consent','/sharing':'/sharing','/sharing/':'/sharing'};
export async function frontendResponse(request:Request,path:string,fetcher:typeof fetch=fetch):Promise<Response>{
  // Static UI is compiled once in serena-portfolio. Query strings, cookies and
  // OAuth authorization headers never need to be forwarded to the HTML origin.
  const url=new URL(path,'https://serena-portfolio-bzs.pages.dev');
  try {
    const upstream=await fetcher(url,{method:request.method,headers:{Accept:'text/html','Cache-Control':'no-cache'},redirect:'manual'});
    if(upstream.status!==200||!upstream.headers.get('Content-Type')?.includes('text/html')) throw new Error(`UI origin returned ${upstream.status}`);
    if(path==='/consent'&&!upstream.headers.get('Content-Security-Policy')) throw new Error('Consent policy unavailable');
    const headers=new Headers(upstream.headers);headers.set('Cache-Control','no-store');
    return new Response(request.method==='HEAD'?null:upstream.body,{status:200,headers});
  } catch (error) {
    console.error(JSON.stringify({message:'Shared frontend unavailable',path,error:error instanceof Error?error.message:'Unknown origin error'}));
    return new Response(request.method==='HEAD'?null:'This page is temporarily unavailable. Please try again.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Retry-After':'10'}});
  }
}

export default {
  async fetch(request:Request, env:Env):Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === BASE_PATH) {
      url.pathname = `${BASE_PATH}/`;
      return Response.redirect(url.toString(), 308);
    }

    if (!url.pathname.startsWith(`${BASE_PATH}/`)) {
      return new Response('Not found', { status: 404 });
    }

    // Preserve the incoming method and headers when fetching bound assets.
    const assetUrl = new URL(url);
    assetUrl.pathname = url.pathname.slice(BASE_PATH.length);
    if (assetUrl.pathname === '/') assetUrl.pathname = '/index.html';

    const frontend = FRONTEND_PAGES[assetUrl.pathname];
    if (frontend && ['GET','HEAD'].includes(request.method)) return frontendResponse(request,frontend);

    // Only HTML and MP4s reach the Worker (see run_worker_first); MP4s need it
    // because the asset layer ignores Range. Assets live under /launchvideo/.
    try {
      if (env.MEDIA && Object.hasOwn(SIZES, assetUrl.pathname) && ['GET','HEAD'].includes(request.method)) {
        const media = await mediaResponse(request, env.MEDIA, assetUrl.pathname.slice(1));
        if (media) return media;
      }
      const response = await env.ASSETS.fetch(new Request(url, request));
      return await videoResponse(request, response, assetUrl.pathname);
    } catch (error) {
      console.error(JSON.stringify({
        message: 'Launch video asset request failed',
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error)
      }));
      return new Response('Unable to load this file. Please try again.', { status: 502 });
    }
  }
};
