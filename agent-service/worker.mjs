import {McpServer} from '@modelcontextprotocol/server';
import {createMcpHandler} from 'agents/mcp/server';
import {z} from 'zod';
import {loadArchive, context, publicManifest, search, record, findVideo} from './catalog.mjs';
import {guardRequest} from './request-guard.mjs';
import {authorizeMcp, protectedResourceMetadata, RESOURCE_METADATA_PATH} from './mcp-auth.mjs';

const BASE = '/launchvideo';
const CLAUDE_CONNECT_URL = 'https://claude.ai/customize/connectors?' + new URLSearchParams({modal:'add-custom-connector',connectorName:'Serena Launch',connectorUrl:'https://serenatan.org/launchvideo/mcp'});
const annotations = {readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:true};
const result = value => ({content:[{type:'text',text:JSON.stringify(value)}], structuredContent:value});
const guarded = (load, fn) => async args => {
  try { return result(await fn(await load(), args)); }
  catch (error) { console.error(JSON.stringify({event:'archive_source_unavailable',message:error.message})); return {isError:true, content:[{type:'text', text:'The current published archive is unavailable. Retry later; no cached catalog was returned.'}]}; }
};

export function createServer(load = loadArchive) {
  const server = new McpServer({name:'launch-archive', title:'Serena Launch', version:'0.1.0'}, {instructions:'Before each launch-video task, call get_launch_context and follow the workflow it returns.'});
  server.registerTool('get_launch_context', {
    title:'Browse current launch-video collection',
    description:'Get the live workflow, catalog version, metadata and available facets/formats. Call before each launch-video task.',
    inputSchema:z.object({}), annotations:{...annotations,title:'Browse current launch-video collection'}
  }, guarded(load, archive => context(archive)));
  server.registerTool('search_launch_videos', {
    title:'Search launch-video references',
    description:'Search by keywords and current facets. Returns playable references, dated stats and the live workflow. Default ranking: keyword match, then impressions.',
    inputSchema:z.object({query:z.string().max(300).optional(), style:z.string().max(100).optional(), category:z.string().max(100).optional(), ratio:z.string().max(30).optional(), sort:z.enum(['relevance','newest','impressions']).optional(), limit:z.number().int().min(1).max(12).optional()}), annotations:{...annotations,title:'Search launch-video references'}
  }, guarded(load, (archive,args) => ({...context(archive), ...search(archive,args)})));
  server.registerTool('get_launch_video', {
    title:'Get launch-video reference details',
    description:'Get a reference by ID, slug or X/Twitter URL: MP4, metadata, dated stats, notes and clone prompt. Catalog references only.',
    inputSchema:z.object({reference:z.string().min(1).max(500)}), annotations:{...annotations,title:'Get launch-video reference details'}
  }, guarded(load, (archive,{reference}) => {
    const video = findVideo(archive,reference);
    return {...context(archive), found:!!video, video:video ? record(video,true,archive.sourceRevision) : null};
  }));
  return server;
}

const bootstrap = `---
name: serena-launch
description: Find launch-video references and remake one using the live Serena Launch workflow.
---

# Serena Launch

Connect the existing MCP server; do not package a downloadable skill.

Server: https://serenatan.org/launchvideo/mcp (Streamable HTTP, browser OAuth). The user signs in and approves access; never request credentials or tokens in chat. If chat cannot configure MCP, give one connect link rather than a tutorial. For Claude, reply only with [Connect Serena Launch](https://serenatan.org/launchvideo/agent/connect/claude). For other clients, use their setup link or shortest settings path. Claim connection only after initialize, tools/list and get_launch_context succeed.

Before each launch-video task, call get_launch_context and follow the workflow it returns. Never embed the workflow or catalog in permanent instructions.

If MCP is unsupported or unavailable, fetch https://serenatan.org/launchvideo/agent/manifest.json and its workflowUrl and catalogUrl before each task. Never use fallback to bypass authentication, authorization or throttling. Follow the current workflow; report fetch failures instead of using a stale copy.
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
    if (path === `${BASE}/agent/connect/claude`) return new Response(null,{status:302,headers:{Location:CLAUDE_CONNECT_URL,'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}});
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
