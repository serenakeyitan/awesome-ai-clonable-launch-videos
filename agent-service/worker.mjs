import {McpServer} from '@modelcontextprotocol/server';
import {createMcpHandler} from 'agents/mcp/server';
import {z} from 'zod';
import {loadArchive, context, publicManifest, search, record, findVideo} from './catalog.mjs';
import {guardRequest,guardAccount} from './request-guard.mjs';
import {authorizeMcp, protectedResourceMetadata, RESOURCE_METADATA_PATH} from './mcp-auth.mjs';
import {captureEvent,captureMcpEvent,describeMcpRequest,observeMcpReplies,reportLaunchTask,measureMcpRequest,taskIdSchema} from './analytics.mjs';
import {recordingRoutes,cleanupDeletedRecordings} from './recording.mjs';
import {communityRoutes,cleanupCommunity,uploadSchema,createCommunityUpload,publishCommunityVideo,suggestedCreatorXHandle} from './community.mjs';

const BASE = '/launchvideo';
const CLAUDE_CONNECT_URL = 'https://claude.ai/customize/connectors?' + new URLSearchParams({modal:'add-custom-connector',connectorName:'Serena Launch',connectorUrl:'https://serenatan.org/launchvideo/mcp'});
export const LIST_CACHE_HINTS = Object.freeze({
  'server/discover':{ttlMs:60*60*1000, cacheScope:'private'},
  'tools/list':{ttlMs:60*60*1000, cacheScope:'private'}
});
const annotations = {readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:true};
const result = value => ({content:[{type:'text',text:JSON.stringify(value)}], structuredContent:value});
const task_id = taskIdSchema.optional().describe('For a creation task, reuse the ID returned by report_launch_task. Omit for browsing.');
const communityAttribution = 'When asking permission to post to Community, ask which public X/Twitter handle to display as the author. If you already know a candidate handle, ask whether to use it or a different handle. Pass only the explicitly confirmed handle in creator_x_handle. If the author chooses to skip the handle, use their creator name.';
async function communityHandle(community) {
  try { return await community.suggestHandle?.() ?? null; }
  catch { return null; }
}
const guarded = (load, fn, tool, observe) => async args => {
  const started = Date.now();
  const completed = properties => {
    try { observe?.({tool,task_id:args.task_id,duration_ms:Math.max(0,Date.now()-started),...properties}); }
    catch { console.warn(JSON.stringify({event:'analytics_capture_failed'})); }
  };
  try {
    const value = await fn(await load(),args);
    completed({outcome:'success',...(tool === 'get_launch_video' ? {reference_found:value.found,reference_id:value.video?.id} : {}),...(tool === 'search_launch_videos' ? {query_length:args.query?.length ?? 0,result_count:value.totalMatches,category:args.category,style:args.style} : {})});
    return result(value);
  } catch (error) {
    completed({outcome:'error'});
    console.error(JSON.stringify({event:'archive_source_unavailable',message:error.message}));
    return {isError:true,content:[{type:'text',text:'The current published archive is unavailable. Retry later; no cached catalog was returned.'}]};
  }
};

export function createServer(load = loadArchive, observe, report, community = {}) {
  const server = new McpServer({name:'launch-archive', title:'Serena Launch', version:'0.2.0'}, {
    instructions:'Before each launch-video task, call get_launch_context and follow its workflow and Community attribution guidance.',
    // Without hints the SDK stamps ttlMs:0 ("immediately stale") on 2026-era
    // discover and tools/list results, so clients such as claude.ai re-run
    // server/discover + tools/list before every use. Both only change on deploy.
    cacheHints:LIST_CACHE_HINTS
  });
  server.registerTool('get_launch_context', {
    title:'Browse current launch-video collection',
    description:'Start here for product launch, demo, teaser or feature-announcement videos and motion-design inspiration. Get the live collection, workflow, Community attribution guidance and searchable styles.',
    inputSchema:z.object({task_id}), annotations:{...annotations,title:'Browse current launch-video collection'}
  }, guarded(load, async archive => {
    const value=context(archive);
    value.community_attribution={instructions:communityAttribution,suggested_x_handle:await communityHandle(community)};
    return value;
  },'get_launch_context',observe));
  server.registerTool('search_launch_videos', {
    title:'Search launch-video references',
    description:'Find real launch, demo and teaser references by brand, product, pacing, transitions or animation style. Returns playable videos, Serena Launch preview links and notes. Keyword order is not a product-fit recommendation; no popularity ranking or metrics.',
    inputSchema:z.object({query:z.string().max(300).optional(), style:z.string().max(100).optional(), category:z.string().max(100).optional(), ratio:z.string().max(30).optional(), sort:z.enum(['relevance','newest']).optional(), limit:z.number().int().min(1).max(12).optional(), task_id}), annotations:{...annotations,title:'Search launch-video references'}
  }, guarded(load, (archive,args) => ({...context(archive), ...search(archive,args)}),'search_launch_videos',observe));
  server.registerTool('get_launch_video', {
    title:'Get launch-video reference details',
    description:'Get a reference by ID, slug or X/Twitter URL: MP4, descriptive metadata, notes and clone prompt. Catalog references only; no popularity metrics or legacy scores.',
    inputSchema:z.object({reference:z.string().min(1).max(500), task_id}), annotations:{...annotations,title:'Get launch-video reference details'}
  }, guarded(load, (archive,{reference}) => {
    const video = findVideo(archive,reference);
    return {...context(archive), found:!!video, video:video ? record(video,true,archive.sourceRevision) : null};
  },'get_launch_video',observe));
  server.registerTool('report_launch_task', {
    title:'Report video task outcome or explicit feedback',
    description:'Record a video-creation task start, completion or failure, or feedback the user explicitly gave. Returns a task ID at start; reuse it for the outcome. Completion is agent-reported, not a server render verification. No prompts, emails, output URLs or private content.',
    inputSchema:z.object({status:z.enum(['started','completed','failed','feedback']),task_id:z.uuid().optional(),reference_ids:z.array(z.number().int().positive()).max(3).optional(),checks:z.object({html:z.boolean(),source:z.boolean(),mp4:z.boolean(),music:z.boolean(),playback:z.boolean(),download:z.boolean()}).optional(),rating:z.enum(['helpful','not_helpful']).optional(),reason:z.enum(['poor_fit','motion_quality','playback','download','other']).optional()}),
    annotations:{title:'Report video task outcome or explicit feedback',readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:true}
  }, async args => {
    if (!report) return result({recorded:false,reason:'Reporting unavailable'});
    if (args.reference_ids?.length) {
      const archive=await load();
      if (args.reference_ids.some(id=>!archive.videos.some(video=>video.id===id))) return {...result({recorded:false,reason:'Unknown reference ID'}),isError:true};
    }
    const value=await report(args);
    if(args.status==='completed'&&args.checks?.mp4){
      const handle=await communityHandle(community);
      const attributionQuestion=handle
        ? `If yes, should I show @${handle} as the author, or would you prefer a different handle or your name?`
        : 'If yes, which X/Twitter handle should I show as the author? You can also use your name.';
      value.community_offer={
        question:`Would you like to upload the final video to Serena Launch Community for extra exposure? ${attributionQuestion}`,
        when:'Ask once after the final version, including any requested revisions. Upload only after the user explicitly agrees.',
        attribution:communityAttribution,
        suggested_x_handle:handle,
        tool:'create_community_upload'
      };
    }
    return {...result(value),...(!value.recorded ? {isError:true} : {})};
  });
  const publishTool=(fn)=>async args=>{
    try{if(!fn)return {...result({error:'Community publishing unavailable'}),isError:true};return result(await fn(args));}
    catch(error){return {...result({error:error.status?error.message:'Community is temporarily unavailable. Try again.'}),isError:true};}
  };
  server.registerTool('create_community_upload',{
    title:'Upload a final video to Serena Launch Community',
    description:'Only after the user explicitly agrees to public Community posting and chooses how their author credit should appear, create upload links for their final MP4 and optional JPEG/PNG cover (use a clear frame for the gallery). Ask for their X/Twitter handle or confirm a known handle before including creator_x_handle. Omit it if they choose to use their name. Reuse the task_id from report_launch_task to prevent duplicate posts. PUT actual file bytes to the returned URLs, then call publish_community_video. No draft or preview approval step. Never claim upload without sending the file.',
    inputSchema:uploadSchema,annotations:{title:'Upload a final video to Serena Launch Community',readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:true}
  },publishTool(community.create));
  server.registerTool('publish_community_video',{
    title:'Publish the uploaded final video',
    description:'Finish the already-consented Community post after uploading actual MP4 and cover bytes. Returns the public share URL. Do not ask the user for a second approval. Authors can edit, replace or delete their upload on the Community tab.',
    inputSchema:z.object({upload_id:z.uuid()}),annotations:{title:'Publish the uploaded final video',readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:true}
  },publishTool(community.publish));
  return server;
}

const bootstrap = `---
name: serena-launch
description: Find real video references for product launches, demos, teasers and feature announcements, or inspiration for pacing, transitions, motion design and vibe. Use when planning or making these videos, even if the user does not name Serena Launch.
---

# Serena Launch

Search Serena Tan's curated video collection and share playable Serena Launch links. Before each relevant task, call get_launch_context and follow its live workflow; keep creative decisions with the agent.

Use the existing MCP server: https://serenatan.org/launchvideo/mcp (Streamable HTTP, browser OAuth). Never request credentials or tokens in chat or package a downloadable skill. If setup is needed, offer one connect link: for Claude, [Connect Serena Launch](https://serenatan.org/launchvideo/agent/connect/claude); otherwise the client's shortest setup path. Confirm connection only after initialize, tools/list and get_launch_context succeed.

If MCP is disconnected, unsupported, or returns 401/403, stop and guide connection or reauthorization. No anonymous fallback through public files, website metadata or GitHub mirrors. Keep the catalog and workflow live rather than embedding them in permanent instructions.
`;

function skillResponse(request) {
  const acceptsHtml = (request.headers.get('accept') ?? '').split(',').some(value =>
    value.trim().split(';')[0].toLowerCase() === 'text/html' && !/;\s*q=0(?:\.0*)?(?:\s*;|\s*$)/i.test(value));
  const html = acceptsHtml && new URL(request.url).searchParams.get('raw') !== '1';
  const escaped = html ? bootstrap.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])) : '';
  const body = html ? `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Serena Launch — Setup guide</title>
<link rel="icon" href="/launchvideo/favicon-32.png?v=popcorn-1" type="image/png" sizes="32x32">
<link rel="icon" type="image/svg+xml" href="/launchvideo/favicon.svg?v=popcorn-1">
<link rel="alternate" type="text/markdown" title="Raw Markdown" href="?raw=1">
<link rel="stylesheet" href="/launchvideo/style.css"><link rel="stylesheet" href="/shared/site-header.css">
<script src="/shared/site-header.js" defer></script>
<style>.skill-document{padding-top:32px;padding-bottom:64px}.skill-document h1{font-size:26px;margin:0}.skill-source{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.8 var(--mono);margin:24px 0 0}</style></head>
<body><header class="masthead site-header" data-site-header data-site-page="launch-videos"><div class="brand"><a class="logo" href="/">Serena Tan</a></div><nav class="meta" aria-label="Page navigation"><a href="/launchvideo/">Collection ↗</a></nav></header>
<main class="document skill-document"><div class="section-heading"><h1>Agent setup</h1><a href="?raw=1">Raw Markdown ↗</a></div><pre class="skill-source">${escaped}</pre></main></body></html>` : bootstrap;
  const result = response(request.method === 'HEAD' ? '' : body, html ? 'text/html' : 'text/markdown');
  result.headers.set('Vary','Accept');
  return result;
}

function response(body, type = 'application/json', status = 200) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {status,headers:{'Content-Type':`${type}; charset=utf-8`, 'Cache-Control':'no-store, max-age=0', 'Access-Control-Allow-Origin':'*', 'X-Content-Type-Options':'nosniff'}});
}

const MCP_OPTIONS = {route:`${BASE}/mcp`,legacy:'stateless',allowedHostnames:['serenatan.org','localhost','127.0.0.1'],allowedOriginHostnames:'*'};
export default {
  async scheduled(_controller,env,ctx) { ctx.waitUntil(Promise.all([cleanupDeletedRecordings(env),cleanupCommunity(env)])); },
  async fetch(request,env,ctx) {
    if(new URL(request.url).pathname===`${BASE}/mcp`)
      return measureMcpRequest(request,env,ctx,observe=>handleRequest(request,env,ctx,observe));
    return handleRequest(request,env,ctx);
  }
};

async function handleRequest(request,env,ctx,observeIdentity=()=>{}) {
    const guarded = await guardRequest(request, env);
    if (guarded.response) return guarded.response;
    request = guarded.request;
    const path = new URL(request.url).pathname;
    const community = await communityRoutes(request,env,ctx);
    if (community) return community;
    const recording = await recordingRoutes(request,env,ctx);
    if (recording) return recording;
    if (path === RESOURCE_METADATA_PATH && ['GET','HEAD'].includes(request.method)) {
      const metadata = protectedResourceMetadata(env);
      return request.method === 'HEAD' ? new Response(null, metadata) : metadata;
    }
    if (path === `${BASE}/mcp`) {
      let identity;
      if (request.method !== 'OPTIONS') {
        const auth = await authorizeMcp(request, env);
        if (auth.response) return auth.response;
        identity = auth.identity;
        const limited = await guardAccount(identity, env);
        if (limited) return limited;
      }
      const rpc = await describeMcpRequest(request,!!identity && !!env.POSTHOG_PROJECT_TOKEN);
      observeIdentity(identity,rpc);
      const isTest = request.headers.get('X-Serena-Analytics-Test') === '1';
      const started = Date.now();
      // The SDK already creates a fresh stateless server per request. Capture
      // verified identity in this request's closure, never in shared state.
      const mcp = createMcpHandler(() => {
        const server = createServer(loadArchive,event => {
          if (identity) ctx.waitUntil(captureMcpEvent(env,identity,{...event,rpc_request_id:rpc.traceId},undefined,{isTest}));
        },args => reportLaunchTask(env,identity,args,undefined,{isTest,rpcRequestId:rpc.traceId}),{
          suggestHandle:()=>suggestedCreatorXHandle(env,identity),
          create:async args=>{
            if(args.reference_ids.length){const archive=await loadArchive();if(args.reference_ids.some(id=>!archive.videos.some(v=>v.id===id)))throw Object.assign(Error('Unknown reference ID'),{status:400});}
            return createCommunityUpload(env,identity,args);
          },
          publish:async args=>{const published=await publishCommunityVideo(env,identity,args.upload_id);ctx.waitUntil(captureEvent(env,identity,published.replaced?'community_video_replaced':'community_post_published',{post_id:published.post.id,kind:published.post.kind,task_id:published.task_id,reference_ids:published.post.reference_ids.join(',')},undefined,{isTest,uuid:args.upload_id}));return published;}
        });
        if (!rpc.traceId) return server;
        return observeMcpReplies(server,rpc,event => {
          ctx.waitUntil(captureEvent(env,identity,'mcp_rpc_completed',{
            ...event,duration_ms:Math.max(0,Date.now()-started)
          },undefined,{isTest}));
        });
      },MCP_OPTIONS);
      return mcp(request,env,ctx);
    }
    if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, HEAD, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type'}});
    if (!['GET','HEAD'].includes(request.method)) return response({error:'Method not allowed'},'application/json',405);
    if (path === `${BASE}/agent/connect/claude`) return new Response(null,{status:302,headers:{Location:CLAUDE_CONNECT_URL,'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}});
    if (path === `${BASE}/agent` || path === `${BASE}/agent/`) return Response.redirect('https://serenatan.org/launchvideo/#connect',302);
    if (path === `${BASE}/agent/SKILL.md`) return skillResponse(request);
    const endpoints = [`${BASE}/agent/manifest.json`,`${BASE}/agent/catalog.json`,`${BASE}/agent/workflow.md`];
    if (!endpoints.includes(path)) return response({error:'Not found'},'application/json',404);
    const auth = await authorizeMcp(request, env);
    if (auth.response) return auth.response;
    const limited = await guardAccount(auth.identity, env);
    if (limited) return limited;
    try {
      const archive = await loadArchive();
      let data;
      if (path.endsWith('/workflow.md')) data = response(archive.workflow,'text/markdown');
      else if (path.endsWith('/catalog.json')) data = response({...context(archive), videos:archive.videos.map(v => record(v,true,archive.sourceRevision))});
      else data = response(publicManifest(archive));
      data.headers.set('X-Launch-Archive-Version',archive.version);
      return request.method === 'HEAD' ? new Response(null,data) : data;
    } catch (error) { console.error(JSON.stringify({event:'archive_source_unavailable',message:error.message})); return response({error:'Current published archive unavailable. No cached catalog returned.'},'application/json',503); }
}
