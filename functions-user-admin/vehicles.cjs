'use strict';
const {MASTER}=require('./service.cjs');
const {assertNoUsageOverlap,zurichMillis}=require('./vehicle-backfill.cjs');

// Zurich's current civil day at 07:00, including DST. No client clock is trusted.
function dayStart(ms){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Zurich',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(ms).map(p=>[p.type,p.value]));
  const noon=Date.UTC(+parts.year,+parts.month-1,+parts.day,12);
  const hour=+new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Zurich',hour:'2-digit',hourCycle:'h23'}).format(noon);
  return Date.UTC(+parts.year,+parts.month-1,+parts.day,7)-(hour-12)*3600000;
}
function createVehicles({db,auth,Timestamp,ErrorType,FieldValue,now=Date.now}){
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
  async function permitted(tx,uid,create=false,takeover=false,serviceAccess=false){
    const [deleted,access]=await Promise.all([tx.get(db.collection('account_deletions').doc(uid)),tx.get(db.collection('user_access').doc(uid))]);
    if(deleted.exists)fail('permission-denied','Konto gelöscht.');
    if(uid===MASTER)return;
    const p=access.data()?.permissions||{};
    if(serviceAccess){if(!['view','edit'].includes(p.fahrzeuge))fail('permission-denied','Du hast keinen Zugriff auf Fahrzeuge.');return;}
    if(takeover&&p.fahrzeugeUebernehmen!=='edit')fail('permission-denied','Du darfst keine belegten Fahrzeuge übernehmen.');
    if(create?(!['view','edit'].includes(p.fahrzeuge)||p.fahrzeugeErstellen!=='edit'):p.fahrzeuge!=='edit')fail('permission-denied',create?'Du darfst keine Fahrzeuge hinzufügen, bearbeiten oder löschen.':'Du darfst Fahrzeuge nur ansehen oder hast keinen Zugriff.');
  }
  function information(data){
    const responsible=data.responsible??'',details=data.details??'';
    if(typeof responsible!=='string'||responsible.trim().length>100||/[<>\u0000-\u001f\u007f]/.test(responsible))fail('invalid-argument','Fahrzeugverantwortlicher: höchstens 100 Zeichen.');
    if(typeof details!=='string'||details.trim().length>5000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(details))fail('invalid-argument','Details: höchstens 5000 Zeichen.');
    return {responsible:responsible.trim(),details:details.trim()};
  }
  function civilDay(ms){
    return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Zurich',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms));
  }
  const validTime=value=>typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  async function checkOverlap(tx,ref,vehicle,start,end,excludeId){
    if(vehicle.active&&vehicle.active.sessionId!==excludeId&&vehicle.active.start?.toMillis?.()<end)
      fail('failed-precondition','Das Fahrzeug wird in diesem Zeitraum bereits benutzt.');
    const query=await tx.get(ref.collection('verlauf').where('end','>',Timestamp.fromMillis(start)));
    for(const doc of query.docs){
      if(doc.id===excludeId)continue;
      const entry=doc.data(),begin=entry.start?.toMillis?.(),finish=entry.end?.toMillis?.();
      if(['use','day','backfill'].includes(entry.type)&&entry.status!=='rejected'&&Number.isFinite(begin)&&Number.isFinite(finish)&&begin<end&&finish>start)
        fail('failed-precondition','Die Nutzungszeit überschneidet sich mit einer anderen Nutzung.');
    }
  }
  return {
    async editOwnUsage(request){
      const who=await actor(request),data=request.data||{};
      if(!string(data.vehicleId,128)||!/^[a-zA-Z0-9_-]+$/.test(data.vehicleId)||
         !string(data.eventId,128)||!/^[a-zA-Z0-9_-]+$/.test(data.eventId)||
         ((data.startDate!==undefined||data.endDate!==undefined)&&
           (typeof data.startDate!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(data.startDate)||
            typeof data.endDate!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(data.endDate)))||
         (data.date!==undefined&&(typeof data.date!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(data.date)))||
         !validTime(data.startTime)||!validTime(data.endTime))
        fail('invalid-argument','Ungültiges Datum oder ungültige Nutzungszeit.');
      const ref=db.collection('fahrzeuge').doc(data.vehicleId),eventRef=ref.collection('verlauf').doc(data.eventId);
      await db.runTransaction(async tx=>{
        await permitted(tx,who.uid,false,false,true);
        const [vehicleSnap,eventSnap]=await Promise.all([tx.get(ref),tx.get(eventRef)]);
        if(!vehicleSnap.exists||!eventSnap.exists)fail('not-found','Nutzung nicht gefunden.');
        const vehicle=vehicleSnap.data(),entry=eventSnap.data();
        if(entry.actor?.uid!==who.uid)fail('permission-denied','Du darfst nur deine eigene Nutzungszeit anpassen.');
        if(!['use','day','backfill'].includes(entry.type)||!entry.end||['pending','rejected'].includes(entry.status))
          fail('failed-precondition','Dieser Verlaufseintrag kann nicht geändert werden.');
        if(vehicle.active?.sessionId===data.eventId)fail('failed-precondition','Eine laufende Nutzung kann nicht geändert werden.');
        const previousStart=entry.start?.toMillis?.(),previousEnd=entry.end?.toMillis?.();
        if(!Number.isFinite(previousStart)||!Number.isFinite(previousEnd))fail('failed-precondition','Zeitstempel fehlen.');
        const startDay=data.startDate||data.date||civilDay(previousStart),endDay=data.endDate||data.date||civilDay(previousEnd);
        const start=zurichMillis(startDay+'T'+data.startTime),end=zurichMillis(endDay+'T'+data.endTime);
        if(!Number.isFinite(start)||!Number.isFinite(end)||civilDay(start)!==startDay||start>=end||end>now()||civilDay(end)!==endDay)
          fail('invalid-argument','Beginn und Ende müssen gültige Schweizer Datums- und Zeitangaben sein; das Ende darf nicht in der Zukunft liegen.');
        await checkOverlap(tx,ref,vehicle,start,end,data.eventId);
        const time=Timestamp.fromMillis(now()),historyTime=FieldValue?.serverTimestamp?.()||time;
        let proposalRef=null,proposal=null;
        if(entry.type==='backfill'&&entry.requestId){
          proposalRef=db.collection('fahrzeug_nachtraege').doc(entry.requestId);
          proposal=await tx.get(proposalRef);
        }
        tx.update(eventRef,{start:Timestamp.fromMillis(start),end:Timestamp.fromMillis(end),updatedAt:historyTime,editedAt:time,editedBy:who});
        if(proposal?.exists)tx.update(proposalRef,{start:Timestamp.fromMillis(start),end:Timestamp.fromMillis(end)});
        tx.update(ref,{revision:vehicle.revision+1,updatedAt:time});
      });
      return {saved:true};
    },
    async service(request){
      const who=await actor(request),data=request.data||{};
      if(!string(data.id,128)||data.id.includes('/')||!Number.isSafeInteger(data.revision)||data.revision<0)fail('invalid-argument','Ungültiges Fahrzeug.');
      const {validServiceDate}=require('./vehicle-service.cjs');
      for(const key of ['vehicle','crane'])if(data[key]!==null&&!validServiceDate(data[key]))fail('invalid-argument','Gültiges Servicedatum angeben.');
      const ref=db.collection('fahrzeuge').doc(data.id);
      await db.runTransaction(async tx=>{
        await permitted(tx,who.uid,false,false,true);
        const snapshot=await tx.get(ref);
        if(!snapshot.exists)fail('not-found','Fahrzeug nicht gefunden.');
        const v=snapshot.data();
        if(v.revision!==data.revision)fail('failed-precondition','Das Fahrzeug wurde gerade geändert. Bitte erneut öffnen.');
        tx.update(ref,{serviceDates:{vehicle:data.vehicle,crane:data.crane},revision:v.revision+1,updatedAt:Timestamp.fromMillis(now()),updatedBy:who});
      });
      return {saved:true};
    },
    async create(request){
      const who=await actor(request),data=request.data||{};
      if(!string(data.name,100)||!string(data.plate,30)||!validKm(data.km))fail('invalid-argument','Name, Kennzeichen und gültigen Kilometerstand angeben.');
      const info=information(data);
      const ref=db.collection('fahrzeuge').doc(),time=Timestamp.fromMillis(now());
      await db.runTransaction(async tx=>{
        await permitted(tx,who.uid,true);
        tx.create(ref,{...info,name:data.name.trim(),plate:data.plate.trim(),km:data.km,kmAt:time,kmBy:who,status:'frei',active:null,lastUseEnd:null,revision:0,createdAt:time,createdBy:who,updatedAt:time});
      });
      return {id:ref.id};
    },
    async edit(request){
      const who=await actor(request),data=request.data||{};
      if(!string(data.id,128)||data.id.includes('/')||!Number.isSafeInteger(data.revision)||data.revision<0||!string(data.name,100)||!string(data.plate,30))fail('invalid-argument','Gültiges Fahrzeug, Name und Kennzeichen angeben.');
      const info=information(data),ref=db.collection('fahrzeuge').doc(data.id);
      await db.runTransaction(async tx=>{
        await permitted(tx,who.uid,true);
        const snapshot=await tx.get(ref);
        if(!snapshot.exists)fail('not-found','Fahrzeug nicht gefunden.');
        const v=snapshot.data();
        if(v.revision!==data.revision)fail('failed-precondition','Das Fahrzeug wurde gerade geändert. Bitte erneut öffnen.');
        tx.update(ref,{...info,name:data.name.trim(),plate:data.plate.trim(),revision:v.revision+1,updatedAt:Timestamp.fromMillis(now()),updatedBy:who});
      });
      return {saved:true};
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
      if(data.action==='free'&&!validTime(data.endTime))fail('invalid-argument','Gültige Rückgabezeit angeben.');
      if(data.action==='fuel'&&!validKm(data.km))fail('invalid-argument','Gültigen aktuellen Kilometerstand angeben.');
      const ref=db.collection('fahrzeuge').doc(data.id),event=ref.collection('verlauf').doc(),operation=ref.collection('aktionen').doc(who.uid+'_'+data.requestId);
      await db.runTransaction(async tx=>{
        await permitted(tx,who.uid,false,data.action==='takeover');
        const lockRef=db.collection('fahrzeug_nutzung').doc(who.uid);
        const [snapshot,previous,lock]=await Promise.all([tx.get(ref),tx.get(operation),tx.get(lockRef)]);
        if(previous.exists){if(previous.data().action!==data.action||previous.data().km!==(data.km??null)||previous.data().endTime!==(data.endTime??null))fail('invalid-argument','Diese Anfrage wurde bereits anders verwendet.');return;}
        if(!snapshot.exists)fail('not-found','Fahrzeug nicht gefunden.');
        const v=snapshot.data();
        if(v.revision!==data.revision)fail('failed-precondition','Das Fahrzeug wurde gerade geändert. Bitte den aktuellen Stand prüfen und erneut klicken.');
        const ms=now(),time=Timestamp.fromMillis(ms),active=v.active;
        const historyTime=FieldValue?.serverTimestamp?.()||time;
        const metadata={vehicleId:data.id,vehicleName:v.name,plate:v.plate,updatedAt:historyTime};
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
            tx.update(ref.collection('verlauf').doc(active.sessionId),{...metadata,end:time,closedBy:who,reason:'übernommen',takenOverBy:who});
            tx.create(ref.collection('verlauf').doc(),{...metadata,type:'takeover',createdAt:time,actor:who,from:{uid:active.uid,name:active.name},usageId:active.sessionId,start:time,end:time});
          }
          change.status='inGebrauch';change.active={...who,start:time,sessionId:event.id};
          tx.set(lockRef,{vehicleId:data.id,updatedAt:time});
          tx.create(event,{...metadata,type:'use',actor:who,start:time,end:null,createdAt:time,reason:'normal'});
        }else if(data.action==='free'){
          if(!active||active.uid!==who.uid)fail('permission-denied','Nur die eingetragene Person darf das Fahrzeug freigeben. Verwende sonst die Übernahme.');
          const endMs=zurichMillis(civilDay(ms)+'T'+data.endTime);
          if(!Number.isFinite(endMs)||endMs>ms||endMs<active.start?.toMillis?.())fail('invalid-argument','Rückgabezeit muss nach dem Nutzungsbeginn liegen und darf nicht in der Zukunft sein.');
          await checkOverlap(tx,ref,v,active.start.toMillis(),endMs,active.sessionId);
          const end=Timestamp.fromMillis(endMs);
          tx.update(ref.collection('verlauf').doc(active.sessionId),{...metadata,end,closedBy:who});
          change.status='frei';change.active=null;change.lastUseEnd=end;
          if(lock.data()?.vehicleId===data.id)tx.set(lockRef,{vehicleId:null,updatedAt:time});
        }else if(data.action==='day'){
          if(active)fail('failed-precondition','Das Fahrzeug ist noch in Gebrauch. Zuerst freigeben oder übernehmen.');
          const start=Math.max(dayStart(ms),v.lastUseEnd?.toMillis?.()||0);
          if(start>=ms)fail('failed-precondition','Vor 07:00 oder ohne neue Nutzungszeit ist kein Ganztagseintrag möglich.');
          await assertNoUsageOverlap(tx,ref,v,start,ms,fail);
          tx.create(event,{...metadata,type:'day',actor:who,start:Timestamp.fromMillis(start),end:time,createdAt:time,reason:'nachgetragen'});
          change.lastUseEnd=time;
        }else{
          if(data.km<v.km)fail('invalid-argument','Der Kilometerstand darf nicht kleiner als der gespeicherte Stand sein.');
          tx.create(event,{...metadata,type:'fuel',actor:who,km:data.km,start:time,end:time,createdAt:time});
          change.km=data.km;change.kmAt=time;change.kmBy=who;
        }
        tx.update(ref,change);
        tx.create(operation,{action:data.action,km:data.km??null,endTime:data.endTime??null,createdAt:time});
      });
      return {saved:true};
    }
  };
}
module.exports={createVehicles,dayStart};
