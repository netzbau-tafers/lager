'use strict';
const assert=require('node:assert/strict');
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore,Timestamp,FieldValue}=require('firebase-admin/firestore');
const {createLogbook}=require('../functions-user-admin/vehicle-logbook.cjs'),{createVehicles}=require('../functions-user-admin/vehicles.cjs');
class ApiError extends Error{constructor(code,message){super(message);this.code=code;}}
(async()=>{
 assert(process.env.FIRESTORE_EMULATOR_HOST,'Emulator required');const app=initializeApp({projectId:'demo-lager-access'},'logbook'),db=getFirestore(app),auth={getUser:async uid=>({uid,disabled:false})};
 try{
 await db.doc('user_access/alice').set({permissions:{fahrzeuge:'edit',fahrzeugeErstellen:'edit'}});
 const vehicles=createVehicles({db,auth,Timestamp,FieldValue,ErrorType:ApiError});const {id}=await vehicles.create({auth:{uid:'alice'},data:{name:'Bus',plate:'FR 123',km:100}});
 await vehicles.action({auth:{uid:'alice'},data:{id,action:'start',revision:0,requestId:'abcdefghijklmnop'}});
 assert.ok((await db.collection('fahrzeuge').doc(id).collection('verlauf').get()).docs[0].data().updatedAt.toMillis());
 const batch=db.batch();for(let i=0;i<42;i++)batch.set(db.doc('fahrzeuge/car/verlauf/e'+String(i).padStart(2,'0')),{type:'use',start:Timestamp.fromDate(new Date('2026-10-09T12:00Z')),end:Timestamp.fromDate(new Date('2026-10-10T12:00Z')),actor:{uid:'alice',name:'Alice'}});
 batch.set(db.doc('fahrzeuge/car/verlauf/open'),{type:'use',start:Timestamp.fromDate(new Date('2026-10-09T12:00Z')),end:null});await batch.commit();
 const service=createLogbook({db,auth,Timestamp,ErrorType:ApiError}),data={vehicleId:'car',date:'2026-10-10',kind:'all'};const search=cursor=>service.search({auth:{uid:'alice'},data:{...data,cursor}});
 const a=await search(null),b=await search(a.cursor),c=await search(b.cursor);assert.equal(a.entries.length,21);assert.equal(b.entries.length,20);assert.equal(c.entries.length,2);assert.equal(c.cursor,null);assert.equal(new Set([...a.entries,...b.entries,...c.entries].map(e=>e.id)).size,43);
 console.log('Real Firestore: interval search, deleted-parent history, cursors and server timestamps passed.');
 }finally{await deleteApp(app);}
})().catch(e=>{console.error(e);process.exitCode=1;});
