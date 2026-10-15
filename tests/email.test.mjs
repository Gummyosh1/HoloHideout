import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emailReady,sendConfirmation} from '../booking/email.js';
const env={BREVO_API_KEY:'test-only-key',EMAIL_FROM:'events@example.test'};
const message={orderId:'123e4567-e89b-42d3-a456-426614174000',email:'guest@example.test',title:'Card night',text:'Your registration is confirmed.'};
test('Brevo request uses server credentials, verified sender, buyer and shop reply address',async()=>{
 let called=0;
 const result=await sendConfirmation(env,message,async(url,options)=>{called++;assert.equal(url,'https://api.brevo.com/v3/smtp/email');assert.equal(options.headers['api-key'],env.BREVO_API_KEY);const data=JSON.parse(options.body);assert.deepEqual(data.sender,{name:'Holo Hideout',email:env.EMAIL_FROM});assert.deepEqual(data.to,[{email:message.email}]);assert.equal(data.replyTo.email,'holohideout@yahoo.com');assert.equal(data.textContent,message.text);assert.equal(data.headers.idempotencyKey,message.orderId);return Response.json({messageId:'test-provider-id'},{status:201});});assert.equal(result,'test-provider-id');assert.equal(called,1);
});
test('missing sender credentials prevent sending',async()=>{assert.equal(emailReady({}),false);assert.equal(emailReady({...env,EMAIL_FROM:'Shop <events@example.test>'}),false);await assert.rejects(()=>sendConfirmation({},message,()=>{throw Error('Must not call provider');}),/not configured/);});
test('Brevo limits and errors leave confirmation unaccepted',async()=>{
 await assert.rejects(()=>sendConfirmation(env,message,async()=>Response.json({},{status:429})),/limit reached/);
 await assert.rejects(()=>sendConfirmation(env,message,async()=>Response.json({},{status:401})),/rejected/);
 await assert.rejects(()=>sendConfirmation(env,message,async()=>Response.json({})),/did not confirm/);
});
