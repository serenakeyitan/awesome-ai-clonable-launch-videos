import {capturePayload} from './analytics-events.mjs';

export function createAnalytics({config,storage,privacy,send,uuid = () => crypto.randomUUID(),isTest = false}) {
  let anonymousId, accountId;
  const allowed = !privacy?.globalPrivacyControl && privacy?.doNotTrack !== '1';
  if (allowed) {
    try {
      anonymousId = storage.getItem('serena_launch_visitor');
      if (!/^browser:[a-z0-9-]{36}$/i.test(anonymousId ?? '')) {
        anonymousId = `browser:${uuid()}`;
        storage.setItem('serena_launch_visitor',anonymousId);
      }
    } catch { /* Storage restrictions disable analytics, not the product. */ }
  }
  const track = async (name,properties = {}) => {
    if (!anonymousId) return false;
    try {
      const settings = await config;
      if (!settings?.project_token || settings.api_host !== 'https://us.i.posthog.com') return false;
      const payload = capturePayload(name,accountId ?? anonymousId,properties,{key:settings.project_token,source:'web',isTest,identified:!!accountId,uuid:uuid()});
      return await send(settings.api_host,payload);
    } catch { return false; }
  };
  const identify = async userId => {
    if (!anonymousId || !/^user_[a-z0-9]+$/i.test(userId ?? '')) return false;
    try {
      const settings = await config;
      if (!settings?.project_token || settings.api_host !== 'https://us.i.posthog.com') return false;
      accountId = `account:${userId}`;
      return await send(settings.api_host,{api_key:settings.project_token,event:'$identify',distinct_id:accountId,uuid:uuid(),properties:{$anon_distinct_id:anonymousId,$ip:null,$geoip_disable:true,is_test:isTest,app:'serena-launch'}});
    } catch { return false; }
  };
  return {track,identify};
}

const browser = typeof window !== 'undefined';
const privacy = browser ? {globalPrivacyControl:navigator.globalPrivacyControl,doNotTrack:navigator.doNotTrack} : {};
let storage;
try { if (browser) storage = localStorage; } catch { /* No persistent analytics. */ }
const permitted = browser && !privacy.globalPrivacyControl && privacy.doNotTrack !== '1';
const config = permitted ? fetch('/launchvideo/analytics-config.json',{cache:'no-store'}).then(r=>r.ok ? r.json() : null).catch(()=>null) : Promise.resolve(null);
const analytics = createAnalytics({config,storage,privacy,
  isTest:browser && (new URLSearchParams(location.search).get('analytics_test') === '1' || ['localhost','127.0.0.1'].includes(location.hostname)),
  send:async(host,payload) => (await fetch(`${host}/i/v0/e/`,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',body:JSON.stringify(payload),keepalive:true})).ok
});
export const track = analytics.track;
export const identify = analytics.identify;

if (permitted && /^\/launchvideo\/?$/.test(location.pathname)) {
  let referrer = '';
  try { referrer = new URL(document.referrer).hostname; } catch { /* Direct visit. */ }
  const params = new URLSearchParams(location.search);
  track('collection_viewed',{entry:location.hash.startsWith('#video-') ? 'reference_link' : 'collection',referrer_host:referrer,...Object.fromEntries(['utm_source','utm_medium','utm_campaign'].map(key=>[key,params.get(key)]))});
}
