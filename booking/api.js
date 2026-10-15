import {emailReady,sendConfirmation} from './email.js';
import {stripe,verifySignature} from './stripe.js';
import {staff,isLocal} from './auth.js';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
export const json=(data,status=200)=>Response.json(data,{status,headers});
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const id=()=>crypto.randomUUID();
export async function body(request){if(Number(request.headers.get('Content-Length')||0)>20000)fail('Request too large.',413);const raw=await request.text();if(raw.length>20000)fail('Request too large.',413);try{return JSON.parse(raw);}catch{fail('Invalid request.');}}
function text(value,max,required=true){if(typeof value!=='string'||value.trim().length>max||(required&&!value.trim()))fail('Please complete all required fields.');return value.trim();}
export function validateEvent(data){
 const event={title:text(data.title,150),description:text(data.description||'',6000,false),start:text(data.start,40),end:text(data.end,40),deadline:text(data.deadline,40),price_cents:data.price_cents,capacity:data.capacity,status:data.status,policy:text(data.policy,2000)};
 for(const field of ['start','end','deadline']){if(!Number.isFinite(Date.parse(event[field])))fail('Please enter valid dates.');event[field]=new Date(event[field]).toISOString();}
 if(event.end<=event.start||event.deadline>event.start)fail('End must follow start, and registration must close by the start.');
 if(!Number.isInteger(event.capacity)||event.capacity<1||event.capacity>10000||!Number.isInteger(event.price_cents)||event.price_cents<0||event.price_cents>1000000)fail('Check the price and capacity.');
 if(!['draft','published','closed','cancelled'].includes(event.status))fail('Choose a valid event status.');return event;
}
const all=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
const one=(db,sql,...args)=>db.prepare(sql).bind(...args).first();
const run=(db,sql,...args)=>db.prepare(sql).bind(...args).run();
async function audit(env,actor,action,target){await run(env.DB,'INSERT INTO audit_log(actor,action,target) VALUES(?,?,?)',actor,action,target);}
export async function limit(env,key,max){const now=Math.floor(Date.now()/1000);const record=await env.DB.prepare(`INSERT INTO request_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END RETURNING count`).bind(key,now+3600,now,now).first();if(record.count>max)fail('Too many attempts. Please try again later.',429);}
export async function publicEvents(env,month){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))fail('Choose a valid month.');
 const [y,m]=month.split('-').map(Number);const lower=new Date(Date.UTC(y,m-1,1)-86400000).toISOString(),upper=new Date(Date.UTC(y,m,1)+86400000).toISOString();
 return all(env.DB,`SELECT e.*,MAX(0,e.capacity-COALESCE((SELECT SUM(quantity) FROM orders o WHERE o.event_id=e.id AND o.status IN ('creating','held','paid','refunded')),0)) AS available FROM events e WHERE e.status IN ('published','closed') AND e.start>=? AND e.start<? ORDER BY e.start`,lower,upper);
}
async function getEvent(env,eventId){return one(env.DB,`SELECT e.*,MAX(0,e.capacity-COALESCE((SELECT SUM(quantity) FROM orders o WHERE o.event_id=e.id AND o.status IN ('creating','held','paid','refunded')),0)) AS available FROM events e WHERE id=?`,eventId);}
function buyer(data){const email=text(data.email,254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('Enter a valid email address.');if(!Array.isArray(data.names)||data.names.length<1||data.names.length>8)fail('Choose between 1 and 8 tickets.');return {email,names:data.names.map(n=>text(n,120))};}
export async function reserve(env,event,data,source='online'){
 const {email,names}=buyer(data);
 const orderId=source==='online'?text(data.requestId,36):id();
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId))fail('Invalid checkout request.');
 async function existing(){
  const previous=await one(env.DB,'SELECT * FROM orders WHERE id=?',orderId);
  if(!previous)return null;
  const stored=await all(env.DB,'SELECT name FROM attendees WHERE order_id=? ORDER BY rowid',orderId);
  if(previous.event_id!==event.id||previous.email!==email||JSON.stringify(stored.map(a=>a.name))!==JSON.stringify(names))fail('Checkout request already used.',409);
  if(previous.status==='released'||previous.status==='refunded')fail('This reservation is closed. Start a new booking.',409);
  return previous;
 }
 const previous=await existing();if(previous)return previous;
 const token=id()+id();const expires=Math.floor(Date.now()/1000)+1860;
 const total=event.price_cents*names.length;
 const statements=[env.DB.prepare(`INSERT INTO orders(id,event_id,email,quantity,total_cents,status,source,expires_at,receipt_token,policy_snapshot) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(orderId,event.id,email,names.length,total,source==='store'||total===0?'paid':'creating',source,expires,token,event.policy),...names.map(name=>env.DB.prepare('INSERT INTO attendees(id,order_id,name) VALUES(?,?,?)').bind(id(),orderId,name))];
 try{await env.DB.batch(statements);}catch(error){const previous=await existing();if(previous)return previous;if(/Not enough seats|Registration is closed/.test(error.message))fail('Those seats are no longer available. Please refresh the event.',409);throw error;}
 return one(env.DB,'SELECT * FROM orders WHERE id=?',orderId);
}
async function checkoutSession(env,order,event,origin){
 let payload=order.checkout_payload?JSON.parse(order.checkout_payload):null;
 if(!payload){payload={mode:'payment','payment_method_types[0]':'card',customer_email:order.email,client_reference_id:order.id,'metadata[order_id]':order.id,'line_items[0][price_data][currency]':'usd','line_items[0][price_data][unit_amount]':String(order.total_cents/order.quantity),'line_items[0][price_data][product_data][name]':event.title,'line_items[0][quantity]':String(order.quantity),expires_at:String(order.expires_at),success_url:`${origin}/registration?token=${order.receipt_token}`,cancel_url:`${origin}/registration?token=${order.receipt_token}&cancelled=1`};
 const saved=await run(env.DB,"UPDATE orders SET checkout_payload=? WHERE id=? AND status='creating'",JSON.stringify(payload),order.id);if(saved.meta.changes!==1)fail('Reservation is no longer active.',409);}
 const session=await stripe(env,'checkout/sessions',payload,`checkout-${order.id}`);
 await run(env.DB,"UPDATE orders SET stripe_session=?,checkout_url=?,status='held' WHERE id=? AND status='creating'",session.id,session.url,order.id);
 return session;
}
async function confirmation(env,orderId){
 const order=await one(env.DB,`SELECT o.*,e.title,e.start FROM orders o JOIN events e ON e.id=o.event_id WHERE o.id=?`,orderId);
 if(!order||order.status!=='paid'||order.email_sent_at||!emailReady(env))return;
 const names=(await all(env.DB,'SELECT name FROM attendees WHERE order_id=?',orderId)).map(a=>a.name).join(', ');
 const text=`You're registered for ${order.title}.\n\n${new Date(order.start).toLocaleString('en-US',{timeZone:'America/New_York'})} Eastern\n300 Litchfield Road, Suite 1, Harwinton, CT 06791\n\nAttendees: ${names}\nReference: ${order.id}\n\nQuestions? holohideout@yahoo.com`;
 try{await sendConfirmation(env,{orderId,email:order.email,title:order.title,text});await run(env.DB,'UPDATE orders SET email_sent_at=?,email_error=NULL WHERE id=?',new Date().toISOString(),orderId);}catch(error){await run(env.DB,'UPDATE orders SET email_error=? WHERE id=?',error.message,orderId);}
}
export async function reconcile(env,order,session){
 if(session.id!==order.stripe_session||session.client_reference_id!==order.id)return;
 if(session.payment_status==='paid'){
  if(session.amount_total!==order.total_cents||session.currency!=='usd')throw new Error('Payment amount mismatch.');
  await run(env.DB,"UPDATE orders SET status='paid',payment_intent=? WHERE id=? AND status IN ('creating','held')",session.payment_intent,order.id);
  await confirmation(env,order.id);
 }else if(session.status==='expired')await run(env.DB,"UPDATE orders SET status='released' WHERE id=? AND status IN ('creating','held')",order.id);
}
export async function housekeeping(env){
 if(!env.DB)return;
 const orders=await all(env.DB,"SELECT * FROM orders WHERE status='held' OR (status='creating' AND (checkout_payload IS NULL OR julianday(created_at)>julianday('now','-23 hours'))) ORDER BY created_at LIMIT 100");
 for(const order of orders){try{
  if(order.status==='creating'&&!order.checkout_payload&&Date.parse(order.created_at)<Date.now()-120000){await run(env.DB,"UPDATE orders SET status='released' WHERE id=? AND status='creating' AND checkout_payload IS NULL",order.id);continue;}
  if(order.stripe_session)await reconcile(env,order,await stripe(env,`checkout/sessions/${order.stripe_session}`));
  else if(order.status==='creating'&&env.STRIPE_SECRET_KEY){
   // Repeat the exact create request with its original idempotency key after ambiguous network failures.
   const event=await getEvent(env,order.event_id);
   if(order.checkout_payload && Date.parse(order.created_at)>Date.now()-23*3600000)await checkoutSession(env,order,event,env.SITE_URL);
   // Older unresolved creations remain reserved for manual review rather than risking a paid oversell.
  }
 }catch{ /* Reconcile on the next run; never release a seat on a network error. */ }}
 for(const o of await all(env.DB,"SELECT id FROM orders WHERE status='paid' AND email_sent_at IS NULL LIMIT 50"))await confirmation(env,o.id);
 await run(env.DB,'DELETE FROM request_limits WHERE expires_at<?',Math.floor(Date.now()/1000));
}
async function webhook(request,env){
 const raw=await request.text();if(raw.length>1000000)fail('Payload too large.',413);
 if(!await verifySignature(raw,request.headers.get('Stripe-Signature'),env.STRIPE_WEBHOOK_SECRET))fail('Invalid payment signature.',400);
 const message=JSON.parse(raw);if(await one(env.DB,'SELECT id FROM payment_events WHERE id=?',message.id))return json({received:true});
 if(['checkout.session.completed','checkout.session.expired','checkout.session.async_payment_succeeded'].includes(message.type)){
  const session=message.data.object;const order=await one(env.DB,'SELECT * FROM orders WHERE stripe_session=?',session.id);if(!order)fail('Order is not linked yet. Please retry.',503);await reconcile(env,order,session);
 }
 if(message.type==='charge.refunded'){
  const charge=message.data.object;
  if(charge.refunded)await run(env.DB,"UPDATE orders SET status='refunded' WHERE payment_intent=? AND status='paid'",charge.payment_intent);
 }
 await run(env.DB,'INSERT OR IGNORE INTO payment_events(id) VALUES(?)',message.id);return json({received:true});
}
export async function api(request,env,ctx){
 const url=new URL(request.url),path=url.pathname;
 if(!env.DB)return json({error:'Registration database is not configured.'},503);
 if(path==='/api/stripe/webhook'&&request.method==='POST')return webhook(request,env);
 if(!['GET','HEAD'].includes(request.method)&&request.headers.get('Origin')!==url.origin)fail('Request origin is not allowed.',403);
 if(path==='/api/bookings/events'&&request.method==='GET')return json({events:await publicEvents(env,url.searchParams.get('month')||''),paymentsReady:Boolean(env.STRIPE_SECRET_KEY)});
 if(path==='/api/bookings/checkout'&&request.method==='POST'){
  await limit(env,`checkout:${request.headers.get('CF-Connecting-IP')||'local'}`,30);
  const data=await body(request),event=await getEvent(env,data.eventId);
  if(!event||event.status!=='published')fail('Event not available.',404);
  if(!data.acceptPolicy)fail('Please accept the event cancellation policy.');
  if(event.price_cents>0&&!env.STRIPE_SECRET_KEY)fail('Online payments are not available yet. Please call the shop.',503);
  const order=await reserve(env,event,data);
  if(order.status==='paid'){ctx.waitUntil(confirmation(env,order.id));return json({url:`/registration?token=${order.receipt_token}`});}
  if(order.status==='held'&&order.checkout_url)return json({url:order.checkout_url});
  try{const session=await checkoutSession(env,order,event,url.origin);return json({url:session.url});}
  catch(error){if(error.definitive)await run(env.DB,"UPDATE orders SET status='released' WHERE id=? AND status='creating'",order.id);return json({error:'Checkout could not be opened. Check your reservation before trying again.',reservationUrl:`/registration?token=${order.receipt_token}`},503);}
 }
 if(path==='/api/bookings/order'&&request.method==='GET'){
  const token=url.searchParams.get('token');if(!token||token.length>100)fail('Reservation not found.',404);
  let order=await one(env.DB,'SELECT * FROM orders WHERE receipt_token=?',token);if(!order)fail('Reservation not found.',404);
  if(order.stripe_session&&['held','creating'].includes(order.status)){await reconcile(env,order,await stripe(env,`checkout/sessions/${order.stripe_session}`));order=await one(env.DB,'SELECT * FROM orders WHERE id=?',order.id);}
  const event=await getEvent(env,order.event_id);const attendees=await all(env.DB,'SELECT name FROM attendees WHERE order_id=?',order.id);
  return json({id:order.id,status:order.status,total_cents:order.total_cents,quantity:order.quantity,title:event.title,start:event.start,names:attendees.map(a=>a.name),checkoutUrl:order.status==='held'?order.checkout_url:null,emailConfigured:emailReady(env),policy:order.policy_snapshot});
 }
 if(path.startsWith('/api/admin/')){
  const actor=await staff(request,env);
  if(path==='/api/admin/session')return json({actor,local:isLocal(request,env),paymentsReady:Boolean(env.STRIPE_SECRET_KEY),emailReady:emailReady(env)});
  if(path==='/api/admin/events'&&request.method==='GET')return json({events:await all(env.DB,`SELECT e.*,COALESCE((SELECT SUM(quantity) FROM orders WHERE event_id=e.id AND status='paid'),0) AS paid,COALESCE((SELECT SUM(quantity) FROM orders WHERE event_id=e.id AND status IN ('creating','held')),0) AS held FROM events e ORDER BY start DESC`)});
  if(path==='/api/admin/events'&&request.method==='POST'){
   const data=await body(request),event=validateEvent(data),eventId=data.id||id();
   if(data.id&&!await getEvent(env,data.id))fail('Event not found.',404);
   const values=[event.title,event.description,event.start,event.end,event.deadline,event.price_cents,event.capacity,event.status,event.policy];
   if(data.id)await run(env.DB,'UPDATE events SET title=?,description=?,start=?,end=?,deadline=?,price_cents=?,capacity=?,status=?,policy=? WHERE id=?',...values,eventId);
   else await run(env.DB,'INSERT INTO events(title,description,start,end,deadline,price_cents,capacity,status,policy,id) VALUES(?,?,?,?,?,?,?,?,?,?)',...values,eventId);
   await audit(env,actor,data.id?'event.update':'event.create',eventId);return json({id:eventId});
  }
  const match=path.match(/^\/api\/admin\/events\/([^/]+)\/(attendees|store|export)$/);
  if(match){const event=await getEvent(env,match[1]);if(!event)fail('Event not found.',404);
   if(match[2]==='store'&&request.method==='POST'){const order=await reserve(env,event,await body(request),'store');await audit(env,actor,'order.store',order.id);ctx.waitUntil(confirmation(env,order.id));return json({id:order.id});}
   const rows=await all(env.DB,'SELECT a.id,a.name,a.checked_in,o.id AS order_id,o.email,o.status,o.quantity,o.total_cents,o.source,o.created_at,o.email_sent_at,o.email_error FROM attendees a JOIN orders o ON o.id=a.order_id WHERE o.event_id=? ORDER BY o.created_at,a.name',event.id);
   if(match[2]==='export'&&request.method==='GET'){
    const quote=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
    const fields=['name','email','status','checked_in','order_id','source'];return new Response([fields.join(','),...rows.map(r=>fields.map(k=>quote(r[k])).join(','))].join('\r\n'),{headers:{...headers,'Content-Type':'text/csv;charset=utf-8','Content-Disposition':'attachment; filename="attendees.csv"'}});
   }
   if(match[2]==='attendees'&&request.method==='GET')return json({event,attendees:rows});
  }
  const check=path.match(/^\/api\/admin\/attendees\/([^/]+)$/);
  if(check&&request.method==='POST'){const data=await body(request);await run(env.DB,"UPDATE attendees SET checked_in=? WHERE id=? AND order_id IN (SELECT id FROM orders WHERE status='paid')",data.checked_in?1:0,check[1]);await audit(env,actor,'attendee.checkin',check[1]);return json({ok:true});}
  const action=path.match(/^\/api\/admin\/orders\/([^/]+)\/(release|refund|reconcile)$/);
  if(action&&request.method==='POST'){
   const order=await one(env.DB,'SELECT * FROM orders WHERE id=?',action[1]);if(!order)fail('Order not found.',404);
   if(action[2]==='reconcile'){
    if(order.stripe_session)await reconcile(env,order,await stripe(env,`checkout/sessions/${order.stripe_session}`));
    else if(order.status==='creating'){const event=await getEvent(env,order.event_id);await checkoutSession(env,order,event,env.SITE_URL||url.origin);}
   }else if(action[2]==='refund'){
    if(order.status!=='paid')fail('Only paid orders can be refunded.');
    if(order.source==='store'||!order.payment_intent)fail('Return in-store payments manually, then record the cancellation using Release.');
    const refund=await stripe(env,'refunds',{payment_intent:order.payment_intent},`refund-${order.id}`);
    if(refund.status==='succeeded')await run(env.DB,"UPDATE orders SET status='refunded' WHERE id=?",order.id);
   }else{
    if(order.status==='paid'&&order.source==='online'&&order.total_cents>0)fail('Refund the payment before releasing these seats.');
    if(order.stripe_session&&['held','creating'].includes(order.status)){
     let session=await stripe(env,`checkout/sessions/${order.stripe_session}`);
     if(session.status==='open')session=await stripe(env,`checkout/sessions/${order.stripe_session}/expire`,{},`expire-${order.id}`);
     if(session.status!=='expired')fail('Payment may have completed. Reconcile this order before releasing seats.',409);
    }else if(order.status==='creating'){
     if(order.checkout_payload)fail('Unresolved checkout: reconcile it before releasing seats.',409);
     const released=await run(env.DB,"UPDATE orders SET status='released' WHERE id=? AND status='creating' AND checkout_payload IS NULL",order.id);
     if(released.meta.changes!==1)fail('Checkout changed; reconcile it before releasing seats.',409);
    }
    await run(env.DB,"UPDATE orders SET status='released' WHERE id=?",order.id);
   }
   await audit(env,actor,`order.${action[2]}`,order.id);return json({ok:true});
  }
 }
 return json({error:'Not found.'},404);
}
