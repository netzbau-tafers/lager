'use strict';
const MASTER='pmyu29TlC3QM7JIysmy2EmiHSWW2';
const ADMINS=['smnnQd4RhEQZR3uuNN0otNALUqi1',MASTER,'PAtM8Lv1TBNLSiQzBLJK9Oda8KK2','hwZEme8xvkasSAGrmOtQRLOnnXn1','PKDpb7Cb7ig8ZKZRMm23FOKnCHQ2','Tgj9KT6C21XjeistBWRiSVYqTDC2','DSMERv7Uu4b4eEYQx5SKbjvdher2'];
const LIMITED=['POSB6W7xeDZ8Dlba03ZP3J02dMC3','AX08qKp7lte6vslQMFn76FVqxw53','KYqiqNKTmkQQYVWAa6bp6vSvTlV2'];
function createArchive({db,auth,timestamp,ErrorType}) {
  return async request => {
    if(!request.auth) throw new ErrorType('unauthenticated','Bitte anmelden.');
    const uid=request.auth.uid, id=request.data?.id;
    if(typeof id!=='string'||!id||id.includes('/')||id.length>1500) throw new ErrorType('invalid-argument','Ungültige Baustellen-ID.');
    const user=await auth.getUser(uid);
    if(user.disabled) throw new ErrorType('permission-denied','Konto gesperrt.');
    return db.runTransaction(async tx=>{
      const marker=await tx.get(db.collection('account_deletions').doc(uid));
      const access=await tx.get(db.collection('user_access').doc(uid));
      const profile=await tx.get(db.collection('users').doc(uid));
      const p=access.exists?access.data().permissions||{}:null;
      const allowed=uid===MASTER || (p ? p.baustellen==='edit'&&(p.beendete|| (ADMINS.includes(uid)?'edit':'none'))==='edit' : ADMINS.includes(uid)&&!LIMITED.includes(uid));
      if(marker.exists||!allowed) throw new ErrorType('permission-denied','Recht für beendete Baustellen erforderlich.');
      const source=db.collection('baustellen').doc(id),target=db.collection('baustellen_archiv').doc(id);
      const site=await tx.get(source),existing=await tx.get(target);
      if(!site.exists){ if(existing.exists) return {archived:true}; throw new ErrorType('not-found','Baustelle nicht gefunden.'); }
      const data=site.data();
      if(!['rausschreiben','beendet','archiviert'].includes(data.status)|| (data.status==='archiviert'&&uid!==MASTER)) throw new ErrorType('failed-precondition','Nur beendete Baustellen können archiviert werden.');
      if(existing.exists) throw new ErrorType('already-exists','Archiv-ID bereits vorhanden. Keine Daten verschoben.');
      const materials=await tx.get(db.collection('baustellen_material').where('baustelleId','==',id));
      if(materials.size>248) throw new ErrorType('resource-exhausted','Mehr als 248 Materialpositionen. Keine Daten verschoben; Bitte Materialpositionen vor dem Archivieren reduzieren.');
      const targets=materials.docs.map(m=>db.collection('baustellen_material_archiv').doc(m.id));
      for(const ref of targets){if((await tx.get(ref)).exists) throw new ErrorType('already-exists','Material-ID im Archiv bereits vorhanden. Keine Daten verschoben.');}
      tx.set(target,{...data,status:'archiviert',archiviertAm:data.archiviertAm||timestamp()});
      materials.docs.forEach((m,i)=>{tx.set(targets[i],m.data());tx.delete(m.ref);});
      tx.delete(source);
      tx.set(db.collection('logs').doc(),{bereich:'Baustellenmaterial',aktion:'Baustelle archiviert',objektTyp:'baustelle',objektId:id,benutzerName:(profile.exists&&profile.data().username)||user.displayName||user.email||uid,benutzerEmail:user.email||'',benutzerUid:uid,details:'Archiv-Sammlungen: '+materials.size+' Materialpositionen',createdAt:timestamp()});
      return {archived:true,materials:materials.size};
    });
  };
}
module.exports={createArchive};
