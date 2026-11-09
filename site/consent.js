import {readAuthorization, consentModel, consentAction} from './consent-model.mjs';
import {track,identify} from './analytics.mjs';
import {clientName} from './analytics-events.mjs';

const $ = id => document.getElementById(id);
const showError = (reason = 'load_failed') => {
  track('consent_failed',{reason});
  $('consent-content').hidden = true;
  $('consent-status').hidden = false;
  $('consent-status').textContent = 'Connection unavailable. Try again from your agent.';
};

function render(info, authorization, user, clerk, preview = false) {
  const model = consentModel(info, authorization);
  const client = clientName(authorization.clientId);
  if (!preview) {
    identify(user.id);
    track('consent_viewed',{client});
  }
  const form = $('consent-form');
  $('consent-heading').textContent = `Connect ${model.name}`;
  $('consent-account').textContent = user.primaryEmailAddress?.emailAddress || user.primaryPhoneNumber?.phoneNumber || user.username || user.id;
  $('consent-trust-summary').textContent = `Only continue if you trust ${model.name}.`;
  $('consent-return').textContent = model.destination;
  $('consent-client-id').textContent = authorization.clientId;
  $('consent-redirect-uri').textContent = authorization.redirectUri;
  if (model.website) {
    const link = document.createElement('a');
    link.href = model.website; link.textContent = new URL(model.website).hostname; link.target = '_blank'; link.rel = 'noopener noreferrer';
    $('consent-app-url').append(link);
  } else $('consent-app-url').textContent = 'Not provided';
  const knownLogo = model.destination === 'claude.ai' ? 'logos/claude.svg' : model.destination === 'chatgpt.com' ? 'logos/chatgpt.svg' : null;
  if (model.logo || knownLogo) {
    $('client-logo').src = model.logo || knownLogo;
    $('client-logo').referrerPolicy = 'no-referrer';
    $('client-logo').hidden = false;
  } else { $('client-initial').textContent = model.name.slice(0,1); $('client-initial').hidden = false; }
  for (const scope of model.scopes) {
    const item = document.createElement('li'); item.textContent = scope.description; $('consent-scopes').append(item);
  }
  const organizations = model.needsOrganization ? (user.organizationMemberships ?? []) : [];
  if (organizations.length) {
    const select = $('organization-id');
    select.append(new Option('Choose an organization', ''));
    for (const member of organizations) select.append(new Option(member.organization.name, member.organization.id));
    select.disabled = false; select.required = true; $('consent-organization').hidden = false;
  }
  if (preview) {
    const label = document.createElement('p'); label.className = 'consent-account'; label.textContent = 'Preview · authorization disabled'; form.before(label);
    form.querySelectorAll('button').forEach(button => { button.disabled = true; });
    form.addEventListener('submit', event => event.preventDefault());
  } else {
    form.action = consentAction(clerk.oauthApplication.buildConsentActionUrl({clientId:authorization.clientId}), authorization.clientId);
    for (const [name,value] of authorization.fields) {
      const input = document.createElement('input'); input.type = 'hidden'; input.name = name; input.value = value; form.append(input);
    }
    const sessionId = clerk.session.id;
    let submitted = false;
    const status = $('consent-submit-status');
    const reset = () => {
      submitted = false;
      form.removeAttribute('aria-busy');
      status.hidden = true;
    };
    // Back/forward navigation can restore this document and its submission lock.
    window.addEventListener('pageshow', reset);
    document.addEventListener('securitypolicyviolation', event => {
      if (event.effectiveDirective !== 'form-action') return;
      track('consent_failed',{reason:'form_policy'});
      reset();
      status.textContent = 'Your browser blocked the connection. Start again from your agent.';
      status.hidden = false;
    });
    form.addEventListener('submit', event => {
      const decision = event.submitter?.value;
      if (submitted || !['true','false'].includes(decision)) { event.preventDefault(); return; }
      if (clerk.session?.id !== sessionId) { event.preventDefault(); showError('session_changed'); return; }
      if (decision === 'true' && organizations.length && !organizations.some(member => member.organization.id === $('organization-id').value)) { event.preventDefault(); $('organization-id').reportValidity(); return; }
      // Leave the clicked button enabled so native form submission includes consented=true/false.
      submitted = true;
      track('consent_submitted',{client,decision:decision === 'true' ? 'allow' : 'deny'});
      form.setAttribute('aria-busy','true');
      status.textContent = decision === 'true' ? 'Connecting…' : 'Returning…';
      status.hidden = false;
    });
  }
  $('consent-status').hidden = true;
  $('consent-content').hidden = false;
}

async function start() {
  // Local-only, inert design preview. No SDK, identity, or consent request is made.
  if (['localhost','127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).get('preview') === '1') {
    const authorization = readAuthorization('?client_id=design-preview&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback&scope=profile+email');
    render({clientId:'design-preview',oauthApplicationName:'Claude',oauthApplicationUrl:'https://claude.ai',redirectDomain:'claude.ai',scopes:[{scope:'profile',description:'Your basic profile information'},{scope:'email',description:'Your email address'}]},authorization,{id:'preview',primaryEmailAddress:{emailAddress:'you@example.com'}},null,true);
    return;
  }
  const authorization = readAuthorization(location.search);
  await new Promise((resolve,reject) => {
    const script = document.createElement('script');
    script.src = 'https://clerk.serenatan.org/npm/@clerk/clerk-js@6.42.3/dist/clerk.browser.js';
    script.crossOrigin = 'anonymous';
    script.dataset.clerkPublishableKey = 'pk_live_Y2xlcmsuc2VyZW5hdGFuLm9yZyQ';
    script.onload = resolve; script.onerror = reject; document.head.append(script);
  });
  const clerk = window.Clerk;
  await clerk.load();
  if (!clerk.user || !clerk.session) {
    await clerk.redirectToSignIn({redirectUrl:location.href});
    return;
  }
  const info = await clerk.oauthApplication.getConsentInfo({oauthClientId:authorization.clientId,scope:authorization.scope,redirectUri:authorization.redirectUri});
  render(info, authorization, clerk.user, clerk);
}
start().catch(() => showError());
