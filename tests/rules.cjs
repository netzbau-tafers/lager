const fs=require('fs');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {doc,setDoc,getDoc,getDocs,collection,updateDoc,deleteDoc,serverTimestamp,writeBatch}=require('firebase/firestore');
const MASTER='pmyu29TlC3QM7JIysmy2EmiHSWW2';
const areas=['kabellager','baustellen','archiv','kabelreport','logs','spiel','gespart'];
const levels=value=>Object.fromEntries(areas.map(key=>[key,value]));
(async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-lager-access',firestore:{host:'127.0.0.1',port:8089,rules:fs.readFileSync(__dirname+'/../firestore.rules','utf8')}});
 try{
  await env.withSecurityRulesDisabled(async context=>{const db=context.firestore();for(const [path,data]of Object.entries({'users/worker':{username:'Max',email:'max@example.com'},'user_access/worker':{permissions:levels('view')},'bobinen/a':{status:'Lager'},'baustellen/a':{status:'aktiv'},'baustellen/b':{status:'archiviert'},'baustellen_material/a':{baustelleId:'b'},'logs/a':{aktion:'test'},'material_vorlagen/a':{material:'test'},'kabel_report_snapshots/a':{year:2026},'strommastRanking/a':{score:10},'gespart_tarife/a':{tarif:1}}))await setDoc(doc(db,path),data);});
  const master=env.authenticatedContext(MASTER,{email:'martin@example.com'}).firestore(),worker=env.authenticatedContext('worker',{email:'max@example.com'}).firestore(),other=env.authenticatedContext('other',{email:'other@example.com'}).firestore(),anon=env.unauthenticatedContext().firestore();
  await assertSucceeds(getDocs(collection(master,'users')));await assertFails(getDocs(collection(worker,'users')));await assertFails(getDoc(doc(worker,'users/other')));
  await assertSucceeds(updateDoc(doc(master,'users/worker'),{username:'Renamed'}));
  await assertFails(setDoc(doc(worker,'user_access/worker'),{permissions:levels('edit')}));await assertFails(setDoc(doc(other,'user_access/other'),{permissions:levels('edit')}));
  await assertSucceeds(updateDoc(doc(worker,'users/worker'),{username:'Own name',updatedAt:serverTimestamp()}));await assertSucceeds(setDoc(doc(worker,'users/worker'),{email:'max@example.com',lastSeenAt:serverTimestamp()},{merge:true}));
  await assertFails(updateDoc(doc(worker,'users/worker'),{email:'forged@example.com'}));await assertFails(updateDoc(doc(worker,'users/worker'),{permissions:levels('edit')}));
  await assertSucceeds(setDoc(doc(other,'users/other'),{email:'other@example.com',lastSeenAt:serverTimestamp()},{merge:true}));
  for(const path of ['bobinen/a','baustellen/a','baustellen_material/a','material_vorlagen/a','logs/a','kabel_report_snapshots/a','strommastRanking/a','gespart_tarife/a']){await assertSucceeds(getDoc(doc(worker,path)));await assertFails(updateDoc(doc(worker,path),{test:true}));await assertFails(deleteDoc(doc(worker,path)));await assertFails(getDoc(doc(anon,path)));}
  const setRights=async permissions=>assertSucceeds(setDoc(doc(master,'user_access/worker'),{permissions,updatedAt:serverTimestamp(),updatedBy:MASTER}));
  await setRights(levels('none'));for(const path of ['bobinen/a','baustellen/a','logs/a','strommastRanking/a'])await assertFails(getDoc(doc(worker,path)));
  await setRights({...levels('none'),archiv:'view'});await assertSucceeds(getDoc(doc(worker,'baustellen/b')));await assertFails(deleteDoc(doc(worker,'baustellen/b')));await assertFails(getDoc(doc(worker,'bobinen/a')));
  await setRights({...levels('none'),kabelreport:'view'});await assertSucceeds(getDoc(doc(worker,'logs/a')));await assertSucceeds(getDoc(doc(worker,'kabel_report_snapshots/a')));await assertFails(updateDoc(doc(worker,'kabel_report_snapshots/a'),{test:true}));
  await setRights(levels('edit'));for(const path of ['bobinen/a','baustellen/a','baustellen_material/a','material_vorlagen/a','kabel_report_snapshots/a','gespart_tarife/a'])await assertSucceeds(updateDoc(doc(worker,path),{test:true}));await assertFails(updateDoc(doc(worker,'logs/a'),{test:true}));await assertSucceeds(deleteDoc(doc(worker,'baustellen/b')));
  await assertFails(setDoc(doc(master,'user_access/'+MASTER),{permissions:levels('none'),updatedAt:serverTimestamp(),updatedBy:MASTER}));await assertFails(setDoc(doc(master,'user_access/worker'),{permissions:{...levels('edit'),kabellager:'invalid'},updatedAt:serverTimestamp(),updatedBy:MASTER}));
  const admin=env.authenticatedContext('smnnQd4RhEQZR3uuNN0otNALUqi1').firestore();await assertFails(getDocs(collection(admin,'users')));await assertFails(updateDoc(doc(admin,'users/worker'),{username:'forged'}));
  const batch=writeBatch(master);batch.set(doc(master,'users/worker'),{username:'Batch name'},{merge:true});batch.set(doc(master,'user_access/worker'),{permissions:levels('view'),updatedAt:serverTimestamp(),updatedBy:MASTER});await assertSucceeds(batch.commit());
  await env.withSecurityRulesDisabled(async context=>{await setDoc(doc(context.firestore(),'account_deletions/worker'),{deletedAt:serverTimestamp(),deletedBy:MASTER});});
  // The same authenticated context represents an already-issued ID token.
  for(const path of ['bobinen/a','users/worker','user_access/worker','logs/a'])await assertFails(getDoc(doc(worker,path)));
  await assertFails(setDoc(doc(worker,'users/worker'),{username:'Recreated',email:'max@example.com'},{merge:true}));
  await assertFails(deleteDoc(doc(worker,'account_deletions/worker')));
  await assertFails(deleteDoc(doc(master,'account_deletions/worker')));
  await assertFails(setDoc(doc(master,'users/worker'),{username:'Stale save'},{merge:true}));
  console.log('Firestore authorization scenarios passed.');
 }finally{await env.cleanup();}
})().catch(error=>{console.error(error);process.exitCode=1;});

