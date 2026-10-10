'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createVehicleExport,fields,decode,eligible}=require('./vehicle-export.cjs');
const {MASTER}=require('./service.cjs');
class Timestamp{constructor(seconds,nanoseconds=0){this.seconds=seconds;this.nanoseconds=nanoseconds;}static fromMillis(ms){return new Timestamp(Math.floor(ms/1000),(ms%1000)*1e6);}toMillis(){return this.seconds*1000+this.nanoseconds/1e6;}}
class ApiError extends Error{constructor(code,message){super(message);this.code=code;}}
const date=s=>Timestamp.fromMillis(Date.parse(s));
function fixture(){
 const rows=new Map(),versions=new Map(),users=new Map([[MASTER,{disabled:false}],['worker',{disabled:false}]]);let serial=0,clock=Date.parse('2026-10-10T12:00Z');
 const seed=(path,data)=>{rows.set(path,data);versions.set(path,new Timestamp(++serial,123456789));};
 const snapshot=path=>({id:path.split('/').at(-1),ref:doc(path),exists:rows.has(path),data:()=>rows.get(path),updateTime:versions.get(path)});
 const doc=path=>({path,id:path.split('/').at(-1),get:async()=>snapshot(path),create:async data=>{assert(!rows.has(path));seed(path,data);},set:async data=>seed(path,data),update:async data=>{assert(rows.has(path));seed(path,{...rows.get(path),...data});},collection:name=>collection(path+'/'+name)});
 const scalar=v=>v?.toMillis?.()??v;
 function collection(path,filters=[],orders=[],after=null,limit=Infinity){return {
  doc:id=>doc(path+'/'+(id||'auto'+(++serial))),where:(f,op,v)=>collection(path,[...filters,[f,op,v]],orders,after,limit),orderBy:f=>collection(path,filters,[...orders,f],after,limit),startAfter:s=>collection(path,filters,orders,s,limit),limit:n=>collection(path,filters,orders,after,n),get:async()=>{
   let docs=[...rows.keys()].filter(key=>key.startsWith(path+'/')&&key.split('/').length===path.split('/').length+1).map(snapshot).filter(d=>filters.every(([f,op,v])=>{const a=scalar(d.data()[f]),b=scalar(v);return op==='=='?a===b:a!=null&&(op==='>='?a>=b:a<b);}));
   const compare=(a,b)=>{for(const f of orders){const av=scalar(a.data()[f]),bv=scalar(b.data()[f]);if(av!==bv)return av<bv?-1:1;}return a.id.localeCompare(b.id);};docs.sort(compare);if(after)docs=docs.filter(d=>compare(d,after)>0);return {docs:docs.slice(0,limit)};
  }
 };}
 const db={collection,doc,runTransaction:async cb=>{
  let written=false;const writes=[];const tx={get:async ref=>{assert(!written,'reads before writes');return ref.get();},create:(ref,v)=>{written=true;writes.push(['create',ref.path,v]);},update:(ref,v)=>{written=true;writes.push(['update',ref.path,v]);},delete:ref=>{written=true;writes.push(['delete',ref.path]);}};
  const result=await cb(tx);for(const [kind,path,v]of writes){if(kind==='delete'){rows.delete(path);versions.delete(path);}else{assert.equal(rows.has(path),kind==='update');seed(path,kind==='update'?{...rows.get(path),...v}:v);}}return result;
 }};
 seed('fahrzeuge/bus',{name:'Unimog',plate:'FR 1',active:null});seed('user_access/worker',{permissions:{fahrtenbuch:'edit'}});
 const service=createVehicleExport({db,auth:{getUser:async uid=>users.get(uid)},Timestamp,ErrorType:ApiError,now:()=>clock});
 const request=(data,uid=MASTER)=>({auth:{uid},data});
 const entry=(extra={})=>({type:'use',actor:{uid:'worker',name:'Max'},start:date('2025-02-01T07:00Z'),end:date('2025-02-01T10:00Z'),updatedAt:date('2025-02-01T10:00Z'),...extra});
 const prepare=()=>service.prepare(request({vehicleId:'all',from:'2025-01-01',to:'2025-12-31'}));
 return {rows,versions,seed,users,service,request,entry,prepare,doc};
}
test('lossless backup preserves nanosecond timestamps and nested values',()=>{
 const data={time:new Timestamp(1770000000,123456789),empty:null,map:{bool:true,text:'ä',n:3},array:[1,'test']};const restored=decode(fields(data),Timestamp);assert.deepEqual(restored,data);
});
test('full snapshot, boundaries and deletion safeguards; restore never overwrites',async()=>{
 const f=fixture();
 f.seed('fahrzeuge/bus/verlauf/use',f.entry());f.seed('fahrzeuge/bus/verlauf/fuel',f.entry({type:'fuel',km:100}));
 f.seed('fahrzeuge/bus/verlauf/pending',f.entry({type:'backfill',status:'pending'}));
 f.seed('fahrzeuge/bus/verlauf/open',f.entry({end:null}));f.seed('fahrzeuge/bus/verlauf/cross',f.entry({start:date('2024-12-31T20:00Z')}));
 f.seed('fahrzeuge/bus/verlauf/changed',f.entry());f.seed('fahrzeuge/bus/verlauf/active',f.entry());
 const job=await f.prepare();assert.equal(job.visibleCount,7);assert.equal(job.deletable,4);
 const part=await f.service.read(f.request({id:job.id,part:0}));assert.equal(part.records.length,7);
 f.seed('fahrzeuge/bus/verlauf/changed',f.entry({actor:{name:'Neu'}}));f.seed('fahrzeuge/bus',{name:'Unimog',plate:'FR 1',active:{sessionId:'active'}});
 f.seed('fahrzeuge/bus/verlauf/new',f.entry());
 const result=await f.service.remove(f.request({id:job.id,part:0,digest:job.digest,confirmed:true}));assert.equal(result.deleted,2);assert.equal(result.skipped,2);
 for(const id of ['open','pending','cross','changed','active','new'])assert(f.rows.has('fahrzeuge/bus/verlauf/'+id));
 const replay=await f.service.remove(f.request({id:job.id,part:0,digest:job.digest,confirmed:true}));assert.equal(replay.deleted,2);
 assert.equal(f.rows.get('fahrtenbuch_loeschungen/'+job.id+'_0').paths.length,2);
 f.seed('fahrzeuge/bus/verlauf/fuel',f.entry({type:'fuel',km:200}));
 const restored=await f.service.restore(f.request({id:job.id,part:0,confirmed:true}));assert.equal(restored.restored,1);assert.equal(f.rows.get('fahrzeuge/bus/verlauf/fuel').km,200);assert(f.rows.get('fahrzeuge/bus/verlauf/use').updatedAt.toMillis()>Date.parse('2025-12-31'));
});
test('server requires master, active account, complete backup, digest and confirmation',async()=>{
 const f=fixture();f.seed('fahrzeuge/bus/verlauf/a',f.entry());const job=await f.prepare();
 for(const data of [{id:job.id,part:0,digest:job.digest},{id:job.id,part:0,digest:'wrong',confirmed:true},{id:job.id,part:1,digest:job.digest,confirmed:true}])await assert.rejects(f.service.remove(f.request(data)));
 await assert.rejects(f.service.remove(f.request({id:job.id,part:0,digest:job.digest,confirmed:true},'worker')),{code:'permission-denied'});
 f.users.set(MASTER,{disabled:true});await assert.rejects(f.service.remove(f.request({id:job.id,part:0,digest:job.digest,confirmed:true})),{code:'permission-denied'});f.users.set(MASTER,{disabled:false});
 const part=f.rows.get('fahrtenbuch_exporte/'+job.id+'/teile/0');f.seed('fahrtenbuch_exporte/'+job.id+'/teile/0',{...part,hash:'invalid'});await assert.rejects(f.service.remove(f.request({id:job.id,part:0,digest:job.digest,confirmed:true})),{code:'data-loss'});assert(f.rows.has('fahrzeuge/bus/verlauf/a'));
});
test('exports paginate and retain histories of deleted vehicles',async()=>{
 const f=fixture();f.seed('fahrzeuge_archiv/gone',{name:'Alt',plate:'FR 2'});
 for(let i=0;i<205;i++)f.seed('fahrzeuge/gone/verlauf/e'+String(i).padStart(3,'0'),f.entry({type:i===0?'takeover':'use'}));
 const job=await f.prepare();assert.equal(job.count,205);assert.equal(job.visibleCount,204);assert.equal(job.parts,3);
 let result;for(let part=0;part<job.parts;part++)result=await f.service.remove(f.request({id:job.id,part,digest:job.digest,confirmed:true}));assert.equal(result.deleted,205);assert.equal(result.status,'deleted');
});
test('export permission and ownership remain enforced on reads',async()=>{
 const f=fixture();f.seed('fahrzeuge/bus/verlauf/a',f.entry());const job=await f.prepare();
 await assert.rejects(f.service.read(f.request({id:job.id,part:0},'worker')),{code:'permission-denied'});
 f.seed('user_access/worker',{permissions:{fahrtenbuch:'none'}});await assert.rejects(f.service.prepare(f.request({vehicleId:'all',from:'2025-01-01',to:'2025-12-31'},'worker')),{code:'permission-denied'});
 await assert.rejects(f.service.prepare(f.request({vehicleId:'all',from:'2025-02-30',to:'2025-12-31'})),{code:'invalid-argument'});
});
