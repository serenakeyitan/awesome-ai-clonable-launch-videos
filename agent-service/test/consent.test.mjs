import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readAuthorization,consentModel,consentAction,safeHttps} from '../../site/consent-model.mjs';

const query = '?client_id=https%3A%2F%2Fclaude.ai%2Foauth%2Fclient-metadata.json&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcallback&scope=profile+email&state=exact-state&nonce=exact-nonce&code_challenge=exact-challenge&code_challenge_method=S256&resource=https%3A%2F%2Fserenatan.org%2Flaunchvideo%2Fmcp';
const auth = readAuthorization(query);
const info = {clientId:auth.clientId,oauthApplicationName:'Claude',oauthApplicationUrl:'https://claude.ai',redirectDomain:'claude.ai',scopes:[{scope:'profile',description:'Your basic profile information'},{scope:'email',description:'Your email address'}]};

test('consent preserves OAuth parameters exactly, including PKCE, state, nonce, resource and additive fields',()=>{
  assert.deepEqual(auth.fields,[...new URLSearchParams(query)]);
  const request = readAuthorization(query+'&custom_future=value&resource=second');
  assert.equal(request.fields.find(([key])=>key==='custom_future')[1],'value');
  assert.equal(request.fields.filter(([key])=>key==='resource').length,2);
});
test('query parameters cannot supply approval, organization choice or a different session',()=>{
  for (const name of ['consented','ConSented','organization_id','_clerk_session_id','__clerk_session_id']) assert.throws(()=>readAuthorization(query+'&'+name+'=true'));
  for (const name of ['client_id','state','redirect_uri','scope']) assert.throws(()=>readAuthorization(query+'&'+name+'=other'));
});
test('display uses verified client identity, provider scopes and a PSL-resolved return domain',()=>{
  const model=consentModel(info,auth);
  assert.equal(model.name,'Claude');assert.equal(model.destination,'claude.ai');assert.equal(model.scopes.length,2);
  assert.throws(()=>consentModel({...info,clientId:'different'},auth));
  assert.throws(()=>consentModel({...info,redirectDomain:null},auth));
  assert.throws(()=>consentModel({...info,scopes:[]},auth));
  const extra=consentModel({...info,scopes:[...info.scopes,{scope:'private_metadata'},{scope:'offline_access'},{scope:'future:scope',description:'New permission'}]},auth);
  assert.match(extra.scopes[2].description,/sensitive/);assert.equal(extra.offline,true);assert.equal(extra.scopes[4].description,'New permission');
});
test('native loopback callbacks remain supported, while dangerous URLs and insecure remote callbacks fail',()=>{
  const local=readAuthorization('?client_id=local&redirect_uri=http%3A%2F%2F127.0.0.1%3A62379%2Fcallback');
  assert.equal(consentModel({...info,clientId:'local',redirectDomain:null},local).destination,'127.0.0.1:62379');
  for(const redirect of ['javascript:alert(1)','data:text/html,test','file:///tmp/x','https://user:password@example.com/callback','http://example.com/callback']) assert.throws(()=>readAuthorization('?client_id=x&redirect_uri='+encodeURIComponent(redirect)));
  assert.equal(safeHttps('javascript:alert(1)'),null);assert.equal(safeHttps('https://user:secret@example.com'),null);
});
test('decisions post only to the Clerk SDK consent action for the exact client',()=>{
  const action='https://clerk.serenatan.org/v1/me/oauth/consent/'+encodeURIComponent(auth.clientId)+'?_clerk_session_id=provider-session';
  assert.equal(consentAction(action,auth.clientId),action);
  for(const value of [action.replace('clerk.serenatan.org','evil.example'),action.replace('/v1/','/wrong/'),action.replace(encodeURIComponent(auth.clientId),'different')]) assert.throws(()=>consentAction(value,auth.clientId));
});
