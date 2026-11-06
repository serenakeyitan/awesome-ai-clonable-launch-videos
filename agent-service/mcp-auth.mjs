import {createClerkClient} from '@clerk/backend';

export const MCP_RESOURCE = 'https://serenatan.org/launchvideo/mcp';
export const RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource/launchvideo/mcp';
export const REQUIRED_SCOPES = ['profile', 'email'];
const METADATA_URL = new URL(RESOURCE_METADATA_PATH, MCP_RESOURCE).href;

export const authEnabled = env => env?.CLERK_AUTH_ENABLED === 'true';

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {status, headers:{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Expose-Headers':'WWW-Authenticate, Retry-After',
    'X-Content-Type-Options':'nosniff',
    ...extraHeaders
  }});
}

export function protectedResourceMetadata(env) {
  if (!authEnabled(env)) return json({error:'Not found'}, 404);
  if (!env.CLERK_ISSUER) return json({error:'Authentication temporarily unavailable'}, 503);
  return json({resource:MCP_RESOURCE, resource_name:'Launch Archive',
    authorization_servers:[env.CLERK_ISSUER], scopes_supported:REQUIRED_SCOPES,
    bearer_methods_supported:['header'], resource_documentation:'https://serenatan.org/launchvideo/'});
}

// Identity comes exclusively from Clerk's verified OAuth token. Session tokens,
// API keys and caller-supplied user IDs cannot authorize MCP requests.
export async function authorizeMcp(request, env, createClient = createClerkClient) {
  if (!authEnabled(env)) return {};
  const challenge = `Bearer resource_metadata="${METADATA_URL}"`;
  const deny = (status, error, suffix='') => ({response:json({error}, status, {
    'WWW-Authenticate':challenge + suffix
  })});
  if (!env.CLERK_SECRET_KEY || !env.CLERK_PUBLISHABLE_KEY || !env.CLERK_ISSUER) {
    return {response:json({error:'Authentication temporarily unavailable'}, 503, {'Retry-After':'10'})};
  }
  if (!/^Bearer \S+$/i.test(request.headers.get('Authorization') || '')) return deny(401, 'Sign in to connect Launch Archive');
  try {
    const clerk = createClient({secretKey:env.CLERK_SECRET_KEY, publishableKey:env.CLERK_PUBLISHABLE_KEY});
    const state = await clerk.authenticateRequest(request, {acceptsToken:'oauth_token', audience:MCP_RESOURCE});
    if (!state.isAuthenticated) return deny(401, 'Invalid or expired access token');
    const auth = state.toAuth();
    if (auth.tokenType !== 'oauth_token' || typeof auth.userId !== 'string' || !auth.userId || typeof auth.clientId !== 'string') {
      return deny(401, 'Invalid access token');
    }
    if (!REQUIRED_SCOPES.every(scope => auth.scopes?.includes(scope))) {
      return deny(403, 'Missing required access scopes', `, error="insufficient_scope", scope="${REQUIRED_SCOPES.join(' ')}"`);
    }
    // Keep email and credentials out of tool responses and logs. Clerk owns the
    // account record; newsletter consent is a separate future user action.
    return {identity:{userId:auth.userId, clientId:auth.clientId}};
  } catch {
    // Never log raw SDK errors: these can include credentials or personal data.
    return deny(401, 'Invalid or expired access token');
  }
}
