'use strict';
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
