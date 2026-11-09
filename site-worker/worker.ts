import VIDEO_SIZES from './asset-sizes.json' with {type:'json'};
interface Env {ASSETS:{fetch(request:Request):Promise<Response>}}
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

const FRONTEND_PAGES:Record<string,string>={'/index.html':'/launch','/consent.html':'/consent'};
export async function frontendResponse(request:Request,path:string,fetcher:typeof fetch=fetch):Promise<Response>{
  // Static UI is compiled once in serena-portfolio. Query strings, cookies and
  // OAuth authorization headers never need to be forwarded to the HTML origin.
  const url=new URL(path,'https://serena-portfolio-bzs.pages.dev');
  try {
    const upstream=await fetcher(url,{method:request.method,headers:{Accept:'text/html','Cache-Control':'no-cache'},redirect:'error'});
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

    try {
      const response = await env.ASSETS.fetch(new Request(assetUrl, request));
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
