import {z} from 'zod';
import {timingSafeEqual} from 'node:crypto';
import {browserIdentity,readJson,digest} from './recording.mjs';
import {captureEvent} from './analytics.mjs';

export const COMMUNITY_BASE='/launchvideo/community';
const ORIGIN='https://serenatan.org';
const MAX_VIDEO=100000000, MAX_COVER=2000000, UPLOAD_LIFETIME=30*60000;
const validId=id=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id);
const creatorXHandle=z.string().trim().regex(/^(?:@?[A-Za-z0-9_]{1,15})?$/,'Use an X handle with up to 15 letters, numbers, or underscores').nullable().default(null).describe('The public X/Twitter handle the author explicitly approved for this Community post. Omit or use null if the author chose no handle.');
const normalizeCreatorXHandle=value=>value?.replace(/^@/,'')||null;
const productUrl=z.string().max(2000).refine(value=>{if(!value)return true;try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}},'Use an HTTPS product URL');
export const postSchema=z.object({title:z.string().trim().min(1).max(120),description:z.string().trim().max(600).default(''),product_url:productUrl.default(''),creator_name:z.string().trim().min(1).max(80).default('Creator'),creator_x_handle:creatorXHandle,kind:z.enum(['launch','ad']).default('launch'),reference_ids:z.array(z.number().int().positive()).max(3).default([])});
export const uploadSchema=postSchema.extend({user_confirmed:z.literal(true),task_id:z.uuid().optional(),post_id:z.uuid().optional(),video_bytes:z.number().int().min(12).max(MAX_VIDEO),cover_bytes:z.number().int().min(0).max(MAX_COVER).default(0),cover_type:z.enum(['image/jpeg','image/png']).default('image/jpeg')});
class CommunityError extends Error{constructor(status,message){super(message);this.status=status;}}
const fail=(status,message)=>{throw new CommunityError(status,message);};
const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
const parse=(schema,value)=>{const result=schema.safeParse(value);if(!result.success)fail(400,result.error.issues[0]?.message||'Invalid community request');return result.data;};
const key=(id,part)=>`community/${id}/${part}`;
const same=(a,b)=>a.length===b.length&&timingSafeEqual(new TextEncoder().encode(a),new TextEncoder().encode(b));
function requireStorage(env){if(!env.RECORDING_DB||!env.COMMUNITY_MEDIA)fail(503,'Community is temporarily unavailable');}
async function owned(env,id,user){if(!validId(id))fail(404,'Upload not found');const row=await env.RECORDING_DB.prepare("SELECT * FROM community_posts WHERE id=? AND user_id=? AND status!='deleted'").bind(id,user.userId).first();if(!row)fail(404,'Upload not found');return row;}
const publicPost=row=>({id:row.id,title:row.title,description:row.description,product_url:row.product_url,creator_name:row.creator_name,creator_x_handle:row.creator_x_handle??null,kind:row.kind,reference_ids:JSON.parse(row.reference_ids),published_at:row.published_at,updated_at:row.updated_at,media_url:`${COMMUNITY_BASE}/media/${row.active_upload_id}/video`,poster_url:row.cover_bytes?`${COMMUNITY_BASE}/media/${row.active_upload_id}/cover`:null,url:`${ORIGIN}/launchvideo/?tab=community&post=${row.id}`});
const publishedSelect="SELECT p.*,u.cover_bytes FROM community_posts p JOIN community_uploads u ON u.id=p.active_upload_id WHERE p.status='published'";

export async function suggestedCreatorXHandle(env,identity){
 if(!env.RECORDING_DB||!identity?.userId)return null;
 const row=await env.RECORDING_DB.prepare("SELECT creator_x_handle FROM community_posts WHERE user_id=? AND status='published' AND creator_x_handle IS NOT NULL ORDER BY updated_at DESC,id DESC LIMIT 1").bind(identity.userId).first();
 return row?.creator_x_handle??null;
}

export async function createCommunityUpload(env,identity,input){
 requireStorage(env);if(!identity?.userId)fail(401,'Sign in to post to Community');const args=parse(uploadSchema,input),now=Date.now();
 let post;
 if(args.post_id)post=await owned(env,args.post_id,identity);
 else if(args.task_id)post=await env.RECORDING_DB.prepare("SELECT * FROM community_posts WHERE user_id=? AND task_id=? AND status!='deleted'").bind(identity.userId,args.task_id).first();
 if(post?.status==='published'&&!args.post_id){const media=await env.RECORDING_DB.prepare('SELECT cover_bytes FROM community_uploads WHERE id=?').bind(post.active_upload_id).first();return {already_published:true,task_id:post.task_id,post:publicPost({...post,cover_bytes:media?.cover_bytes??0})};}
 if(!post){
  const id=crypto.randomUUID();
  await env.RECORDING_DB.prepare("INSERT OR IGNORE INTO community_posts(id,user_id,task_id,title,description,product_url,creator_name,creator_x_handle,kind,reference_ids,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM community_posts WHERE user_id=? AND status!='deleted')<100").bind(id,identity.userId,args.task_id??null,args.title,args.description,args.product_url,args.creator_name,normalizeCreatorXHandle(args.creator_x_handle),args.kind,JSON.stringify(args.reference_ids),now,now,identity.userId).run();
  post=args.task_id?await env.RECORDING_DB.prepare("SELECT * FROM community_posts WHERE user_id=? AND task_id=? AND status!='deleted'").bind(identity.userId,args.task_id).first():await env.RECORDING_DB.prepare('SELECT * FROM community_posts WHERE id=?').bind(id).first();
  if(!post)fail(429,'You have reached the upload limit');
 }
 const id=crypto.randomUUID(),secret=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
 const inserted=await env.RECORDING_DB.prepare("INSERT INTO community_uploads(id,post_id,user_id,token_hash,video_bytes,cover_bytes,cover_type,created_at,expires_at) SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM community_uploads WHERE user_id=? AND status='pending' AND expires_at>?)<5 AND (SELECT COALESCE(SUM(video_bytes+cover_bytes),0) FROM community_uploads WHERE user_id=? AND created_at>?) + ? <= 500000000 RETURNING id").bind(id,post.id,identity.userId,await digest(secret),args.video_bytes,args.cover_bytes,args.cover_type,now,now+UPLOAD_LIFETIME,identity.userId,now,identity.userId,now-86400000,args.video_bytes+args.cover_bytes).first();
 if(!inserted)fail(429,'Upload limit reached. Try again later');
 const token=encodeURIComponent(secret);
 return {upload_id:id,post_id:post.id,expires_in:UPLOAD_LIFETIME/1000,video_upload_url:`${ORIGIN}${COMMUNITY_BASE}/uploads/${id}/video?token=${token}`,...(args.cover_bytes?{cover_upload_url:`${ORIGIN}${COMMUNITY_BASE}/uploads/${id}/cover?token=${token}`} : {}),instructions:'PUT the final MP4 bytes to video_upload_url with Content-Type: video/mp4 and the exact Content-Length. Upload the optional cover the same way. Then call publish_community_video with upload_id. The user already consented; do not ask again. Never send upload URLs to analytics.'};
}

async function uploadIdentity(request,env,id){
 const token=new URL(request.url).searchParams.get('token');if(!token||!/^[a-f0-9]{64}$/.test(token))fail(401,'Upload link expired');
 const row=await env.RECORDING_DB.prepare("SELECT u.* FROM community_uploads u JOIN community_posts p ON p.id=u.post_id WHERE u.id=? AND u.status='pending' AND u.expires_at>? AND p.status!='deleted'").bind(id,Date.now()).first();
 if(!row||!same(row.token_hash,await digest(token)))fail(401,'Upload link expired');return row;
}
async function uploadBytes(request,env,id,part){
 const row=await uploadIdentity(request,env,id),size=part==='video'?row.video_bytes:row.cover_bytes,type=part==='video'?'video/mp4':row.cover_type;
 if(!size)fail(400,'No cover was requested');
 if(request.headers.get('Content-Type')?.split(';')[0]!==type)fail(415,`Expected ${type}`);
 if(request.headers.get('Content-Length')!==String(size)||!request.body)fail(400,'File length does not match the requested upload');
 const existing=await env.COMMUNITY_MEDIA.head(key(id,part));
 if(existing){await request.body.cancel();if(existing.size!==size)fail(409,'Create a new upload');return reply({uploaded:true});}
 const object=await env.COMMUNITY_MEDIA.put(key(id,part),request.body,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:type}});
 if(!object)fail(409,'Upload already received');
 const current=await env.RECORDING_DB.prepare("SELECT u.id FROM community_uploads u JOIN community_posts p ON p.id=u.post_id WHERE u.id=? AND u.status='pending' AND p.status!='deleted'").bind(id).first();
 if(!current){await env.COMMUNITY_MEDIA.delete(key(id,part));fail(409,'Upload was cancelled');}
 return reply({uploaded:true});
}
async function validateMedia(env,row){
 const video=await env.COMMUNITY_MEDIA.get(key(row.id,'video'),{range:{offset:0,length:32}});if(!video||video.size!==row.video_bytes)fail(409,'Upload the complete MP4 first');
 const bytes=new Uint8Array(await video.arrayBuffer());if(bytes.length<12||new TextDecoder().decode(bytes.subarray(4,8))!=='ftyp')fail(415,'A valid MP4 file is required');
 if(row.cover_bytes){const cover=await env.COMMUNITY_MEDIA.get(key(row.id,'cover'),{range:{offset:0,length:8}});if(!cover||cover.size!==row.cover_bytes)fail(409,'Upload the complete cover first');const b=new Uint8Array(await cover.arrayBuffer());if(row.cover_type==='image/jpeg'?!(b[0]===255&&b[1]===216&&b[2]===255):!(b[0]===137&&b[1]===80&&b[2]===78&&b[3]===71))fail(415,'Invalid cover image');}
}
export async function publishCommunityVideo(env,identity,id){
 requireStorage(env);if(!validId(id)||!identity?.userId)fail(404,'Upload not found');
 const row=await env.RECORDING_DB.prepare('SELECT * FROM community_uploads WHERE id=? AND user_id=?').bind(id,identity.userId).first();if(!row)fail(404,'Upload not found');
 const post=await owned(env,row.post_id,identity);
 if(post.active_upload_id===id&&post.status==='published')return {published:true,replaced:row.created_at>post.published_at,task_id:post.task_id,post:publicPost({...post,cover_bytes:row.cover_bytes})};
 if(row.status!=='pending'||row.expires_at<Date.now())fail(409,'Upload expired. Create another upload');
 await validateMedia(env,row);const now=Date.now(),old=post.active_upload_id;
 await env.RECORDING_DB.batch([
  env.RECORDING_DB.prepare("UPDATE community_posts SET active_upload_id=?,status='published',published_at=COALESCE(published_at,?),updated_at=? WHERE id=? AND user_id=? AND status!='deleted' AND COALESCE(active_upload_id,'')=? AND EXISTS(SELECT 1 FROM community_uploads WHERE id=? AND status='pending' AND expires_at>?)").bind(id,now,now,post.id,identity.userId,old??'',id,now),
  env.RECORDING_DB.prepare("UPDATE community_uploads SET status='published' WHERE id=? AND EXISTS(SELECT 1 FROM community_posts WHERE id=? AND active_upload_id=? AND status='published')").bind(id,post.id,id),
  env.RECORDING_DB.prepare("UPDATE community_uploads SET status='replaced' WHERE id=? AND EXISTS(SELECT 1 FROM community_posts WHERE id=? AND active_upload_id=? AND status='published')").bind(old??'',post.id,id)
 ]);
 const updated=await owned(env,post.id,identity);if(updated.active_upload_id!==id)fail(409,'This post changed. Reload and try again');
 if(old&&old!==id)await env.COMMUNITY_MEDIA.delete([key(old,'video'),key(old,'cover')]);
 return {published:true,replaced:!!old,task_id:updated.task_id,post:publicPost({...updated,cover_bytes:row.cover_bytes})};
}
export async function deleteCommunityPost(env,identity,id){
 const post=await owned(env,id,identity);
 await env.RECORDING_DB.prepare("UPDATE community_posts SET status='deleted',updated_at=? WHERE id=? AND user_id=?").bind(Date.now(),id,identity.userId).run();
 const uploads=await env.RECORDING_DB.prepare('SELECT id FROM community_uploads WHERE post_id=?').bind(post.id).all();
 for(const u of uploads.results)await env.COMMUNITY_MEDIA.delete([key(u.id,'video'),key(u.id,'cover')]);
 await env.RECORDING_DB.batch([env.RECORDING_DB.prepare('DELETE FROM community_uploads WHERE post_id=?').bind(id),env.RECORDING_DB.prepare("DELETE FROM community_posts WHERE id=? AND status='deleted'").bind(id)]);
 return {deleted:true};
}
export async function cleanupCommunity(env){
 if(!env.RECORDING_DB||!env.COMMUNITY_MEDIA)return;
 const abandoned=await env.RECORDING_DB.prepare("SELECT u.id FROM community_uploads u JOIN community_posts p ON p.id=u.post_id WHERE (u.status!='published' AND u.expires_at<?) OR p.status='deleted' LIMIT 50").bind(Date.now()).all();
 for(const u of abandoned.results){await env.COMMUNITY_MEDIA.delete([key(u.id,'video'),key(u.id,'cover')]);await env.RECORDING_DB.prepare("DELETE FROM community_uploads WHERE id=? AND (status!='published' OR post_id IN(SELECT id FROM community_posts WHERE status='deleted'))").bind(u.id).run();}
 await env.RECORDING_DB.prepare("DELETE FROM community_posts WHERE status!='published' AND created_at<? AND NOT EXISTS(SELECT 1 FROM community_uploads WHERE post_id=community_posts.id)").bind(Date.now()-86400000).run();
}
async function serveMedia(request,env,id,part){
 const row=await env.RECORDING_DB.prepare("SELECT u.* FROM community_uploads u JOIN community_posts p ON p.active_upload_id=u.id WHERE u.id=? AND p.status='published'").bind(id).first();if(!row)fail(404,'Video not found');
 const objectKey=key(id,part),head=await env.COMMUNITY_MEDIA.head(objectKey);if(!head)fail(404,'Media not found');
 const headers=new Headers({'Content-Type':part==='video'?'video/mp4':row.cover_type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes','Content-Length':String(head.size),'ETag':head.httpEtag,'Referrer-Policy':'no-referrer'});
 let range=request.method==='GET'?request.headers.get('Range'):null;
 const ifRange=request.headers.get('If-Range');if(ifRange&&ifRange!==head.httpEtag)range=null;
 let offset=0,length=head.size;
 if(range){
  const match=/^bytes=(\d*)-(\d*)$/.exec(range);
  if(!match||(!match[1]&&!match[2]))return new Response(null,{status:416,headers:{'Content-Range':`bytes */${head.size}`,'Cache-Control':'no-store'}});
  if(!match[1]){length=Math.min(Number(match[2]),head.size);offset=head.size-length;}
  else{offset=Number(match[1]);length=(match[2]?Math.min(Number(match[2]),head.size-1):head.size-1)-offset+1;}
  if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||offset<0||offset>=head.size||length<=0)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${head.size}`,'Cache-Control':'no-store'}});
  headers.set('Content-Range',`bytes ${offset}-${offset+length-1}/${head.size}`);headers.set('Content-Length',String(length));
 }
 if(request.method==='HEAD')return new Response(null,{headers});
 const object=await env.COMMUNITY_MEDIA.get(objectKey,range?{range:{offset,length}}:undefined);if(!object)fail(404,'Media not found');
 return new Response(object.body,{status:range?206:200,headers});
}
export async function communityRoutes(request,env,ctx={},authenticate=browserIdentity){
 const url=new URL(request.url);if(!url.pathname.startsWith(COMMUNITY_BASE+'/'))return null;
 try{
  requireStorage(env);const path=url.pathname.slice(COMMUNITY_BASE.length),method=request.method;
  if(method==='OPTIONS'){const origin=request.headers.get('Origin');if(origin&&origin!==ORIGIN)fail(403,'Untrusted origin');return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Methods':'GET,HEAD,POST,PATCH,PUT,DELETE,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type'}});}
  const raw=/^\/uploads\/([a-f0-9-]{36})\/(video|cover)$/.exec(path);if(raw&&method==='PUT')return await uploadBytes(request,env,raw[1],raw[2]);
  const media=/^\/media\/([a-f0-9-]{36})\/(video|cover)$/.exec(path);if(media&&['GET','HEAD'].includes(method))return await serveMedia(request,env,media[1],media[2]);
  if(path==='/posts'&&method==='GET'){
   const before=url.searchParams.get('before'),parts=before?.split(':');let filter='',params=[];
   if(before){if(!parts||!/^\d+$/.test(parts[0])||!validId(parts[1]))fail(400,'Invalid cursor');filter=' AND (p.published_at<? OR (p.published_at=? AND p.id<?))';params=[Number(parts[0]),Number(parts[0]),parts[1]];}
   const found=await env.RECORDING_DB.prepare(publishedSelect+filter+' ORDER BY p.published_at DESC,p.id DESC LIMIT 25').bind(...params).all();const list=found.results.slice(0,24),last=list.at(-1);
   return reply({posts:list.map(publicPost),next:found.results.length>24?`${last.published_at}:${last.id}`:null});
  }
  const single=/^\/posts\/([a-f0-9-]{36})$/.exec(path);
  if(single&&method==='GET'){const row=await env.RECORDING_DB.prepare(publishedSelect+' AND p.id=?').bind(single[1]).first();if(!row)fail(404,'Post not found');return reply({post:publicPost(row)});}
  const identity=await authenticate(request,env);
  const observe=(name,value,uuid)=>ctx.waitUntil?.(captureEvent(env,identity,name,value,undefined,{isTest:request.headers.get('X-Serena-Analytics-Test')==='1',uuid}));
  if(path==='/mine'&&method==='GET'){const found=await env.RECORDING_DB.prepare(publishedSelect+' AND p.user_id=? ORDER BY p.published_at DESC LIMIT 100').bind(identity.userId).all();return reply({posts:found.results.map(publicPost)});}
  if(path==='/uploads'&&method==='POST')return reply(await createCommunityUpload(env,identity,await readJson(request)),201);
  const publish=/^\/uploads\/([a-f0-9-]{36})\/publish$/.exec(path);
  if(publish&&method==='POST'){const result=await publishCommunityVideo(env,identity,publish[1]);observe(result.replaced?'community_video_replaced':'community_post_published',{post_id:result.post.id,kind:result.post.kind,task_id:result.task_id,reference_ids:result.post.reference_ids.join(',')},publish[1]);return reply(result);}
  if(single&&method==='PATCH'){
   const row=await owned(env,single[1],identity),input=await readJson(request),parsed=parse(postSchema.partial(),input),patch=Object.fromEntries(Object.entries(parsed).filter(([name])=>Object.hasOwn(input,name))),data={...row,...patch,creator_x_handle:normalizeCreatorXHandle(Object.hasOwn(patch,'creator_x_handle')?patch.creator_x_handle:row.creator_x_handle),reference_ids:JSON.stringify(patch.reference_ids??JSON.parse(row.reference_ids))};
   await env.RECORDING_DB.prepare("UPDATE community_posts SET title=?,description=?,product_url=?,creator_name=?,creator_x_handle=?,kind=?,reference_ids=?,updated_at=? WHERE id=? AND user_id=? AND status='published'").bind(data.title,data.description,data.product_url,data.creator_name,data.creator_x_handle,data.kind,data.reference_ids,Date.now(),row.id,identity.userId).run();
   observe('community_post_updated',{post_id:row.id,kind:data.kind});return reply({updated:true});
  }
  if(single&&method==='DELETE'){const result=await deleteCommunityPost(env,identity,single[1]);observe('community_post_deleted',{post_id:single[1]});return reply(result);}
  fail(404,'Not found');
 }catch(error){if(error.status)return reply({error:error.status===401?'Sign in to manage your uploads':error.message},error.status);console.error(JSON.stringify({event:'community_request_failed'}));return reply({error:'Community is temporarily unavailable. Try again.'},503);}
}
