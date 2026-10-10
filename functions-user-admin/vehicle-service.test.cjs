'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validServiceDate,dueDays,serviceMessage,createServiceReminder}=require('./vehicle-service.cjs');
test('valid dates, 30-day boundary and Zurich midnight/DST',()=>{
  assert.equal(validServiceDate('2026-02-30'),false);
  assert.equal(validServiceDate('2028-02-29'),true);
  assert.equal(validServiceDate(null),false);
  assert.equal(dueDays('2026-11-09',Date.parse('2026-10-10T12:00Z')),30);
  assert.equal(dueDays('2026-11-10',Date.parse('2026-10-10T12:00Z')),31);
  assert.equal(dueDays('2026-03-30',Date.parse('2026-03-28T23:30Z')),1);
  assert.equal(dueDays('2026-10-09',Date.parse('2026-10-10T12:00Z')),-1);
});
function fixture(fetchImpl){
  const rows=new Map([['fahrzeuge/bus',{name:'Bus',plate:'FR 1',serviceDates:{vehicle:'2026-11-09',crane:'2026-11-10'}}]]);
  const snap=path=>({exists:rows.has(path),data:()=>rows.get(path)});
  const ref=path=>({path,update:async value=>rows.set(path,{...rows.get(path),...value})});
  const vehicle={id:'bus',ref:ref('fahrzeuge/bus'),data:()=>rows.get('fahrzeuge/bus')};
  const db={collection:name=>({get:async()=>({docs:[vehicle]}),doc:id=>ref(name+'/'+id)}),runTransaction:async callback=>callback({get:async r=>snap(r.path),set:(r,v)=>rows.set(r.path,v)})};
  const errors=[];
  const run=createServiceReminder({db,FieldValue:{serverTimestamp:()=>123},logger:{error:(...v)=>errors.push(v)},apiKey:'test',sender:'sender@example.test',recipient:'boss@example.test',fetchImpl,now:()=>Date.parse('2026-10-10T12:00Z')});
  return {rows,run,errors};
}
test('one email per type/date; new date gets its own reminder; removed date skipped',async()=>{
  const calls=[];const f=fixture(async(url,options)=>{calls.push(JSON.parse(options.body));return {ok:true,status:201};});
  await f.run();await f.run();assert.equal(calls.length,1);
  assert.match(calls[0].subject,/in 30 Tagen/);
  assert.deepEqual(calls[0].to,[{email:'boss@example.test'}]);
  f.rows.get('fahrzeuge/bus').serviceDates.crane='2026-10-20';
  await f.run();assert.equal(calls.length,2);assert.match(calls[1].subject,/Kranservice/);
  f.rows.get('fahrzeuge/bus').serviceDates.vehicle=null;await f.run();assert.equal(calls.length,2);
});
test('explicit rejection retries; uncertain network failure prevents automatic duplicates',async()=>{
  let calls=0;const f=fixture(async()=>{calls++;return {ok:calls>1,status:calls>1?201:429};});
  await f.run();await f.run();await f.run();assert.equal(calls,2);
  let uncertain=0;const g=fixture(async()=>{uncertain++;throw Error('timeout');});
  await g.run();await g.run();assert.equal(uncertain,1);assert.equal(g.errors.length,1);
});
test('overdue reminder says overdue rather than 30 days',()=>{
  assert.match(serviceMessage({name:'Bus',plate:'FR 1',id:'bus'},'vehicle','2026-10-01',-9).subject,/9 Tagen überfällig/);
});
