export async function stripe(env,path,body,key){
 if(!env.STRIPE_SECRET_KEY)throw new Error('Payments are not configured.');
 const response=await fetch(`https://api.stripe.com/v1/${path}`,{
  method:body?'POST':'GET',headers:{Authorization:`Bearer ${env.STRIPE_SECRET_KEY}`,...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(key?{'Idempotency-Key':key}:{})},
  body:body?new URLSearchParams(body):undefined,signal:AbortSignal.timeout(20000)
 });
 const result=await response.json();if(!response.ok){const error=new Error('Payment provider unavailable.');error.definitive=response.status===400||response.status===401||response.status===403;throw error;}return result;
}
export async function verifySignature(raw,header,secret,now=Date.now()){
 if(!secret||!header)return false;
 const fields=header.split(',').map(v=>v.split('='));const time=fields.find(v=>v[0]==='t')?.[1];
 if(!/^\d+$/.test(time||'')||Math.abs(now/1000-Number(time))>300)return false;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${time}.${raw}`)));
 const expected=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
 return fields.filter(v=>v[0]==='v1').some(([,v])=>{if(v.length!==expected.length)return false;let diff=0;for(let i=0;i<v.length;i++)diff|=v.charCodeAt(i)^expected.charCodeAt(i);return diff===0;});
}
