'use strict';
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore,Timestamp}=require('firebase-admin/firestore');
const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
const {createVehicles}=require('../functions-user-admin/vehicles.cjs');
class ApiError extends Error{constructor(code,message){super(message);this.code=code;}}
(async()=>{
  assert(process.env.FIRESTORE_EMULATOR_HOST,'Run only with the Firestore emulator.');
  const projectId='demo-lager-access',app=initializeApp({projectId},'vehicle-transactions'),db=getFirestore(app);
  const env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8089}});
  try{
    await env.clearFirestore();let clock=Date.parse('2026-10-09T08:00Z');
    const service=createVehicles({db,auth:{getUser:async uid=>({uid,disabled:false,email:uid+'@example.test'})},Timestamp,ErrorType:ApiError,now:()=>clock});
    for(const uid of ['alice','bob']){await db.doc('users/'+uid).set({username:uid});await db.doc('user_access/'+uid).set({permissions:{fahrzeuge:'edit',fahrzeugeErstellen:'edit',fahrzeugeUebernehmen:'edit'}});}
    const request=(uid,data)=>({auth:{uid},data});
    const create=async()=>service.create(request('alice',{name:'Bus',plate:'FR 123',km:100}));
    const [a,b]=await Promise.all([create(),create()]);
    const action=(uid,id,action,revision,extra={})=>service.action(request(uid,{id,action,revision,requestId:randomUUID(),...extra}));
    const simultaneous=await Promise.allSettled([action('alice',a.id,'start',0),action('alice',b.id,'start',0)]);
    assert.equal(simultaneous.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(simultaneous.find(r=>r.status==='rejected').reason.code,'failed-precondition');
    const docs=await Promise.all([db.doc('fahrzeuge/'+a.id).get(),db.doc('fahrzeuge/'+b.id).get()]);const occupied=docs.find(d=>d.data().active),free=docs.find(d=>!d.data().active);
    assert.equal((await db.doc('fahrzeug_nutzung/alice').get()).data().vehicleId,occupied.id);
    await assert.rejects(action('alice',free.id,'day',0),e=>e.code==='failed-precondition');
    clock+=3600000;await action('bob',occupied.id,'takeover',1);
    assert.equal((await db.doc('fahrzeug_nutzung/alice').get()).data().vehicleId,null);assert.equal((await db.doc('fahrzeug_nutzung/bob').get()).data().vehicleId,occupied.id);
    const events=await db.collection('fahrzeuge/'+occupied.id+'/verlauf').get();assert.equal(events.size,3);const previous=events.docs.find(d=>d.data().type==='use'&&d.data().actor.uid==='alice').data();assert.equal(previous.end.toMillis(),clock);assert.equal(previous.takenOverBy.uid,'bob');
    await assert.rejects(action('alice',occupied.id,'free',1),e=>e.code==='failed-precondition');
    clock+=3600000;await action('bob',occupied.id,'free',2);assert.equal((await db.doc('fahrzeug_nutzung/bob').get()).data().vehicleId,null);
    await action('alice',free.id,'start',0);await action('alice',free.id,'free',1);clock+=3600000;
    const repeat={id:free.id,action:'day',revision:2,requestId:randomUUID()};await service.action(request('alice',repeat));await service.action(request('alice',repeat));
    const day=(await db.collection('fahrzeuge/'+free.id+'/verlauf').get()).docs.filter(d=>d.data().type==='day');assert.equal(day.length,1);assert.equal(day[0].data().start.toMillis(),clock-3600000);
    console.log('Real Firestore transactions: concurrency, person lock, takeover, history and idempotency passed.');
  }finally{await env.cleanup();await db.terminate();await deleteApp(app);}
})().catch(error=>{console.error(error);process.exitCode=1;});
