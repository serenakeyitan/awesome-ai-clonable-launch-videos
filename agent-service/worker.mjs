import {McpServer} from '@modelcontextprotocol/server';
import {createMcpHandler} from 'agents/mcp/server';
import {z} from 'zod';
import {loadArchive, context, publicManifest, search, record, findVideo} from './catalog.mjs';
import {guardRequest} from './request-guard.mjs';
import {authorizeMcp, protectedResourceMetadata, RESOURCE_METADATA_PATH} from './mcp-auth.mjs';

const BASE = '/launchvideo';
const annotations = {readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:true};
const result = value => ({content:[{type:'text',text:JSON.stringify(value)}], structuredContent:value});
const guarded = (load, fn) => async args => {
  try { return result(await fn(await load(), args)); }
  catch (error) { console.error(JSON.stringify({event:'archive_source_unavailable',message:error.message})); return {isError:true, content:[{type:'text', text:'The current published archive is unavailable. Retry later; no cached catalog was returned.'}]}; }
};

export function createServer(load = loadArchive) {
  const server = new McpServer({name:'launch-archive', version:'0.1.0'}, {instructions:'Before each launch-video task, call get_launch_context and follow the workflow it returns.'});
  server.registerTool('get_launch_context', {
    title:'Browse current launch-video collection',
    description:'Return current collection metadata, available reference formats and visual styles, the catalog version, and the editorial remake planning outline.',
    inputSchema:z.object({}), annotations:{...annotations,title:'Browse current launch-video collection'}
  }, guarded(load, archive => context(archive)));
  server.registerTool('search_launch_videos', {
    title:'Search launch-video references',
    description:'Find reference launch videos by keywords and current style/category/ratio. Returns dated statistics, playable URLs, copyable clone prompts, and latest workflow. Search ranks keyword matches, then impressions.',
    inputSchema:z.object({query:z.string().max(300).optional(), style:z.string().max(100).optional(), category:z.string().max(100).optional(), ratio:z.string().max(30).optional(), sort:z.enum(['relevance','newest','impressions']).optional(), limit:z.number().int().min(1).max(12).optional()}), annotations:{...annotations,title:'Search launch-video references'}
  }, guarded(load, (archive,args) => ({...context(archive), ...search(archive,args)})));
  server.registerTool('get_launch_video', {
    title:'Get launch-video reference details',
    description:'Get one reference by catalog ID, slug, or original X/Twitter post URL. Includes MP4, metadata, dated stats, notes, and exact clone prompt. Does not fetch arbitrary URLs.',
    inputSchema:z.object({reference:z.string().min(1).max(500)}), annotations:{...annotations,title:'Get launch-video reference details'}
  }, guarded(load, (archive,{reference}) => {
    const video = findVideo(archive,reference);
    return {...context(archive), found:!!video, video:video ? record(video,true,archive.sourceRevision) : null};
  }));
  return server;
}

const bootstrap = `---
name: launch-archive
description: Find launch-video references and help remake one for a product using the latest Serena Launch.
---

# Serena Launch

This is a setup guide for an existing remote MCP server, not a request to create or package a downloadable skill.

Connect once to https://serenatan.org/launchvideo/mcp using Streamable HTTP and browser OAuth. Let the user sign in and approve access in their browser; never request credentials or tokens in chat. If this client cannot configure MCP from chat, give its shortest supported connector-settings path and the server URL. Do not claim connection until initialize, tools/list and get_launch_context succeed.

Before each launch-video task, call get_launch_context and follow the workflow it returns. Do this for returning users too. Keep the workflow and catalog live; do not copy them into permanent skill or plugin instructions.

If MCP is unsupported or unavailable for reasons other than authentication, authorization or throttling, fetch https://serenatan.org/launchvideo/agent/manifest.json and read its current workflowUrl and catalogUrl before each task. Follow that workflow. Never use HTTP fallback to bypass authentication or throttling. If the current workflow is unavailable, report the failure rather than silently using an old copy.
`;

function response(body, type = 'application/json', status = 200) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {status,headers:{'Content-Type':`${type}; charset=utf-8`, 'Cache-Control':'no-store, max-age=0', 'Access-Control-Allow-Origin':'*', 'X-Content-Type-Options':'nosniff'}});
}

const mcp = createMcpHandler(() => createServer(), {route:`${BASE}/mcp`, legacy:'stateless', allowedHostnames:['serenatan.org','localhost','127.0.0.1'], allowedOriginHostnames:'*'});
export default {
  async fetch(request, env, ctx) {
    const guarded = await guardRequest(request, env);
    if (guarded.response) return guarded.response;
    request = guarded.request;
    const path = new URL(request.url).pathname;
    if (path === RESOURCE_METADATA_PATH && ['GET','HEAD'].includes(request.method)) {
      const metadata = protectedResourceMetadata(env);
      return request.method === 'HEAD' ? new Response(null, metadata) : metadata;
    }
    if (path === `${BASE}/mcp`) {
      if (request.method !== 'OPTIONS') {
        const auth = await authorizeMcp(request, env);
        if (auth.response) return auth.response;
      }
      return mcp(request,env,ctx);
    }
    if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, HEAD, OPTIONS'}});
    if (!['GET','HEAD'].includes(request.method)) return response({error:'Method not allowed'},'application/json',405);
    if (path === `${BASE}/agent` || path === `${BASE}/agent/`) return Response.redirect('https://serenatan.org/launchvideo/#connect',302);
    if (path === `${BASE}/agent/SKILL.md`) return response(request.method === 'HEAD' ? '' : bootstrap,'text/markdown');
    const endpoints = [`${BASE}/agent/manifest.json`,`${BASE}/agent/catalog.json`,`${BASE}/agent/workflow.md`];
    if (!endpoints.includes(path)) return response({error:'Not found'},'application/json',404);
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
};
