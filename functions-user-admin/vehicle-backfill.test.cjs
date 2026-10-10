'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createBackfill,createBackfillNotifier,zurichMillis}=require('./vehicle-backfill.cjs');
const {MASTER}=require('./service.cjs');
const NOW=Date.parse('2026-10-10T10:00:00Z');
const Timestamp={fromMillis:ms=>({toMillis:()=>ms,toDate:()=>new Date(ms)})};
class ErrorType extends Error{constructor(code,message){super(message);this.code=code;}}
function setup(){
  const rows=new Map(),users=new Map([['sender',{uid:'sender',displayName:'Absender'}],['recipient',{uid:'recipient',displayName:'Empfänger'}],['other',{uid:'other'}],[MASTER,{uid:MASTER}]]);
  rows.set('user_access/sender',{permissions:{fahrzeuge:'edit'}});rows.set('user_access/recipient',{permissions:{fahrzeuge:'view'}});rows.set('user_access/other',{permissions:{fahrzeuge:'edit'}});
  rows.set('fahrzeuge/car',{name:'Unimog',plate:'FR 123',revision:0,active:{uid:'other'},lastUseEnd:Timestamp.fromMillis(100)});
  const snapshot=ref=>({id:ref.id,ref,exists:rows.has(ref.path),data:()=>rows.get(ref.path)});
  const doc=path=>({path,id:path.split('/').at(-1),collection:name=>collection(path+'/'+name),get:async()=>snapshot(doc(path)),set:async(data,options)=>{rows.set(path,options?.merge?{...rows.get(path),...data}:data);}});
  const collection=path=>({doc:id=>doc(path+'/'+id),where(field,operator,value){return {get:async()=>({docs:[...rows].filter(([key,data])=>key.startsWith(path+'/')&&key.split('/').length===path.split('/').length+1&&(operator==='>'?data[field]?.toMillis?.()>value.getTime():data[field]===value)).map(([key])=>snapshot(doc(key)))})};}});
  let tail=Promise.resolve();
  const db={collection,runTransaction(callback){const result=tail.then(async()=>{
    const writes=[];let wrote=false;
    const tx={get:async ref=>{assert.equal(wrote,false,'all reads must precede writes');return ref.get?ref.get():snapshot(ref);},create(ref,data){wrote=true;assert.equal(rows.has(ref.path),false);writes.push(()=>rows.set(ref.path,data));},update(ref,data){wrote=true;assert.equal(rows.has(ref.path),true);writes.push(()=>rows.set(ref.path,{...rows.get(ref.path),...data}));},delete(ref){wrote=true;writes.push(()=>rows.delete(ref.path));},set(ref,data){wrote=true;writes.push(()=>rows.set(ref.path,data));}};
    const value=await callback(tx);writes.forEach(write=>write());return value;
  });tail=result.catch(()=>{});return result;}};
  const auth={getUser:async uid=>{if(!users.has(uid))throw new ErrorType('auth/user-not-found','Missing');return users.get(uid);},listUsers:async()=>({users:[...users.values()]})};
  const service=createBackfill({db,auth,Timestamp,ErrorType,now:()=>NOW});
  return {rows,users,db,auth,service};
}
const proposal={vehicleId:'car',targetUid:'recipient',requestId:'abcdefghijklmnop',wholeDay:false,start:'2026-10-09T08:15',end:'2026-10-09T16:30'};
const sender=data=>({auth:{uid:'sender'},data}),review=(id,decision='confirmed',uid='recipient')=>({auth:{uid},data:{id,decision}});
test('own backfill is immediately confirmed, retries do not duplicate it, and no push is sent',async()=>{
  const s=setup(),data={...proposal,targetUid:'sender'},result=await s.service.propose(sender(data));
  assert.equal(result.status,'confirmed');const request=s.rows.get('fahrzeug_nachtraege/'+result.id);
  assert.equal(request.status,'confirmed');assert.equal(request.confirmationRequired,false);assert.equal(request.confirmedBy.uid,'sender');
  const history=s.rows.get('fahrzeuge/car/verlauf/'+request.historyId);assert.equal(history.status,'confirmed');assert.equal(history.confirmedBy.uid,'sender');
  assert.equal((await s.service.propose(sender(data))).status,'confirmed');assert.equal(s.rows.get('fahrzeuge/car').revision,1);assert.equal(s.rows.get('fahrzeuge/car').active.uid,'other');
  s.rows.set('push_devices/own',{uid:'sender',token:'own-device',updatedAt:Timestamp.fromMillis(NOW)});
  const notify=createBackfillNotifier({...s,messaging:{send:async()=>assert.fail('Own backfill must not send push')},logger:{warn(){}},now:()=>NOW});
  await notify({data:await s.db.collection('fahrzeug_nachtraege').doc(result.id).get()});assert.equal(request.notificationStatus,undefined);
});
test('older pending own backfill is also not notified',async()=>{
  const s=setup(),result=await s.service.propose(sender({...proposal,targetUid:'sender'}));const request=s.rows.get('fahrzeug_nachtraege/'+result.id);request.status='pending';
  const notify=createBackfillNotifier({...s,messaging:{send:async()=>assert.fail('Own backfill must not send push')},logger:{warn(){}},now:()=>NOW});await notify({data:await s.db.collection('fahrzeug_nachtraege').doc(result.id).get()});assert.equal(request.notificationStatus,undefined);
});
test('Zurich civil times: summer, winter, invalid dates and DST ambiguity',()=>{
  assert.equal(zurichMillis('2026-07-10T07:00'),Date.parse('2026-07-10T05:00Z'));
  assert.equal(zurichMillis('2026-12-10T07:00'),Date.parse('2026-12-10T06:00Z'));
  for(const value of ['2026-02-30T07:00','2026-03-29T02:30','2026-10-25T02:30','2026-10-09T25:00','bad'])assert.ok(Number.isNaN(zurichMillis(value)));
});
test('proposal remains pending, names are server-resolved, occupancy stays unchanged',async()=>{
  const s=setup(),result=await s.service.propose(sender({...proposal,actor:{name:'Forged'}}));
  const request=s.rows.get('fahrzeug_nachtraege/'+result.id),history=s.rows.get('fahrzeuge/car/verlauf/'+request.historyId);
  assert.equal(request.status,'pending');assert.equal(history.status,'pending');assert.equal(request.actor.name,'Empfänger');assert.equal(request.requestedBy.name,'Absender');assert.equal(s.rows.get('fahrzeuge/car').active.uid,'other');assert.equal(s.rows.get('fahrzeuge/car').lastUseEnd.toMillis(),100);
});
test('whole day is 07:00–17:15 in Zurich and ignores custom times',async()=>{
  const s=setup(),result=await s.service.propose(sender({...proposal,wholeDay:true,date:'2026-10-09',start:'bad',end:'bad'})),request=s.rows.get('fahrzeug_nachtraege/'+result.id);
  assert.equal(request.start.toMillis(),Date.parse('2026-10-09T05:00Z'));assert.equal(request.end.toMillis(),Date.parse('2026-10-09T15:15Z'));
});
test('invalid, future and reversed periods rejected without writes',async()=>{
  for(const data of [{...proposal,end:'2026-10-10T17:15'},{...proposal,end:proposal.start},{...proposal,start:'bad'},{...proposal,wholeDay:true,date:'2026-02-30'}]){
    const s=setup();await assert.rejects(s.service.propose(sender(data)),{code:'invalid-argument'});assert.equal(s.rows.size,4);
  }
});
test('sender needs edit; disabled, deleted or inaccessible recipient is excluded',async()=>{
  let s=setup();s.rows.set('user_access/sender',{permissions:{fahrzeuge:'view'}});await assert.rejects(s.service.propose(sender(proposal)),{code:'permission-denied'});
  for(const mode of ['disabled','deleted','none']){s=setup();if(mode==='disabled')s.users.get('recipient').disabled=true;if(mode==='deleted')s.rows.set('account_deletions/recipient',{});if(mode==='none')s.rows.set('user_access/recipient',{permissions:{fahrzeuge:'none'}});await assert.rejects(s.service.propose(sender(proposal)),{code:'permission-denied'});const list=await s.service.recipients(sender({}));assert.ok(!list.users.some(user=>user.uid==='recipient'));assert.ok(list.users.every(user=>!('email' in user)));}
});
test('unauthenticated calls rejected and nonexistent vehicles cannot be proposed',async()=>{
  const s=setup();await assert.rejects(s.service.propose({data:proposal}),{code:'unauthenticated'});await assert.rejects(s.service.propose(sender({...proposal,vehicleId:'missing'})),{code:'not-found'});
});
test('proposal retry is idempotent; changed payload cannot reuse ID',async()=>{
  const s=setup();await s.service.propose(sender(proposal));await s.service.propose(sender(proposal));assert.equal(s.rows.get('fahrzeuge/car').revision,1);assert.equal([...s.rows.keys()].filter(key=>key.includes('/verlauf/')).length,1);await assert.rejects(s.service.propose(sender({...proposal,end:'2026-10-09T16:31'})),{code:'invalid-argument'});
});
test('only recipient can confirm, including master cannot confirm for somebody else',async()=>{
  const s=setup(),{id}=await s.service.propose(sender(proposal));
  for(const uid of ['sender','other',MASTER])await assert.rejects(s.service.review(review(id,'confirmed',uid)),{code:'permission-denied'});
  await s.service.review(review(id));const request=s.rows.get('fahrzeug_nachtraege/'+id);assert.equal(request.status,'confirmed');assert.equal(s.rows.get('fahrzeuge/car/verlauf/'+request.historyId).status,'confirmed');assert.equal(s.rows.get('fahrzeuge/car').active.uid,'other');
});
test('rejection retains a hidden tombstone for incremental backup; repeated review is idempotent',async()=>{
  const s=setup(),{id}=await s.service.propose(sender(proposal)),request=s.rows.get('fahrzeug_nachtraege/'+id);
  await s.service.review(review(id,'rejected'));await s.service.review(review(id,'rejected'));assert.equal(s.rows.get('fahrzeuge/car/verlauf/'+request.historyId).status,'rejected');assert.equal(s.rows.get('fahrzeug_nachtraege/'+id).status,'rejected');assert.equal(s.rows.get('fahrzeuge/car').revision,2);await assert.rejects(s.service.review(review(id)),{code:'failed-precondition'});
});
test('concurrent opposite decisions leave exactly one final decision',async()=>{
  const s=setup(),{id}=await s.service.propose(sender(proposal));const results=await Promise.allSettled([s.service.review(review(id)),s.service.review(review(id,'rejected'))]);assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(s.rows.get('fahrzeug_nachtraege/'+id).status,'confirmed');
});
test('retained history remains confirmable after vehicle deletion',async()=>{
  const s=setup(),{id}=await s.service.propose(sender(proposal));s.rows.delete('fahrzeuge/car');await s.service.review(review(id));const request=s.rows.get('fahrzeug_nachtraege/'+id);assert.equal(s.rows.get('fahrzeuge/car/verlauf/'+request.historyId).status,'confirmed');assert.equal(s.rows.has('fahrzeuge/car'),false);
});
test('push includes period and approval link; reassigned and stale devices excluded',async()=>{
  const s=setup(),{id}=await s.service.propose(sender(proposal)),sent=[];
  s.rows.set('push_devices/good',{uid:'recipient',token:'good',updatedAt:Timestamp.fromMillis(NOW)});s.rows.set('push_devices/stale',{uid:'recipient',token:'stale',updatedAt:Timestamp.fromMillis(0)});s.rows.set('push_devices/other',{uid:'other',token:'other',updatedAt:Timestamp.fromMillis(NOW)});
  const notify=createBackfillNotifier({...s,messaging:{send:async message=>sent.push(message)},logger:{warn(){}},now:()=>NOW});
  const snapshot=await s.db.collection('fahrzeug_nachtraege').doc(id).get();await notify({data:snapshot});assert.equal(sent.length,1);assert.equal(sent[0].token,'good');assert.match(sent[0].webpush.notification.body,/Absender.*Unimog.*FR 123/);
  const link='https://netzbau-tafers.github.io/lager/fahrzeug-bestaetigung.html?nachtrag='+id;
  assert.equal(sent[0].webpush.fcmOptions.link,link);assert.equal(sent[0].webpush.notification.data.url,link);assert.equal(sent[0].data.url,link);
  await s.service.review(review(id));await notify({data:snapshot});assert.equal(sent.length,1);
});
test('pending request survives lack of enabled push device',async()=>{
  const s=setup(),{id}=await s.service.propose(sender(proposal));const notify=createBackfillNotifier({...s,messaging:{send:async()=>assert.fail('No device')},logger:{warn(){}},now:()=>NOW});await notify({data:await s.db.collection('fahrzeug_nachtraege').doc(id).get()});assert.equal(s.rows.get('fahrzeug_nachtraege/'+id).status,'pending');assert.equal(s.rows.get('fahrzeug_nachtraege/'+id).notificationStatus,'not-delivered');
});


