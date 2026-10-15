import {createRemoteJWKSet,jwtVerify} from 'jose';
const keys=new Map();
export function isLocal(request,env){return env.LOCAL_DEV==='true'&&['localhost','127.0.0.1','[::1]'].includes(new URL(request.url).hostname);}
export async function staff(request,env){
 if(isLocal(request,env))return 'local-preview';
 if(!env.ACCESS_TEAM_DOMAIN||!env.ACCESS_AUD)throw Object.assign(new Error('Staff sign-in is not configured.'),{status:503});
 const token=request.headers.get('Cf-Access-Jwt-Assertion');if(!token)throw Object.assign(new Error('Staff sign-in required.'),{status:401});
 const domain=env.ACCESS_TEAM_DOMAIN;
 if(!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain))throw new Error('Invalid Access configuration.');
 try{if(!keys.has(domain))keys.set(domain,createRemoteJWKSet(new URL(`https://${domain}/cdn-cgi/access/certs`)));
 const {payload}=await jwtVerify(token,keys.get(domain),{issuer:`https://${domain}`,audience:env.ACCESS_AUD});return payload.email||payload.sub;
 }catch{throw Object.assign(new Error('Staff sign-in required.'),{status:401});}
}
