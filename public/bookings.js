const make=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
export async function managedEvents(month){const r=await fetch(`/api/bookings/events?month=${month}`,{cache:'no-store'});if(!r.ok)throw Error('Registration unavailable');const data=await r.json();return data.events.map(e=>({...e,allDay:false,managed:true,paymentsReady:data.paymentsReady}));}
export function bookingControls(event){
 const row=make('div','');row.className='event-booking';row.append(make('span',`${money(event.price_cents)} · ${event.available} seats available`));
 const closed=event.status!=='published'||Date.parse(event.deadline)<=Date.now()||Date.parse(event.start)<=Date.now();
 const label=closed?'Registration closed':event.available===0?'Sold out':event.price_cents>0&&!event.paymentsReady?'Call to register':'Book a seat ↗';
 const button=make('button',label);button.className='button';button.disabled=closed||event.available===0;
 button.addEventListener('click',()=>{if(event.price_cents>0&&!event.paymentsReady){location.href='tel:+18606059032';return;}openBooking(event);});row.append(button);return row;
}
function openBooking(event){
 const requestId=crypto.randomUUID();
 const dialog=document.createElement('dialog');dialog.className='booking-overlay';const inner=make('div','');inner.className='booking-inner';const close=make('button','Close ×');close.className='booking-close';close.addEventListener('click',()=>dialog.close());inner.append(close,make('p','SAVE YOUR SEAT'),make('h2',event.title),make('p',new Date(event.start).toLocaleString('en-US',{timeZone:'America/New_York',dateStyle:'full',timeStyle:'short'})+' ET'));
 const heading=inner.querySelector('h2');heading.id='booking-title';dialog.setAttribute('aria-labelledby',heading.id);
 const form=document.createElement('form');form.className='form-grid';
 const label=(text,control)=>{const l=make('label',text);l.append(control);form.append(l);};
 const email=document.createElement('input');email.type='email';email.required=true;email.maxLength=254;email.autocomplete='email';label('Your email',email);
 const quantity=document.createElement('select');for(let i=1;i<=Math.min(8,event.available);i++){const option=make('option',String(i));option.value=i;quantity.append(option);}label('Number of tickets',quantity);
 const names=make('div','');form.append(names);
 function renderNames(){const previous=Array.from(names.querySelectorAll('input'),i=>i.value);names.replaceChildren();for(let i=0;i<+quantity.value;i++){const l=make('label',`Attendee ${i+1} name`);const input=document.createElement('input');input.required=true;input.maxLength=120;input.value=previous[i]||'';l.append(input);names.append(l);}total.textContent=`Total: ${money(event.price_cents*+quantity.value)}`;}
 const total=make('p','');form.append(total);quantity.addEventListener('change',renderNames);renderNames();
 const policy=make('p',event.policy);policy.className='hint';form.append(policy);
 const accepted=document.createElement('input');accepted.type='checkbox';accepted.required=true;const acceptLabel=make('label','');acceptLabel.className='check';acceptLabel.append(accepted,document.createTextNode('I agree to the cancellation / refund policy above.'));form.append(acceptLabel);
 const submit=make('button',event.price_cents?'Continue to secure payment ↗':'Confirm registration');submit.className='button';submit.type='submit';const message=make('p','');message.setAttribute('role','status');form.append(submit,message);
 form.addEventListener('submit',async e=>{e.preventDefault();submit.disabled=true;message.textContent='Reserving your seats…';try{const response=await fetch('/api/bookings/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId,eventId:event.id,email:email.value,names:Array.from(names.querySelectorAll('input'),i=>i.value),acceptPolicy:accepted.checked})});const data=await response.json();if(!response.ok){if(data.reservationUrl){message.replaceChildren(make('span',data.error+' '));const link=make('a','View reservation');link.href=data.reservationUrl;message.append(link);return;}throw Error(data.error||'Unable to register.');}location.href=data.url;}catch(error){message.textContent=error.message;submit.disabled=false;}});
 inner.append(form);dialog.append(inner);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();
}
