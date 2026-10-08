'use strict';
// Uses Application Default Credentials, never browser credentials or a checked-in key.
const {initializeApp}=require('firebase-admin/app');
const {getFirestore,FieldValue}=require('firebase-admin/firestore');
const {getAuth}=require('firebase-admin/auth');
const {HttpsError}=require('firebase-functions/v2/https');
const {createArchive}=require('./archive.cjs');
initializeApp({projectId:'netzbau-tafers'});
const db=getFirestore();
(async()=>{
 const sites=await db.collection('baustellen').where('status','==','archiviert').get();
 console.log('Bestehende archivierte Baustellen:',sites.size);
 if(!process.argv.includes('--execute')){console.log('Vorschau. Zum Verschieben --execute angeben.');return;}
 const move=createArchive({db,auth:getAuth(),timestamp:()=>FieldValue.serverTimestamp(),ErrorType:HttpsError});
 for(const site of sites.docs){await move({auth:{uid:'pmyu29TlC3QM7JIysmy2EmiHSWW2'},data:{id:site.id}});console.log('Verschoben:',site.id);}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
