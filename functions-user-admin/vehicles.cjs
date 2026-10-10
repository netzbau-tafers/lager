'use strict';
const {MASTER}=require('./service.cjs');
const {assertNoUsageOverlap}=require('./vehicle-backfill.cjs');

// Zurich's current civil day at 07:00, including DST. No client clock is trusted.
function dayStart(ms){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Zurich',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(ms).map(p=>[p.type,p.value]));
  const noon=Date.UTC(+parts.year,+parts.month-1,+parts.day,12);
  const hour=+new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Zurich',hour:'2-digit',hourCycle:'h23'}).format(noon);
  return Date.UTC(+parts.year,+parts.month-1,+parts.day,7)-(hour-12)*3600000;
}
function createVehicles({db,auth,Timestamp,ErrorType,now=Date.now}){
  const fail=(code,message)=>{throw new ErrorType(code,message);};
  const string=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=max&&!/[<>\u0000-\u001f\u007f]/.test(value);
  const validKm=value=>Number.isSafeInteger(value)&&value>=0&&value<=9999999;
  async function actor(request){
    if(!request.auth)fail('unauthenticated','Bitte anmelden.');
    const uid=request.auth.uid,user=await auth.getUser(uid);
    if(user.disabled)fail('permission-denied','Konto gesperrt.');
    const profile=await db.collection('users').doc(uid).get();
    return {uid,name:profile.data()?.username||user.displayName||user.email||'Benutzer'};
  }
  async function permitted(tx,uid,create=false,takeover=false){
    const [deleted,access]=await Promise.all([tx.get(db.collection('account_deletions').doc(uid)),tx.get(db.collection('user_access').doc(uid))]);
    if(deleted.exists)fail('permission-denied','Konto gelöscht.');
    if(uid===MASTER)return;
    const p=access.data()?.permissions||{};
    if(takeover&&p.fahrzeugeUebernehmen!=='edit')fail('permission-denied','Du darfst keine belegten Fahrzeuge übernehmen.');
    if(create?(!['view','edit'].includes(p.fahrzeuge)||p.fahrzeugeErstellen!=='edit'):p.fahrzeuge!=='edit')fail('permission-denied',create?'Du darfst keine Fahrzeuge hinzufügen oder löschen.':'Du darfst Fahrzeuge nur ansehen oder hast keinen Zugriff.');
  }
  return {
    async create(request){
      const who=await actor(request),data=request.data||{};
      if(!string(data.name,100)||!string(data.plate,30)||!validKm(data.km))fail('invalid-argument','Name, Kennzeichen und gültigen Kilometerstand angeben.');
      const ref=db.collection('fahrzeuge').doc(),time=Timestamp.fromMillis(now());
      await db.runTransaction(async tx=>{
        await permitted(tx,who.uid,true);
        tx.create(ref,{name:data.name.trim(),plate:data.plate.trim(),km:data.km,kmAt:time,kmBy:who,status:'frei',active:null,lastUseEnd:null,revision:0,createdAt:time,createdBy:who,updatedAt:time});
      });
      return {id:ref.id};
    },
    async remove(request){
      const who=await actor(request),data=request.data||{};
      if(!string(data.id,128)||data.id.includes('/')||!Number.isSafeInteger(data.revision)||data.revision<0)fail('invalid-argument','Ungültiges Fahrzeug.');
      const ref=db.collection('fahrzeuge').doc(data.id);
      await db.runTransaction(async tx=>{
        await permitted(tx,who.uid,true);
        const snapshot=await tx.get(ref);
        if(!snapshot.exists)return; // Repeated deletion leaves the retained history untouched.
        const v=snapshot.data();
        if(v.revision!==data.revision)fail('failed-precondition','Das Fahrzeug wurde gerade geändert. Bitte erneut öffnen.');
        if(v.active)fail('failed-precondition','Das Fahrzeug ist noch in Gebrauch. Zuerst freigeben.');
        tx.set(db.collection('fahrzeuge_archiv').doc(data.id),{...v,deletedAt:Timestamp.fromMillis(now()),deletedBy:who,historyPath:ref.path+'/verlauf'});
        tx.delete(ref);
      });
      // Preserve all history and action documents under the original vehicle path.
      return {deleted:true};
    },
    async action(request){
      const who=await actor(request),data=request.data||{};
      if(!string(data.id,128)||data.id.includes('/')||!Number.isSafeInteger(data.revision)||data.revision<0||!['start','free','takeover','day','fuel'].includes(data.action)||typeof data.requestId!=='string'||!/^[a-zA-Z0-9_-]{16,80}$/.test(data.requestId))fail('invalid-argument','Ungültige Fahrzeugaktion.');
      if(data.action==='fuel'&&!validKm(data.km))fail('invalid-argument','Gültigen aktuellen Kilometerstand angeben.');
      const ref=db.collection('fahrzeuge').doc(data.id),event=ref.collection('verlauf').doc(),operation=ref.collection('aktionen').doc(who.uid+'_'+data.requestId);
      await db.runTransaction(async tx=>{
        await permitted(tx,who.uid,false,data.action==='takeover');
        const lockRef=db.collection('fahrzeug_nutzung').doc(who.uid);
        const [snapshot,previous,lock]=await Promise.all([tx.get(ref),tx.get(operation),tx.get(lockRef)]);
        if(previous.exists){if(previous.data().action!==data.action||previous.data().km!==(data.km??null))fail('invalid-argument','Diese Anfrage wurde bereits anders verwendet.');return;}
        if(!snapshot.exists)fail('not-found','Fahrzeug nicht gefunden.');
        const v=snapshot.data();
        if(v.revision!==data.revision)fail('failed-precondition','Das Fahrzeug wurde gerade geändert. Bitte den aktuellen Stand prüfen und erneut klicken.');
        const ms=now(),time=Timestamp.fromMillis(ms),active=v.active;
        const change={revision:v.revision+1,updatedAt:time};
        if(['start','takeover','day'].includes(data.action)&&lock.data()?.vehicleId)fail('failed-precondition','Du hast bereits ein Fahrzeug in Gebrauch. Gib es zuerst frei.');
        // Read the prior user's lock before writing anything in the transaction.
        const previousLock=active&&active.uid!==who.uid?db.collection('fahrzeug_nutzung').doc(active.uid):null;
        const previousLockSnapshot=previousLock?await tx.get(previousLock):null;
        if(data.action==='start'||data.action==='takeover'){
          if(data.action==='start'&&active)fail('failed-precondition','Das Fahrzeug ist bereits in Gebrauch.');
          if(data.action==='takeover'&&(!active||active.uid===who.uid))fail('failed-precondition','Eine Übernahme ist nur von einer anderen Person möglich.');
          if(active){
            if(previousLockSnapshot?.data()?.vehicleId===data.id)tx.set(previousLock,{vehicleId:null,updatedAt:time});
            change.lastUseEnd=time;
            tx.update(ref.collection('verlauf').doc(active.sessionId),{end:time,closedBy:who,reason:'übernommen',takenOverBy:who});
            tx.create(ref.collection('verlauf').doc(),{type:'takeover',createdAt:time,actor:who,from:{uid:active.uid,name:active.name},start:time,end:time});
          }
          change.status='inGebrauch';change.active={...who,start:time,sessionId:event.id};
          tx.set(lockRef,{vehicleId:data.id,updatedAt:time});
          tx.create(event,{type:'use',actor:who,start:time,end:null,createdAt:time,reason:'normal'});
        }else if(data.action==='free'){
          if(!active||active.uid!==who.uid)fail('permission-denied','Nur die eingetragene Person darf das Fahrzeug freigeben. Verwende sonst die Übernahme.');
          tx.update(ref.collection('verlauf').doc(active.sessionId),{end:time,closedBy:who});
          change.status='frei';change.active=null;change.lastUseEnd=time;
          if(lock.data()?.vehicleId===data.id)tx.set(lockRef,{vehicleId:null,updatedAt:time});
        }else if(data.action==='day'){
          if(active)fail('failed-precondition','Das Fahrzeug ist noch in Gebrauch. Zuerst freigeben oder übernehmen.');
          const start=Math.max(dayStart(ms),v.lastUseEnd?.toMillis?.()||0);
          if(start>=ms)fail('failed-precondition','Vor 07:00 oder ohne neue Nutzungszeit ist kein Ganztagseintrag möglich.');
          await assertNoUsageOverlap(tx,ref,v,start,ms,fail);
          tx.create(event,{type:'day',actor:who,start:Timestamp.fromMillis(start),end:time,createdAt:time,reason:'nachgetragen'});
          change.lastUseEnd=time;
        }else{
          if(data.km<v.km)fail('invalid-argument','Der Kilometerstand darf nicht kleiner als der gespeicherte Stand sein.');
          tx.create(event,{type:'fuel',actor:who,km:data.km,start:time,end:time,createdAt:time});
          change.km=data.km;change.kmAt=time;change.kmBy=who;
        }
        tx.update(ref,change);
        tx.create(operation,{action:data.action,km:data.km??null,createdAt:time});
      });
      return {saved:true};
    }
  };
}
module.exports={createVehicles,dayStart};
