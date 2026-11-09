const controlled = /^(?:consented|organization_id|_+clerk_session_id)$/i;

export function readAuthorization(search) {
  if (search.length > 32768) throw new Error('Invalid authorization request');
  const params = new URLSearchParams(search);
  const seen = new Set();
  for (const [key] of params) {
    if (controlled.test(key)) throw new Error('Unexpected decision parameter');
    if (seen.has(key) && key !== 'resource') throw new Error('Ambiguous authorization request');
    seen.add(key);
  }
  const clientId = params.get('client_id');
  const redirectUri = params.get('redirect_uri');
  if (!clientId || !redirectUri) throw new Error('Start the connection from your agent');
  const redirect = new URL(redirectUri);
  if (['javascript:', 'data:', 'file:', 'blob:'].includes(redirect.protocol)) throw new Error('Invalid return URL');
  if (redirect.username || redirect.password) throw new Error('Invalid return URL');
  if (redirect.protocol === 'http:' && !['localhost','127.0.0.1','[::1]'].includes(redirect.hostname)) throw new Error('Insecure return URL');
  return {clientId, redirectUri, scope:params.get('scope') ?? undefined, fields:[...params]};
}

export function consentModel(info, authorization) {
  if (info.clientId !== authorization.clientId || !info.oauthApplicationName || !Array.isArray(info.scopes) || !info.scopes.length || info.scopes.some(item => typeof item?.scope !== 'string' || !item.scope)) throw new Error('Invalid consent metadata');
  const redirect = new URL(authorization.redirectUri);
  const loopback = ['localhost','127.0.0.1','[::1]'].includes(redirect.hostname);
  // Use Clerk's PSL-resolved domain, never infer a trusted root from client-supplied text.
  if (redirect.protocol === 'https:' && !info.redirectDomain && !loopback) throw new Error('Unverified return domain');
  const destination = info.redirectDomain || (loopback ? redirect.host : redirect.protocol);
  const descriptions = {profile:'Your basic profile information',email:'Your email address',openid:'Identify your Serena Launch account',offline_access:'Stay connected until access is revoked',private_metadata:'Your private account metadata, which may include sensitive information'};
  return {
    name:info.oauthApplicationName,
    destination,
    scopes:info.scopes.map(item => ({scope:item.scope, description:item.description || descriptions[item.scope] || item.scope})),
    offline:info.scopes.some(item => item.scope === 'offline_access'),
    needsOrganization:info.scopes.some(item => item.scope === 'user:org:read'),
    logo:safeHttps(info.oauthApplicationLogoUrl),
    website:safeHttps(info.oauthApplicationUrl)
  };
}

export function safeHttps(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}

export function consentAction(value, clientId) {
  const url = new URL(value);
  if (url.origin !== 'https://clerk.serenatan.org' || url.username || url.password || url.pathname !== `/v1/me/oauth/consent/${encodeURIComponent(clientId)}`) throw new Error('Invalid consent destination');
  return url.href;
}
