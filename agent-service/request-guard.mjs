// This is an abuse throttle, not a daily allowance or a global billing limit.
// Cloudflare's native counters are approximate and local to each edge location.
export const MAX_MCP_BODY_BYTES = 64 * 1024;
const RETRY_SECONDS = 60;

function reject(status, error, retryAfter) {
  const headers = {
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Expose-Headers':'Retry-After',
    'X-Content-Type-Options':'nosniff'
  };
  if (retryAfter) headers['Retry-After'] = String(retryAfter);
  return new Response(JSON.stringify({error}), {status, headers});
}

export async function guardRequest(request, env) {
  try {
    // CF-Connecting-IP is set by Cloudflare at ingress. Never trust the
    // caller-supplied X-Forwarded-For, query string, client name or Bearer token.
    // One key covers MCP, bootstrap and HTTP catalog routes together.
    const key = `launch-archive:${request.headers.get('CF-Connecting-IP') || 'unknown'}`;
    if (!env?.ARCHIVE_REQUEST_LIMITER) throw new Error('Missing rate limit binding');
    const {success} = await env.ARCHIVE_REQUEST_LIMITER.limit({key});
    if (!success) return {response:reject(429, 'Too many requests. Retry after 60 seconds.', RETRY_SECONDS)};
  } catch {
    console.error(JSON.stringify({event:'archive_rate_limiter_unavailable'}));
    return {response:reject(503, 'Request protection temporarily unavailable. Retry shortly.', 10)};
  }

  return readBoundedBody(request);
}

// Shared egress (every claude.ai user arrives from Anthropic's IPs) means the
// IP bucket alone lets one busy account crowd out everyone else on that client.
// After Clerk verifies the token, each account also gets its own bucket.
export async function guardAccount(identity, env) {
  if (!identity?.userId || !env?.ACCOUNT_REQUEST_LIMITER) return null;
  try {
    const {success} = await env.ACCOUNT_REQUEST_LIMITER.limit({key:`launch-archive-account:${identity.userId}`});
    return success ? null : reject(429, 'Too many requests for this account. Retry after 60 seconds.', RETRY_SECONDS);
  } catch {
    console.error(JSON.stringify({event:'account_rate_limiter_unavailable'}));
    return reject(503, 'Request protection temporarily unavailable. Retry shortly.', 10);
  }
}

async function readBoundedBody(request) {
  if (request.method !== 'POST' || new URL(request.url).pathname !== '/launchvideo/mcp') return {request};
  const declaredLength = request.headers.get('Content-Length');
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_MCP_BODY_BYTES)) {
    if (request.body) await request.body.cancel().catch(() => {});
    return {response:reject(413, 'MCP request body must not exceed 64 KiB.')};
  }
  if (!request.body) return {request};

  // Check actual bytes too: Content-Length can be absent or dishonest.
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_MCP_BODY_BYTES) return {response:reject(413, 'MCP request body must not exceed 64 KiB.')};
      chunks.push(value);
    }
  } catch {
    return {response:reject(400, 'Could not read MCP request body.')};
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
  const headers = new Headers(request.headers);
  headers.delete('Content-Length');
  return {request:new Request(request, {headers, body:bytes})};
}
