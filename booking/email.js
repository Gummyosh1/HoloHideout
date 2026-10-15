export function emailReady(env){
 return Boolean(env.BREVO_API_KEY && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(env.EMAIL_FROM||''));
}
export async function sendConfirmation(env,{orderId,email,title,text},fetcher=fetch){
 if(!emailReady(env))throw new Error('Brevo sender is not configured.');
 const response=await fetcher('https://api.brevo.com/v3/smtp/email',{
  method:'POST',
  headers:{'api-key':env.BREVO_API_KEY,Accept:'application/json','Content-Type':'application/json'},
  body:JSON.stringify({
   sender:{name:'Holo Hideout',email:env.EMAIL_FROM},
   to:[{email}],replyTo:{name:'Holo Hideout',email:'holohideout@yahoo.com'},
   subject:`Your Holo Hideout registration: ${title}`,textContent:text,
   headers:{idempotencyKey:orderId},tags:['event-confirmation']
  }),signal:AbortSignal.timeout(15000)
 });
 if(!response.ok)throw new Error(response.status===429?'Brevo sending limit reached; confirmation will be retried.':'Brevo rejected confirmation; check sender verification and API settings.');
 const result=await response.json();
 if(!result.messageId)throw new Error('Brevo did not confirm acceptance.');
 return result.messageId;
}
