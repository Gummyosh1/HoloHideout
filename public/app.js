import {managedEvents,bookingControls} from './bookings.js';
const zone = 'America/New_York';
const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'long',hour:'numeric',minute:'numeric',hourCycle:'h23'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
let month = new Date(Date.UTC(+parts.year,+parts.month-1,1));
let requestNumber = 0;
const list = document.querySelector('#event-list');
const format = (date, options) => new Intl.DateTimeFormat('en-US', {timeZone:zone,...options}).format(date);
function element(tag,text,className){const node=document.createElement(tag);node.textContent=text;if(className)node.className=className;return node;}
function eventDate(event){return new Date(event.allDay ? `${event.start}T12:00:00-05:00` : event.start);}

function descriptionNode(source){
  const output=element('p','','event-description');
  const parsed=new DOMParser().parseFromString(source,'text/html');
  function safeLink(href,label){
    try{const url=new URL(href);if(!['http:','https:'].includes(url.protocol))return null;const link=element('a',label);link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';return link;}catch{return null;}
  }
  function textWithLinks(text){
    const pattern=/https?:\/\/[^\s<>]+/g;let offset=0;
    for(const match of text.matchAll(pattern)){output.append(document.createTextNode(text.slice(offset,match.index)));const href=match[0].replace(/[.,;!?)]*$/,'');output.append(safeLink(href,href)||document.createTextNode(href));output.append(document.createTextNode(match[0].slice(href.length)));offset=match.index+match[0].length;}
    output.append(document.createTextNode(text.slice(offset)));
  }
  function walk(node){
    if(node.nodeType===3){textWithLinks(node.textContent);return;}
    if(node.nodeType!==1)return;
    if(['SCRIPT','STYLE','IFRAME','OBJECT'].includes(node.tagName))return;
    if(node.tagName==='A'){output.append(safeLink(node.getAttribute('href'),node.textContent)||document.createTextNode(node.textContent));return;}
    if(node.tagName==='BR'){output.append(document.createTextNode('\n'));return;}
    for(const child of node.childNodes)walk(child);
    if(['P','DIV','LI'].includes(node.tagName))output.append(document.createTextNode('\n'));
  }
  for(const child of parsed.body.childNodes)walk(child);
  return output;
}

async function loadEvents(){
  const number=++requestNumber;
  const key=month.toISOString().slice(0,7);
  document.querySelector('#month-label').textContent=format(month,{month:'long',year:'numeric',timeZone:'UTC'});
  document.querySelector('#prev').disabled=month.getUTCFullYear()<=2020&&month.getUTCMonth()===0;
  document.querySelector('#next').disabled=month.getUTCFullYear()>=2100&&month.getUTCMonth()===11;
  list.setAttribute('aria-busy','true');list.replaceChildren(element('p','Loading the schedule…','event-message'));
  try{
    const results=await Promise.allSettled([
      fetch(`/api/events?month=${key}`,{signal:AbortSignal.timeout(15000),cache:'no-store'}).then(async r=>{if(!r.ok)throw Error('Calendar unavailable');return (await r.json()).events;}),
      managedEvents(key)
    ]);
    if(results.every(r=>r.status==='rejected'))throw Error('Schedule unavailable');
    const data={events:results.flatMap(r=>r.status==='fulfilled'?r.value:[]).sort((a,b)=>a.start.localeCompare(b.start))};
    if(number!==requestNumber)return;
    const events=data.events.filter(event=>format(eventDate(event),{year:'numeric',month:'2-digit',timeZone:zone}).replace(/(\d{2})\/(\d{4})/,'$2-$1')===key);
    list.replaceChildren();
    if(!events.length)list.append(element('p','No events posted for this month yet. Check back soon, or call the shop to see what’s happening.','event-message'));
    for(const event of events){
      const date=eventDate(event);const row=element('article','','event-row');
      const badge=element('div',format(date,{weekday:'short'}).toUpperCase(),'event-date');badge.append(element('strong',format(date,{day:'numeric'})));
      const content=element('div','');content.append(element('h4',event.title));
      let time='All day';
      if(!event.allDay){time=format(date,{hour:'numeric',minute:'2-digit'});if(event.end&&event.end!==event.start){const end=new Date(event.end);const sameDay=format(date,{year:'numeric',month:'numeric',day:'numeric'})===format(end,{year:'numeric',month:'numeric',day:'numeric'});time+=' – '+format(end,sameDay?{hour:'numeric',minute:'2-digit'}:{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});}}
      content.append(element('p',time,'time'));
      if(event.description)content.append(descriptionNode(event.description));
      if(event.location)content.append(element('p',event.location));
      if(event.managed)content.append(bookingControls(event));
      row.append(badge,content);list.append(row);
    }
  }catch{if(number!==requestNumber)return;const message=element('p','The schedule is taking a break. Please call the shop for upcoming events, or try again.','event-message');const retry=element('button','Try again');retry.addEventListener('click',loadEvents);list.replaceChildren(message,retry);}
  finally{if(number===requestNumber)list.setAttribute('aria-busy','false');}
}
document.querySelector('#prev').addEventListener('click',()=>{month.setUTCMonth(month.getUTCMonth()-1);loadEvents();});
document.querySelector('#next').addEventListener('click',()=>{month.setUTCMonth(month.getUTCMonth()+1);loadEvents();});
document.querySelector('#today').addEventListener('click',()=>{const now=new Date();const date=format(now,{year:'numeric',month:'2-digit'}).split('/');month=new Date(Date.UTC(+date[1],+date[0]-1,1));loadEvents();});
function updateHours(){const values=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'long',hour:'numeric',minute:'numeric',hourCycle:'h23'}).formatToParts(new Date()).map(p=>[p.type,p.value]));const day=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].indexOf(values.weekday);const hours=[[12,19],[15,19],null,[15,20],null,[15,20],[15,20]][day];const now=+values.hour + +values.minute/60;document.querySelector('#shop-status').textContent=hours&&now>=hours[0]&&now<hours[1]?'OPEN NOW':'CLOSED NOW';document.querySelectorAll('[data-day]').forEach(row=>row.classList.toggle('current',+row.dataset.day===day));}
loadEvents();updateHours();setInterval(updateHours,60000);setInterval(()=>{if(!document.hidden)loadEvents();},300000);
