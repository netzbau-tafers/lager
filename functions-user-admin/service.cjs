'use strict';
const {randomBytes}=require('node:crypto');
const MASTER='pmyu29TlC3QM7JIysmy2EmiHSWW2';
function createService({auth,db,timestamp,ErrorType}){
  async function requireMaster(request){
    if(!request.auth)throw new ErrorType('unauthenticated','Bitte anmelden.');
    if(request.auth.uid!==MASTER)throw new ErrorType('permission-denied','Nur der Master-Administrator darf Benutzer verwalten.');
    const caller=await auth.getUser(MASTER);
    if(caller.disabled)throw new ErrorType('permission-denied','Konto gesperrt.');
  }
  function uid(value){if(typeof value!=='string'||!value||value.length>128||value.includes('/'))throw new ErrorType('invalid-argument','Ungültige Benutzer-ID.');return value;}
  return {
    async resetLink(request){
      await requireMaster(request);
      const target=uid(request.data?.uid);
      if((await db.collection('account_deletions').doc(target).get()).exists)throw new ErrorType('failed-precondition','Dieses Konto wurde gelöscht.');
      let user;
      try{user=await auth.getUser(target);}catch(error){if(error.code==='auth/user-not-found')throw new ErrorType('not-found','Konto nicht gefunden. Bitte die Liste aktualisieren.');throw error;}
      if(user.disabled||!user.email)throw new ErrorType('failed-precondition','Das Konto ist gesperrt oder hat keine E-Mail-Adresse.');
      const resetLink=await auth.generatePasswordResetLink(user.email);
      return {uid:target,email:user.email,resetLink};
    },
    async create(request){
      await requireMaster(request);
      const data=request.data||{},email=typeof data.email==='string'?data.email.trim():'',username=typeof data.username==='string'?data.username.trim():'';
      if(!email||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!username||username.length>120||/[<>\u0000-\u001f\u007f]/.test(username))throw new ErrorType('invalid-argument','Bitte gültige E-Mail und Benutzernamen angeben.');
      const keys=['kabellager','baustellen','archiv','kabelreport','logs','spiel','materialvorlagen','beendete'],p=data.permissions;
      if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(key=>![...keys,'fahrzeuge','fahrzeugeErstellen','fahrzeugeUebernehmen'].includes(key))||Object.keys(p).length<keys.length||!keys.every(key=>['materialvorlagen','beendete'].includes(key)?['none','edit'].includes(p[key]):['none','view','edit'].includes(p[key])))throw new ErrorType('invalid-argument','Ungültige Zugriffsrechte.');
      if(('fahrzeuge' in p&&!['none','view','edit'].includes(p.fahrzeuge))||('fahrzeugeErstellen' in p&&!['none','edit'].includes(p.fahrzeugeErstellen))||('fahrzeugeUebernehmen' in p&&!['none','edit'].includes(p.fahrzeugeUebernehmen)))throw new ErrorType('invalid-argument','Ungültige Fahrzeugrechte.');
      const permissions={...Object.fromEntries(keys.map(key=>[key,p[key]])),fahrzeuge:p.fahrzeuge||'none',fahrzeugeErstellen:p.fahrzeugeErstellen||'none',fahrzeugeUebernehmen:p.fahrzeugeUebernehmen||'none'};
      let user;
      try{user=await auth.createUser({email,displayName:username,password:randomBytes(32).toString('base64url'),disabled:true,emailVerified:false});}
      catch(error){if(error.code==='auth/email-already-exists')throw new ErrorType('already-exists','Diese E-Mail hat bereits ein Konto.');if(error.code==='auth/invalid-email')throw new ErrorType('invalid-argument','Ungültige E-Mail.');throw error;}
      try{
        const batch=db.batch(),time=timestamp();
        batch.set(db.collection('users').doc(user.uid),{username,email:user.email,updatedAt:time});
        batch.set(db.collection('user_access').doc(user.uid),{permissions,updatedAt:time,updatedBy:MASTER});
        await batch.commit();await auth.updateUser(user.uid,{disabled:false});
      }catch(error){
        try{await auth.deleteUser(user.uid);const batch=db.batch();batch.delete(db.collection('users').doc(user.uid));batch.delete(db.collection('user_access').doc(user.uid));await batch.commit();}
        catch(_){throw new ErrorType('internal','Einrichtung fehlgeschlagen. Konto '+user.uid+' bitte in Firebase prüfen, bevor du es erneut versuchst.');}
        throw new ErrorType('internal','Einrichtung fehlgeschlagen. Bitte erneut versuchen.');
      }
      let setupLink=null;try{setupLink=await auth.generatePasswordResetLink(user.email);}catch(_){}
      return {created:true,uid:user.uid,email:user.email,setupLink};
    },
    async list(request){
      await requireMaster(request);
      const token=request.data?.pageToken;
      if(token!==undefined&&(typeof token!=='string'||token.length>4096))throw new ErrorType('invalid-argument','Ungültiger Seitenschlüssel.');
      const result=await auth.listUsers(1000,token||undefined);
      // Never return UserRecord.toJSON(): password hashes/provider data are not needed.
      return {users:result.users.map(user=>({uid:user.uid,email:user.email||'',displayName:user.displayName||'',disabled:!!user.disabled})),pageToken:result.pageToken||null};
    },
    async remove(request){
      await requireMaster(request);
      const target=uid(request.data?.uid);
      if(target===MASTER)throw new ErrorType('failed-precondition','Das Master-Admin-Konto kann nicht gelöscht werden.');
      if(request.data?.confirmUid!==target)throw new ErrorType('invalid-argument','Löschbestätigung fehlt.');
      // Auth and Firestore cannot share a transaction. Block old tokens first,
      // then delete Auth and atomically remove the profile and access settings.
      // Keep the tombstone so a cached ID token cannot recreate a profile or use legacy rights.
      await db.collection('account_deletions').doc(target).set({deletedAt:timestamp(),deletedBy:MASTER},{merge:true});
      try{await auth.deleteUser(target);}catch(error){if(error.code!=='auth/user-not-found')throw error;}
      const batch=db.batch();batch.delete(db.collection('users').doc(target));batch.delete(db.collection('user_access').doc(target));await batch.commit();
      return {deleted:true,uid:target};
    }
  };
}
module.exports={createService,MASTER};

