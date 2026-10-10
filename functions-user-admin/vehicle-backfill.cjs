'use strict';
const {MASTER}=require('./service.cjs');
const format=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Zurich',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
// Accept civil Zurich times, independent of the phone's timezone. Reject invalid/ambiguous DST times.
function zurichMillis(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))return NaN;
  const [year,month,day,hour,minute]=value.match(/\d+/g).map(Number);
  if(year<2000||year>9999)return NaN;
  const utc=Date.UTC(year,month-1,day,hour,minute);
  const matches=[1,2].map(offset=>utc-offset*3600000).filter(ms=>format.format(new Date(ms)).replace(' ','T')===value);
  return matches.length===1?matches[0]:NaN;
}
function createBackfill({db,auth,Timestamp,ErrorType,now=Date.now}){
  const fail=(code,message)=>{throw new ErrorType(code,message);};
  const validId=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(id);
  async function account(uid){
    if(!validId(uid))fail('invalid-argument','Ungültige Person.');
    const [user,profile,deleted,access]=await Promise.all([auth.getUser(uid),db.collection('users').doc(uid).get(),db.collection('account_deletions').doc(uid).get(),db.collection('user_access').doc(uid).get()]);
    if(user.disabled||deleted.exists)fail('permission-denied','Dieses Konto ist nicht aktiv.');
    const level=uid===MASTER?'edit':access.data()?.permissions?.fahrzeuge;
    return {uid,name:profile.data()?.username||user.displayName||'Benutzer '+uid.slice(0,8),level};
  }
  async function caller(request,write){
    if(!request.auth)fail('unauthenticated','Bitte anmelden.');
    const user=await account(request.auth.uid);
    if(write?user.level!=='edit':!['view','edit'].includes(user.level))fail('permission-denied','Keine Berechtigung für diese Fahrzeugaktion.');
    return user;
  }
  async function txAllowed(tx,uid,write){
    const [deleted,access]=await Promise.all([tx.get(db.collection('account_deletions').doc(uid)),tx.get(db.collection('user_access').doc(uid))]);
    const level=uid===MASTER?'edit':access.data()?.permissions?.fahrzeuge;
    if(deleted.exists||(write?level!=='edit':!['view','edit'].includes(level)))fail('permission-denied','Keine Berechtigung für diese Fahrzeugaktion.');
  }
  const person=user=>({uid:user.uid,name:user.name});
  const requests=db.collection('fahrzeug_nachtraege');
  return {
    async recipients(request){
      await caller(request,true);
      const users=[];let pageToken;
      do{
        const page=await auth.listUsers(1000,pageToken);pageToken=page.pageToken;
        for(let offset=0;offset<page.users.length;offset+=20){
          const selected=await Promise.all(page.users.slice(offset,offset+20).filter(user=>!user.disabled).map(async user=>{
            try{const found=await account(user.uid);return ['view','edit'].includes(found.level)?person(found):null;}
            catch(error){if(!['permission-denied','auth/user-not-found'].includes(error.code))throw error;return null;}
          }));
          users.push(...selected.filter(Boolean));
        }
      }while(pageToken);
      return {users:users.sort((a,b)=>a.name.localeCompare(b.name,'de-CH'))};
    },
    async propose(request){
      const who=await caller(request,true),data=request.data||{};
      if(!validId(data.vehicleId)||!validId(data.targetUid)||typeof data.requestId!=='string'||!/^[a-zA-Z0-9_-]{16,80}$/.test(data.requestId))fail('invalid-argument','Ungültiger Nachtrag.');
      if(typeof data.wholeDay!=='boolean')fail('invalid-argument','Zeitraum auswählen.');
      if(data.wholeDay&&(typeof data.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(data.date)))fail('invalid-argument','Datum auswählen.');
      const start=zurichMillis(data.wholeDay?data.date+'T07:00':data.start),end=zurichMillis(data.wholeDay?data.date+'T17:15':data.end);
      if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end||end>now())fail('invalid-argument','Gültigen abgeschlossenen Zeitraum in Schweizer Zeit angeben. Bei der Zeitumstellung bitte eine eindeutige Uhrzeit wählen.');
      const selected=await account(data.targetUid);
      if(!['view','edit'].includes(selected.level))fail('permission-denied','Die ausgewählte Person hat keinen Fahrzeugzugriff.');
      const id=who.uid+'_'+data.requestId,ref=requests.doc(id),vehicleRef=db.collection('fahrzeuge').doc(data.vehicleId),historyRef=vehicleRef.collection('verlauf').doc('nachtrag_'+id);
      await db.runTransaction(async tx=>{
        await txAllowed(tx,who.uid,true);await txAllowed(tx,selected.uid,false);
        const [old,vehicle]=await Promise.all([tx.get(ref),tx.get(vehicleRef)]);
        if(old.exists){const previous=old.data();if(previous.vehicleId!==data.vehicleId||previous.targetUid!==data.targetUid||previous.start.toMillis()!==start||previous.end.toMillis()!==end||previous.wholeDay!==data.wholeDay)fail('invalid-argument','Diese Anfrage wurde bereits anders verwendet.');return;}
        if(!vehicle.exists)fail('not-found','Fahrzeug nicht gefunden.');
        const v=vehicle.data(),time=Timestamp.fromMillis(now());
        const proposal={vehicleId:data.vehicleId,vehicleName:v.name,plate:v.plate,targetUid:selected.uid,actor:person(selected),requestedBy:person(who),start:Timestamp.fromMillis(start),end:Timestamp.fromMillis(end),wholeDay:data.wholeDay,status:'pending',createdAt:time,historyId:historyRef.id};
        tx.create(ref,proposal);
        tx.create(historyRef,{type:'backfill',actor:proposal.actor,requestedBy:proposal.requestedBy,start:proposal.start,end:proposal.end,wholeDay:proposal.wholeDay,status:'pending',requestId:id,createdAt:time});
        // Revision refreshes opened history without reading the full history in a live listener.
        tx.update(vehicleRef,{revision:v.revision+1,updatedAt:time});
      });
      return {id,status:'pending'};
    },
    async review(request){
      const who=await caller(request,false),data=request.data||{};
      if(typeof data.id!=='string'||!/^[a-zA-Z0-9_-]{1,220}$/.test(data.id)||!['confirmed','rejected'].includes(data.decision))fail('invalid-argument','Ungültige Bestätigung.');
      const ref=requests.doc(data.id);
      await db.runTransaction(async tx=>{
        await txAllowed(tx,who.uid,false);
        const snapshot=await tx.get(ref);
        if(!snapshot.exists)fail('not-found','Nachtrag nicht gefunden.');
        const proposal=snapshot.data();
        if(proposal.targetUid!==who.uid)fail('permission-denied','Nur die ausgewählte Person darf diesen Nachtrag bestätigen oder ablehnen.');
        if(proposal.status!=='pending'){if(proposal.status===data.decision)return;fail('failed-precondition','Dieser Nachtrag wurde bereits entschieden.');}
        const vehicleRef=db.collection('fahrzeuge').doc(proposal.vehicleId),vehicle=await tx.get(vehicleRef),time=Timestamp.fromMillis(now());
        const historyRef=vehicleRef.collection('verlauf').doc(proposal.historyId);
        if(data.decision==='confirmed')tx.update(historyRef,{status:'confirmed',confirmedAt:time,confirmedBy:person(who)});
        else tx.delete(historyRef);
        tx.update(ref,{status:data.decision,reviewedAt:time,reviewedBy:person(who)});
        // Approval never alters current occupancy or lastUseEnd (this is historical usage).
        if(vehicle.exists)tx.update(vehicleRef,{revision:vehicle.data().revision+1,updatedAt:time});
      });
      return {status:data.decision};
    }
  };
}
function createBackfillNotifier({db,auth,messaging,logger,now=Date.now}){
  return async event=>{
    const snapshot=event.data;if(!snapshot)return;
    const ref=snapshot.ref,proposal=snapshot.data();if(proposal.status!=='pending')return;
    const [account,deleted,access]=await Promise.all([auth.getUser(proposal.targetUid),db.collection('account_deletions').doc(proposal.targetUid).get(),db.collection('user_access').doc(proposal.targetUid).get()]);
    if(account.disabled||deleted.exists||(proposal.targetUid!==MASTER&&!['view','edit'].includes(access.data()?.permissions?.fahrzeuge)))return;
    const devices=await db.collection('push_devices').where('uid','==',proposal.targetUid).get();
    let sent=0;
    for(const device of devices.docs){
      const [current,latest]=await Promise.all([ref.get(),device.ref.get()]);
      if(!current.exists||current.data().status!=='pending'||!latest.exists||latest.data().uid!==proposal.targetUid||now()-(latest.data().updatedAt?.toMillis?.()||0)>=90*24*60*60*1000)continue;
      try{
        const pretty=ms=>new Intl.DateTimeFormat('de-CH',{timeZone:'Europe/Zurich',dateStyle:'short',timeStyle:'short'}).format(new Date(ms));
        await messaging.send({token:latest.data().token,webpush:{headers:{TTL:'86400'},notification:{title:'Fahrzeugnutzung bestätigen',body:proposal.requestedBy.name+' hat '+proposal.vehicleName+' ('+proposal.plate+') für dich nachgetragen: '+pretty(proposal.start.toMillis())+' bis '+pretty(proposal.end.toMillis())+'. Bitte bestätigen oder ablehnen.',icon:'https://netzbau-tafers.github.io/lager/favicon.png',tag:'nachtrag-'+snapshot.id},fcmOptions:{link:'https://netzbau-tafers.github.io/lager/fahrzeuge.html?nachtrag='+encodeURIComponent(snapshot.id)}}});sent++;
      }catch(error){logger.warn('Nachtrag-Benachrichtigung fehlgeschlagen',{code:error.code||'unknown'});}
    }
    await ref.set({notificationStatus:sent?'sent':'not-delivered'},{merge:true});
  };
}
module.exports={createBackfill,createBackfillNotifier,zurichMillis};
