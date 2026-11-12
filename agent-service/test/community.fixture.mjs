import {communityRoutes} from '../community.mjs';
export default {async fetch(request,env,ctx){return await communityRoutes(request,env,ctx,async req=>{const userId=req.headers.get('x-fixture-user');if(!userId)throw Object.assign(Error('Sign in'),{status:401});return {userId};})??new Response('Not found',{status:404});}};
