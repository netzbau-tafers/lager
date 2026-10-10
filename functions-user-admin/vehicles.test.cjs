'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createVehicles,dayStart}=require('./vehicles.cjs');
const {MASTER}=require('./service.cjs');
class Timestamp{constructor(ms){this.ms=ms;}static fromMillis(ms){return new Timestamp(ms);}toMillis(){return this.ms;}}
class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
// Atomic transaction double: rollback, read-before-write and create/update semantics.
function fixture(){
  const data=new Map(),audit=[],users=new Map(),versions=new Map();let serial=0,queue=Promise.resolve(),clock=Date.parse('2026-10-09T08:00:00Z');
  const snapshot=path=>({exists:data.has(path),data:()=>data.get(path)});
  const doc=path=>({path,id:path.split('/').at(-1),get:async()=>snapshot(path),collection:name=>collection(path+'/'+name)});
  const collection=path=>({doc:id=>doc(path+'/'+(id||'auto'+(++serial)))});
  const db={collection,recursiveDelete:async ref=>{for(const path of data.keys())if(path===ref.path||path.startsWith(ref.path+'/'))data.delete(path);},runTransaction(callback){
    const result=queue.then(async()=>{
      const writes=[];let writing=false;
      const tx={delete:ref=>{writing=true;writes.push(['delete',ref.path]);},get:async ref=>{assert.equal(writing,false,'transaction read after write');return snapshot(ref.path);},create:(ref,value)=>{writing=true;writes.push(['create',ref.path,value]);},update:(ref,value)=>{writing=true;writes.push(['update',ref.path,value]);},set:(ref,value)=>{writing=true;writes.push(['set',ref.path,value]);}};
      await callback(tx);const draft=new Map(data);
      for(const [type,path,value]of writes){if(type==='delete'){draft.delete(path);continue;}if(type!=='set')assert.equal(draft.has(path),type==='update',type+' existence');draft.set(path,type==='update'?{...draft.get(path),...value}:value);}
      data.clear();for(const pair of draft)data.set(...pair);audit.push(writes);return undefined;
    });queue=result.catch(()=>{});return result;
  }};
  function user(uid,permissions={fahrzeuge:'edit',fahrzeugeErstellen:'edit',fahrzeugeUebernehmen:'edit'}){users.set(uid,{uid,email:uid+'@example.test',disabled:false});data.set('users/'+uid,{username:uid});data.set('user_access/'+uid,{permissions});}
  user('alice');user('bob');user(MASTER);
  const service=createVehicles({db,auth:{getUser:async uid=>users.get(uid)},Timestamp,ErrorType:HttpsError,now:()=>clock});
  const request=(uid,values)=>({auth:{uid},data:values});
  async function create(uid='alice'){const result=await service.create(request(uid,{name:'Bus',plate:'FR 123',km:100}));return result.id;}
  const vehicle=id=>data.get('fahrzeuge/'+id);
  const events=id=>[...data.entries()].filter(([path])=>path.startsWith('fahrzeuge/'+id+'/verlauf/')).map(([,value])=>value);
  async function action(id,kind,uid='alice',extra={}){return service.action(request(uid,{id,revision:vehicle(id).revision,action:kind,requestId:'request_'+(++serial)+'_abcdefghijk',...extra}));}
  return {service,request,data,users,create,vehicle,events,action,user,setClock:ms=>clock=typeof ms==='string'?Date.parse(ms):ms};
}
const rejects=(promise,code)=>assert.rejects(promise,error=>error.code===code);
test('Zurich 07:00 handles winter, summer and DST change dates',()=>{
  for(const [now,expected]of [['2026-01-09T10:00Z','2026-01-09T06:00Z'],['2026-07-09T10:00Z','2026-07-09T05:00Z'],['2026-03-29T00:30Z','2026-03-29T05:00Z'],['2026-10-25T00:30Z','2026-10-25T06:00Z']])assert.equal(dayStart(Date.parse(now)),Date.parse(expected));
});
test('authentication, disabled/deleted users and opt-in permissions enforced server-side',async()=>{
  const f=fixture();await rejects(f.service.create({data:{}}),'unauthenticated');
  f.users.get('alice').disabled=true;await rejects(f.create(),'permission-denied');f.users.get('alice').disabled=false;
  f.user('alice',{});await rejects(f.create(),'permission-denied');
  f.user('alice',{fahrzeuge:'view',fahrzeugeErstellen:'edit',fahrzeugeUebernehmen:'edit'});const id=await f.create();await rejects(f.action(id,'start'),'permission-denied');
  f.user('alice',{fahrzeuge:'none',fahrzeugeErstellen:'edit',fahrzeugeUebernehmen:'edit'});await rejects(f.create(),'permission-denied');
  f.data.set('account_deletions/'+MASTER,{});await rejects(f.create(MASTER),'permission-denied');
});
test('name/plate/km input validation and master rights',async()=>{
  const f=fixture();for(const values of [{name:'',plate:'FR1',km:1},{name:'<script>',plate:'FR1',km:1},{name:'Bus',plate:'',km:1},{name:'Bus',plate:'FR1',km:-1},{name:'Bus',plate:'FR1',km:1.5}])await rejects(f.service.create(f.request('alice',values)),'invalid-argument');
  f.data.delete('user_access/'+MASTER);assert.ok(await f.create(MASTER));
});
test('start and free produce one session with correct person and times',async()=>{
  const f=fixture(),id=await f.create();await f.action(id,'start');const v=f.vehicle(id);assert.equal(v.active.uid,'alice');assert.equal(v.status,'inGebrauch');assert.equal(f.events(id)[0].end,null);
  f.setClock('2026-10-09T09:00Z');await rejects(f.action(id,'free','bob'),'permission-denied');await f.action(id,'free');assert.equal(f.vehicle(id).active,null);assert.equal(f.vehicle(id).status,'frei');assert.equal(f.events(id).length,1);assert.equal(f.events(id)[0].start.toMillis(),Date.parse('2026-10-09T08:00Z'));assert.equal(f.events(id)[0].end.toMillis(),Date.parse('2026-10-09T09:00Z'));
});
test('concurrent starts: exactly one succeeds, loser cannot overwrite',async()=>{
  const f=fixture(),id=await f.create();const results=await Promise.allSettled(['alice','bob'].map(uid=>f.service.action(f.request(uid,{id,revision:0,action:'start',requestId:uid+'_same_revision_01'}))));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.events(id).length,1);assert.equal(f.vehicle(id).revision,1);
});
test('takeover closes old session, opens new one, records both people',async()=>{
  const f=fixture(),id=await f.create();await rejects(f.action(id,'takeover'),'failed-precondition');await f.action(id,'start');await rejects(f.action(id,'takeover'),'failed-precondition');f.setClock('2026-10-09T08:30Z');await f.action(id,'takeover','bob');const events=f.events(id);assert.equal(f.vehicle(id).active.uid,'bob');const old=events.find(e=>e.type==='use'&&e.actor.uid==='alice');assert.equal(old.takenOverBy.uid,'bob');assert.equal(old.end.toMillis(),Date.parse('2026-10-09T08:30Z'));assert.equal(events.find(e=>e.type==='takeover').from.uid,'alice');await f.action(id,'free','bob');assert.equal(f.events(id).filter(e=>e.type==='use'&&e.end).length,2);
});
test('day entry: first at 07:00, subsequent at previous end, next day resets',async()=>{
  const f=fixture(),id=await f.create();await f.action(id,'day');assert.equal(f.events(id)[0].start.toMillis(),Date.parse('2026-10-09T05:00Z'));f.setClock('2026-10-09T10:00Z');await f.action(id,'day','bob');assert.equal(f.events(id)[1].start.toMillis(),Date.parse('2026-10-09T08:00Z'));f.setClock('2026-10-10T08:00Z');await f.action(id,'day');assert.equal(f.events(id)[2].start.toMillis(),Date.parse('2026-10-10T05:00Z'));
});
test('day entry excludes active/zero periods and respects last ordinary usage',async()=>{
  const f=fixture(),id=await f.create();f.setClock('2026-10-09T04:59Z');await rejects(f.action(id,'day'),'failed-precondition');f.setClock('2026-10-09T08:00Z');await f.action(id,'start');await rejects(f.action(id,'day'),'failed-precondition');f.setClock('2026-10-09T09:00Z');await f.action(id,'free');await rejects(f.action(id,'day'),'failed-precondition');f.setClock('2026-10-09T10:00Z');await f.action(id,'day');assert.equal(f.events(id).find(e=>e.type==='day').start.toMillis(),Date.parse('2026-10-09T09:00Z'));
});
test('fuel requires valid current km, preserves use and adds attribution',async()=>{
  const f=fixture(),id=await f.create();await f.action(id,'start');for(const km of [undefined,-1,1.2,99,10000000,'200'])await rejects(f.action(id,'fuel','alice',{km}),'invalid-argument');await f.action(id,'fuel','bob',{km:200});assert.equal(f.vehicle(id).km,200);assert.equal(f.vehicle(id).active.uid,'alice');assert.equal(f.vehicle(id).kmBy.uid,'bob');assert.equal(f.events(id).find(e=>e.type==='fuel').km,200);
});
test('replayed action is idempotent and mismatched reuse is rejected',async()=>{
  const f=fixture(),id=await f.create(),data={id,action:'day',revision:0,requestId:'unique_request_123456'};await f.service.action(f.request('alice',data));f.setClock('2026-10-09T10:00Z');await f.service.action(f.request('alice',data));assert.equal(f.events(id).length,1);await rejects(f.service.action(f.request('alice',{...data,action:'start'})),'invalid-argument');
});
test('stale free cannot close a newly taken-over session and revoked rights fail',async()=>{
  const f=fixture(),id=await f.create();await f.action(id,'start');const stale=f.vehicle(id).revision;await f.action(id,'takeover','bob');await rejects(f.action(id,'free','alice',{revision:stale}),'failed-precondition');assert.equal(f.vehicle(id).active.uid,'bob');f.user('bob',{fahrzeuge:'view'});await rejects(f.action(id,'free','bob'),'permission-denied');
});

test('one vehicle per person: blocks start, takeover and day until free',async()=>{
  const f=fixture(),first=await f.create(),second=await f.create();await f.action(first,'start');
  await rejects(f.action(second,'start'),'failed-precondition');await rejects(f.action(second,'day'),'failed-precondition');
  await f.action(second,'start','bob');await rejects(f.action(second,'takeover'),'failed-precondition');
  await f.action(first,'free');await f.action(second,'takeover');assert.equal(f.vehicle(second).active.uid,'alice');
  assert.equal(f.data.get('fahrzeug_nutzung/bob').vehicleId,null);await f.action(first,'start','bob');assert.equal(f.vehicle(first).active.uid,'bob');
});
test('simultaneous start on different vehicles cannot bypass person lock',async()=>{
  const f=fixture(),a=await f.create(),b=await f.create();const results=await Promise.allSettled([f.action(a,'start'),f.action(b,'start')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal([f.vehicle(a),f.vehicle(b)].filter(v=>v.active).length,1);
});

test('takeover needs explicit permission in addition to normal vehicle usage',async()=>{
 const f=fixture(),id=await f.create();await f.action(id,'start');f.user('bob',{fahrzeuge:'edit',fahrzeugeUebernehmen:'none'});
 await rejects(f.action(id,'takeover','bob'),'permission-denied');assert.equal(f.vehicle(id).active.uid,'alice');
});

test('delete permission, active vehicle and stale revision are enforced; cleanup and retries work',async()=>{
 const f=fixture(),id=await f.create(),request=()=>f.request('alice',{id,revision:f.vehicle(id)?.revision||0});
 f.user('alice',{fahrzeuge:'edit',fahrzeugeErstellen:'none'});await rejects(f.service.remove(request()),'permission-denied');
 f.user('alice');await f.action(id,'start');await rejects(f.service.remove(request()),'failed-precondition');await f.action(id,'free');
 await rejects(f.service.remove(f.request('alice',{id,revision:0})),'failed-precondition');
 f.user('alice',{fahrzeuge:'view',fahrzeugeErstellen:'edit'});await f.service.remove(request());assert.equal(f.vehicle(id),undefined);assert.equal(f.events(id).length,0);
 await f.service.remove(f.request('alice',{id,revision:2}));
 await rejects(f.service.remove(f.request('alice',{id:'../bad',revision:0})),'invalid-argument');
});
