import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../worker.js',import.meta.url),'utf8').replace(/export\s*\{\s*worker_default as default\s*\};/,'');
const context={Intl,Date,Map,Response,URL,AbortSignal,fetch};runInNewContext(source,context);
const feed=(events)=>`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-TIMEZONE:America/New_York\r\n${events}\r\nEND:VCALENDAR`;
test('weekly recurrence excludes cancelled and omitted occurrences',()=>{
const result=context.parseCalendar(feed('BEGIN:VEVENT\r\nUID:weekly\r\nDTSTART:20261002T210000Z\r\nDTEND:20261002T230000Z\r\nRRULE:FREQ=WEEKLY;COUNT=5\r\nEXDATE:20261009T210000Z\r\nSUMMARY:Friday cards\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:cancelled\r\nDTSTART:20261010T210000Z\r\nDTEND:20261010T230000Z\r\nSTATUS:CANCELLED\r\nSUMMARY:Cancelled\r\nEND:VEVENT'),'2026-10');
assert.equal(result.length,4);assert.equal(result[1].start,'2026-10-16T21:00:00.000Z');
});
test('all-day dates and private event filtering',()=>{const result=context.parseCalendar(feed('BEGIN:VEVENT\r\nUID:day\r\nDTSTART;VALUE=DATE:20261013\r\nDTEND;VALUE=DATE:20261014\r\nSUMMARY:Shop event\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:private\r\nDTSTART:20261014T210000Z\r\nDTEND:20261014T220000Z\r\nCLASS:PRIVATE\r\nSUMMARY:Private\r\nEND:VEVENT'),'2026-10');assert.equal(result.length,1);assert.equal(result[0].start,'2026-10-13');assert.equal(result[0].allDay,true);});
test('endpoint validates month and handles unavailable feeds',async()=>{assert.equal((await context.calendarResponse(new Request('https://example.com/api/events?month=bad'),{},()=>{throw Error();})).status,400);assert.equal((await context.calendarResponse(new Request('https://example.com/api/events?month=2026-10'),{GOOGLE_CALENDAR_ID:'test'},async()=>new Response('',{status:404}))).status,503);});
