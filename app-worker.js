import calendar from './worker.js';
import {api,json,housekeeping} from './booking/api.js';
import {staff} from './booking/auth.js';
export default {
 async fetch(request,env,ctx){
  try{
   const url=new URL(request.url);
   if(url.pathname.startsWith('/api/')&&url.pathname!=='/api/events')return await api(request,env,ctx);
   if(url.pathname==='/admin'||url.pathname==='/admin.html'||url.pathname.startsWith('/admin/')){
    await staff(request,env);
    const response=await env.ASSETS.fetch(request);
    const result=new Response(response.body,response);result.headers.set('Cache-Control','no-store');return result;
   }
   return await calendar.fetch(request,env,ctx);
  }catch(error){
   const expected=error.status||(/Capacity is below/.test(error.message)?409:500);
   if(expected===500)console.error('Request failed:',error.message);
   return json({error:expected===500?'Something went wrong. Please try again.':error.message},expected);
  }
 },
 async scheduled(controller,env,ctx){ctx.waitUntil(housekeeping(env));}
};
