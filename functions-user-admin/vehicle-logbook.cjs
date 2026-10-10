'use strict';
const {MASTER}=require('./service.cjs');
const {zurichMillis}=require('./vehicle-backfill.cjs');
const PAGE=20;
function bounds(date,time){
  const start=zurichMillis(date+'T00:00');
  if(!Number.isFinite(start))return null;
  const next=new Date(Date.parse(date+'T12:00:00Z')+86400000).toISOString().slice(0,10);
  const end=zurichMillis(next+'T00:00');
  if(time){const instant=zurichMillis(date+'T'+time);return Number.isFinite(instant)?{start:instant,end:instant+60000,instant:true}:null;}
  return {start,end,instant:false};
}
function matches(entry,range,kind){
  if(entry.status==='rejected'||entry.type==='takeover')return false;
  if(kind==='fuel'&&entry.type!=='fuel'||kind==='use'&&entry.type==='fuel')return false;
  const start=entry.start?.toMillis?.(),end=entry.end?.toMillis?.();
  if(!Number.isFinite(start))return false;
  if(entry.type==='fuel')return start>=range.start&&start<range.end;
  return (range.instant?start<=range.start:start<range.end)&&(entry.end===null||Number.isFinite(end)&&end>range.start);
}
function createLogbook({db,auth,Timestamp,ErrorType}){
  const fail=(code,msg)=>{throw new ErrorType(code,msg);};
  async function allowed(request){
    if(!request.auth)fail('unauthenticated','Bitte anmelden.');
    const uid=request.auth.uid;
    const [user,deleted,access]=await Promise.all([auth.getUser(uid),db.collection('account_deletions').doc(uid).get(),db.collection('user_access').doc(uid).get()]);
    if(user.disabled||deleted.exists||uid!==MASTER&&access.data()?.permissions?.fahrtenbuch!=='edit')fail('permission-denied','Kein Zugriff auf das Fahrtenbuch.');
  }
  const serial=doc=>{const e=doc.data();return {id:doc.id,type:e.type,actor:e.actor||null,requestedBy:e.requestedBy||null,start:e.start?.toMillis?.()??null,end:e.end?.toMillis?.()??null,km:e.km??null,status:e.status||null,vehicleName:e.vehicleName||null,plate:e.plate||null,reason:e.reason||null,confirmedAt:e.confirmedAt?.toMillis?.()??null};};
  return {
    async catalog(request){
      await allowed(request);
      const [active,archive]=await Promise.all([db.collection('fahrzeuge').get(),db.collection('fahrzeuge_archiv').get()]);
      const map=new Map();for(const doc of archive.docs)map.set(doc.id,{id:doc.id,name:doc.data().name,plate:doc.data().plate,deleted:true});
      for(const doc of active.docs)map.set(doc.id,{id:doc.id,name:doc.data().name,plate:doc.data().plate,deleted:false});
      return {vehicles:[...map.values()].sort((a,b)=>a.name.localeCompare(b.name,'de-CH'))};
    },
    async search(request){
      await allowed(request);const d=request.data||{};
      if(typeof d.vehicleId!=='string'||!/^[-\w]{1,128}$/.test(d.vehicleId)||typeof d.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||!['all','use','fuel'].includes(d.kind||'all')||d.time&& !/^\d{2}:\d{2}$/.test(d.time))fail('invalid-argument','Fahrzeug und gültiges Datum auswählen.');
      const range=bounds(d.date,d.time);if(!range)fail('invalid-argument','Ungültige oder bei der Zeitumstellung mehrdeutige Schweizer Uhrzeit.');
      const history=db.collection('fahrzeuge').doc(d.vehicleId).collection('verlauf');
      let query=history.where('end','>=',Timestamp.fromMillis(range.start)).where('start','<',Timestamp.fromMillis(range.end)).orderBy('end').orderBy('start');
      if(d.cursor){
        if(typeof d.cursor!=='string'||!/^[-\w]{1,240}$/.test(d.cursor))fail('invalid-argument','Ungültige Fortsetzung.');
        const cursor=await history.doc(d.cursor).get();if(!cursor.exists)fail('failed-precondition','Die Ergebnisse haben sich geändert. Bitte neu suchen.');
        if(!cursor.data().end||cursor.data().end.toMillis()<range.start||cursor.data().start.toMillis()>=range.end)fail('invalid-argument','Fortsetzung gehört nicht zur Suche.');
        query=query.startAfter(cursor);
      }
      // Open sessions have null end, so they must be queried separately. Never load a year's history.
      const [closed,open]=await Promise.all([query.limit(PAGE).get(),!d.cursor&&d.kind!=='fuel'?history.where('end','==',null).where('start','<',Timestamp.fromMillis(range.end)).orderBy('start').limit(PAGE).get():Promise.resolve({docs:[]})]);
      return {entries:[...open.docs,...closed.docs].filter(doc=>matches(doc.data(),range,d.kind||'all')).map(serial),cursor:closed.docs.length===PAGE?closed.docs.at(-1).id:null,openWarning:open.docs.length===PAGE};
    }
  };
}
module.exports={createLogbook,bounds,matches};
