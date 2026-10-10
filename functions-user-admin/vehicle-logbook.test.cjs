'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {bounds,matches,createLogbook}=require('./vehicle-logbook.cjs');
const ts=ms=>({toMillis:()=>ms});
const entry=(start,end,extra={})=>({type:'use',start:ts(Date.parse(start)),end:end?ts(Date.parse(end)):null,...extra});
test('Zurich day bounds handle both DST changes',()=>{
 for(const [date,hours] of [['2026-03-29',23],['2026-10-25',25],['2026-10-10',24]]){const b=bounds(date);assert.equal((b.end-b.start)/3600000,hours);}
 assert.equal(bounds('2026-02-30'),null);assert.equal(bounds('2026-10-25','02:30'),null);
});
test('overnight, multiday and open use overlap; handover end is exclusive',()=>{
 const r=bounds('2026-10-10','14:32');
 assert.equal(matches(entry('2026-10-09T10:00Z','2026-10-11T10:00Z'),r,'all'),true);
 assert.equal(matches(entry('2026-10-09T10:00Z',null),r,'all'),true);
 assert.equal(matches(entry('2026-10-10T10:00Z','2026-10-10T12:32Z'),r,'all'),false);
 assert.equal(matches(entry('2026-10-10T12:32Z','2026-10-10T14:00Z'),r,'all'),true);
 assert.equal(matches(entry('2026-10-11T10:00Z',null),r,'all'),false);
});
test('fuel, pending/rejected and type filters are explicit',()=>{
 const r=bounds('2026-10-10');
 assert.equal(matches(entry('2026-10-10T10:00Z','2026-10-10T10:00Z',{type:'fuel'}),r,'fuel'),true);
 assert.equal(matches(entry('2026-10-10T10:00Z','2026-10-10T11:00Z',{type:'backfill',status:'pending'}),r,'use'),true);
 assert.equal(matches(entry('2026-10-10T10:00Z','2026-10-10T11:00Z',{status:'rejected'}),r,'all'),false);
 assert.equal(matches(entry('2026-10-10T10:00Z','2026-10-10T11:00Z'),r,'fuel'),false);
});
function fixture(level='view'){
 const rows=new Map([['user_access/alice',{permissions:{fahrzeuge:level}}]]),calls=[];
 for(let i=0;i<41;i++)rows.set('fahrzeuge/car/verlauf/e'+i,entry('2026-10-09T10:00Z','2026-10-10T15:00Z',{actor:{uid:'alice',name:'Alice'}}));
 rows.set('fahrzeuge/car/verlauf/open',entry('2026-10-10T10:00Z',null));
 rows.set('fahrzeuge_archiv/car',{name:'Unimog',plate:'FR 123'});
 const snapshot=path=>({id:path.split('/').at(-1),exists:rows.has(path),ref:{path},data:()=>rows.get(path)});
 const doc=path=>({get:async()=>snapshot(path),collection:name=>collection(path+'/'+name)});
 const scalar=v=>v?.toMillis?.()??v;
 function collection(path,filters=[],after=null,limit=Infinity){return {
  doc:id=>doc(path+'/'+id),where:(field,op,value)=>collection(path,[...filters,[field,op,value]],after,limit),orderBy:()=>collection(path,filters,after,limit),startAfter:s=>collection(path,filters,s.id,limit),limit:n=>collection(path,filters,after,n),get:async()=>{
    calls.push({path,limit,filters});let docs=[...rows.keys()].filter(key=>key.startsWith(path+'/')&&key.split('/').length===path.split('/').length+1).map(snapshot);
    docs=docs.filter(d=>filters.every(([f,op,v])=>{const a=scalar(d.data()[f]),b=scalar(v);return op==='=='?a===b:a!=null&&(op==='>='?a>=b:a<b);}));
    if(after)docs=docs.slice(docs.findIndex(d=>d.id===after)+1);return {docs:docs.slice(0,limit)};
  }
 };}
 const db={collection},auth={getUser:async()=>({disabled:false})};class ErrorType extends Error{constructor(code,msg){super(msg);this.code=code;}}
 return {rows,calls,service:createLogbook({db,auth,Timestamp:{fromMillis:ts},ErrorType})};
}
const request=data=>({auth:{uid:'alice'},data});
test('bounded cursor pagination, open sessions only once, archive catalog',async()=>{
 const f=fixture(),data={vehicleId:'car',date:'2026-10-10',kind:'all'};
 const first=await f.service.search(request(data));assert.equal(first.entries.length,21);assert.ok(first.cursor);
 const second=await f.service.search(request({...data,cursor:first.cursor}));assert.equal(second.entries.length,20);
 const third=await f.service.search(request({...data,cursor:second.cursor}));assert.equal(third.entries.length,1);assert.equal(third.cursor,null);
 assert.equal(new Set([...first.entries,...second.entries,...third.entries].map(e=>e.id)).size,42);
 assert.ok(f.calls.every(c=>c.limit===20));assert.equal((await f.service.catalog(request({}))).vehicles[0].deleted,true);
});
test('unauthenticated, disabled/deleted/revoked access and invalid input rejected',async()=>{
 const f=fixture('none');await assert.rejects(f.service.search(request({})),{code:'permission-denied'});
 await assert.rejects(f.service.catalog({}),{code:'unauthenticated'});
 const g=fixture();g.rows.set('account_deletions/alice',{});await assert.rejects(g.service.catalog(request({})),{code:'permission-denied'});
 for(const data of [{vehicleId:'../car',date:'2026-10-10'},{vehicleId:'car',date:'2026-02-30'},{vehicleId:'car',date:'2026-10-25',time:'02:30'},{vehicleId:'car',date:'2026-10-10',cursor:'../other'}])await assert.rejects(fixture().service.search(request(data)),{code:'invalid-argument'});
});
