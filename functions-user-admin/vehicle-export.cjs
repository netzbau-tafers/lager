'use strict';
const {createHash}=require('node:crypto');
const {gzipSync,gunzipSync}=require('node:zlib');
const {MASTER}=require('./service.cjs');
const {bounds,matches}=require('./vehicle-logbook.cjs');
const PAGE=100,MAX_RECORDS=20000;
const digest=text=>createHash('sha256').update(text).digest('hex');
const validId=id=>typeof id==='string'&&/^[-\w]{1,240}$/.test(id);
const version=doc=>[doc.updateTime.seconds,doc.updateTime.nanoseconds].join(':');
function fields(data){
  function value(v){
    if(v===null)return {nullValue:null};
    if(typeof v==='string')return {stringValue:v};
    if(typeof v==='boolean')return {booleanValue:v};
    if(typeof v==='number')return Number.isSafeInteger(v)?{integerValue:String(v)}:{doubleValue:v};
    if(typeof v?.toMillis==='function')return {timestampValue:new Date(v.seconds*1000).toISOString().slice(0,19)+'.'+String(v.nanoseconds).padStart(9,'0')+'Z'};
    if(Array.isArray(v))return {arrayValue:{values:v.map(value)}};
    if(v&&typeof v==='object')return {mapValue:{fields:fields(v)}};
    throw Error('Nicht unterstützter Sicherungswert');
  }
  return Object.fromEntries(Object.entries(data).map(([key,v])=>[key,value(v)]));
}
function decode(map,Timestamp){
  function value(v){
    if('nullValue'in v)return null;if('stringValue'in v)return v.stringValue;if('booleanValue'in v)return v.booleanValue;
    if('integerValue'in v)return Number(v.integerValue);if('doubleValue'in v)return v.doubleValue;
    if('timestampValue'in v){const ms=Date.parse(v.timestampValue),fraction=(v.timestampValue.match(/\.(\d+)Z$/)||[])[1]||'';return new Timestamp(Math.floor(ms/1000),Number(fraction.padEnd(9,'0')));}
    if('arrayValue'in v)return (v.arrayValue.values||[]).map(value);if('mapValue'in v)return decode(v.mapValue.fields||{},Timestamp);
    throw Error('Ungültiger Sicherungswert');
  }
  return Object.fromEntries(Object.entries(map).map(([key,v])=>[key,value(v)]));
}
function eligible(e,range){
  const start=e.start?.toMillis?.(),end=e.end?.toMillis?.();
  return ['use','day','fuel','backfill','takeover'].includes(e.type)&&e.status!=='pending'&&e.status!=='rejected'&&Number.isFinite(start)&&Number.isFinite(end)&&start>=range.start&&start<range.end&&end>=start&&end<=range.end;
}
function createVehicleExport({db,auth,Timestamp,ErrorType,now=Date.now}){
  const fail=(code,text)=>{throw new ErrorType(code,text);};
  const jobs=db.collection('fahrtenbuch_exporte');
  async function allowed(request,tx=null){
    if(!request.auth)fail('unauthenticated','Bitte anmelden.');const uid=request.auth.uid;
    const user=await auth.getUser(uid),ref=db.collection('account_deletions').doc(uid),access=db.collection('user_access').doc(uid);
    const deleted=await (tx?tx.get(ref):ref.get()),rights=await (tx?tx.get(access):access.get());
    if(user.disabled||deleted.exists||uid!==MASTER&&(rights.data()?.permissions?.fahrtenbuch!=='edit'||rights.data()?.permissions?.fahrtenbuchExport!=='edit'))fail('permission-denied','Kein Zugriff auf Export und Aufräumen.');
    return uid;
  }
  function refFor(data){if(!validId(data?.id))fail('invalid-argument','Ungültiger Export.');return jobs.doc(data.id);}
  function own(job,uid){if(!job||uid!==MASTER&&job.preparedBy!==uid)fail('permission-denied','Kein Zugriff auf diesen Export.');}
  function summary(doc){const j=doc.data();return {id:doc.id,from:j.from,to:j.to,vehicleLabel:j.vehicleLabel,count:j.count,visibleCount:j.visibleCount,deletable:j.deletable,parts:j.parts,status:j.status,digest:j.digest,createdAt:j.createdAt.toMillis(),nextDeletePart:j.nextDeletePart||0,nextRestorePart:j.nextRestorePart||0,deleted:j.deleted||0,skipped:j.skipped||0,restored:j.restored||0};}
  function records(part){const text=gunzipSync(Buffer.from(part.payload,'base64')).toString('utf8');if(digest(text)!==part.hash)fail('data-loss','Die Sicherung konnte nicht geprüft werden. Es wird nichts gelöscht.');return JSON.parse(text);}
  return {
    async list(request){const uid=await allowed(request);let query=jobs;if(uid!==MASTER)query=query.where('preparedBy','==',uid);const snapshot=await query.orderBy('createdAt','desc').limit(30).get();return {exports:snapshot.docs.filter(d=>d.data().status!=='preparing'&&d.data().status!=='failed').map(summary).sort((a,b)=>b.createdAt-a.createdAt)};},
    async prepare(request){
      const uid=await allowed(request),d=request.data||{},first=bounds(d.from),last=bounds(d.to);
      if(!first||!last||last.end<=first.start||last.end-first.start>367*86400000||d.vehicleId!=='all'&&!validId(d.vehicleId))fail('invalid-argument','Fahrzeug und Zeitraum von höchstens einem Jahr auswählen.');
      const range={start:first.start,end:last.end,instant:false};
      const [active,archive]=await Promise.all([db.collection('fahrzeuge').get(),db.collection('fahrzeuge_archiv').get()]);
      const vehicles=new Map([...archive.docs,...active.docs].map(doc=>[doc.id,{id:doc.id,...doc.data()}]));
      const selected=d.vehicleId==='all'?[...vehicles.values()]:[vehicles.get(d.vehicleId)].filter(Boolean);
      if(!selected.length)fail('not-found','Kein Fahrzeug gefunden.');
      const ref=jobs.doc(),job={from:d.from,to:d.to,range,vehicleLabel:d.vehicleId==='all'?'Alle Fahrzeuge':selected[0].name+' · '+selected[0].plate,preparedBy:uid,createdAt:Timestamp.fromMillis(now()),status:'preparing',count:0,visibleCount:0,deletable:0,parts:0,nextDeletePart:0,nextRestorePart:0,deleted:0,skipped:0,restored:0};
      await ref.create(job);let buffer=[],size=0,hashes=[];
      async function flush(){if(!buffer.length)return;const text=JSON.stringify(buffer),hash=digest(text);await ref.collection('teile').doc(String(job.parts)).create({payload:gzipSync(text).toString('base64'),hash,count:buffer.length,deletedPaths:[],restoredPaths:[]});hashes.push(hash);job.parts++;buffer=[];size=0;}
      async function add(doc,v){
        const e=doc.data();if(!matches(e,range,'all')&&e.type!=='takeover')return;
        if(e.type==='takeover'&&!(e.start?.toMillis?.()>=range.start&&e.start.toMillis()<range.end))return;
        if(++job.count>MAX_RECORDS)fail('resource-exhausted','Zu viele Einträge. Bitte einen kleineren Zeitraum oder ein einzelnes Fahrzeug wählen.');
        const record={path:doc.ref.path,version:version(doc),fields:fields(e),vehicleName:e.vehicleName||v.name,plate:e.plate||v.plate,visible:e.type!=='takeover',eligible:eligible(e,range)};
        const bytes=Buffer.byteLength(JSON.stringify(record));if(bytes>500000)fail('resource-exhausted','Ein Eintrag ist zu gross für die Sicherung.');
        if(buffer.length>=PAGE||size+bytes>500000)await flush();buffer.push(record);size+=bytes;
        if(record.visible)job.visibleCount++;if(record.eligible)job.deletable++;
      }
      try{
        for(const v of selected){
          const history=db.collection('fahrzeuge').doc(v.id).collection('verlauf');
          for(const base of [history.where('end','>=',Timestamp.fromMillis(range.start)).where('start','<',Timestamp.fromMillis(range.end)).orderBy('end').orderBy('start'),history.where('end','==',null).where('start','<',Timestamp.fromMillis(range.end)).orderBy('start')]){
            let cursor=null;while(true){let q=base.limit(PAGE);if(cursor)q=q.startAfter(cursor);const page=await q.get();for(const doc of page.docs)await add(doc,v);if(page.docs.length<PAGE)break;cursor=page.docs.at(-1);}
          }
        }
        await flush();job.digest=digest(hashes.join(':'));job.status='ready';await ref.set(job);return summary(await ref.get());
      }catch(error){await ref.update({status:'failed'});throw error;}
    },
    async read(request){
      const uid=await allowed(request),d=request.data||{},ref=refFor(d),snapshot=await ref.get();if(!snapshot.exists)fail('not-found','Export nicht gefunden.');const job=snapshot.data();own(job,uid);
      if(!['ready','deleting','deleted','restoring','restored'].includes(job.status)||!Number.isSafeInteger(d.part)||d.part<0||d.part>=job.parts)fail('invalid-argument','Ungültiger Sicherungsteil.');
      const part=await ref.collection('teile').doc(String(d.part)).get();if(!part.exists)fail('data-loss','Sicherungsteil fehlt.');return {records:records(part.data()),hash:part.data().hash};
    },
    async remove(request){
      await allowed(request);const d=request.data||{},ref=refFor(d);
      if(d.confirmed!==true||!Number.isSafeInteger(d.part)||d.part<0)fail('invalid-argument','Export zuerst speichern, prüfen und Löschung bestätigen.');
      return db.runTransaction(async tx=>{
        const uid=await allowed(request,tx);const snapshot=await tx.get(ref);if(!snapshot.exists)fail('not-found','Export nicht gefunden.');const job=snapshot.data();own(job,uid);
        if(d.digest!==job.digest||!['ready','deleting','deleted'].includes(job.status))fail('failed-precondition','Dieser Export ist nicht zum Löschen bereit.');
        if(d.part<job.nextDeletePart)return summary(snapshot);
        if(d.part!==job.nextDeletePart||d.part>=job.parts)fail('failed-precondition','Bitte die Löschung in der vorgesehenen Reihenfolge fortsetzen.');
        const partRef=ref.collection('teile').doc(String(d.part)),part=await tx.get(partRef);if(!part.exists)fail('data-loss','Sicherung fehlt. Es wird nichts gelöscht.');
        const saved=records(part.data()).filter(r=>r.eligible),live=[];
        const parents=new Map();for(const r of saved){const path=r.path.split('/').slice(0,2).join('/');if(!parents.has(path))parents.set(path,(await tx.get(db.doc(path))).data());live.push(await tx.get(db.doc(r.path)));}
        const paths=[];let skipped=0;
        for(let i=0;i<saved.length;i++){
          const r=saved[i],doc=live[i],parent=parents.get(r.path.split('/').slice(0,2).join('/'));
          if(!doc.exists||version(doc)!==r.version||!eligible(doc.data(),job.range)||parent?.active?.sessionId===doc.id){skipped++;continue;}
          tx.delete(doc.ref);paths.push(r.path);
        }
        const next=d.part+1,time=Timestamp.fromMillis(now());
        for(const [path,parent]of parents){if(parent&&paths.some(p=>p.startsWith(path+'/verlauf/')))tx.update(db.doc(path),{revision:(parent.revision||0)+1,updatedAt:time});}
        tx.update(partRef,{deletedPaths:paths});
        if(paths.length)tx.create(db.collection('fahrtenbuch_loeschungen').doc(d.id+'_'+d.part),{paths,exportId:d.id,part:d.part,createdAt:time,backupAppliedAt:null});
        tx.update(ref,{status:next===job.parts?'deleted':'deleting',nextDeletePart:next,deleted:(job.deleted||0)+paths.length,skipped:(job.skipped||0)+skipped});
        return {...summary(snapshot),status:next===job.parts?'deleted':'deleting',nextDeletePart:next,deleted:(job.deleted||0)+paths.length,skipped:(job.skipped||0)+skipped};
      });
    },
    async restore(request){
      await allowed(request);const d=request.data||{},ref=refFor(d);
      if(d.confirmed!==true||!Number.isSafeInteger(d.part)||d.part<0)fail('invalid-argument','Wiederherstellung bestätigen.');
      return db.runTransaction(async tx=>{
        const uid=await allowed(request,tx);const snapshot=await tx.get(ref);if(!snapshot.exists)fail('not-found','Export nicht gefunden.');const job=snapshot.data();own(job,uid);
        if(!['deleted','restoring','restored'].includes(job.status))fail('failed-precondition','Zuerst die Löschung abschliessen.');
        if(d.part<(job.nextRestorePart||0))return summary(snapshot);
        if(d.part!==(job.nextRestorePart||0)||d.part>=job.parts)fail('failed-precondition','Ungültige Reihenfolge.');
        const partRef=ref.collection('teile').doc(String(d.part)),part=await tx.get(partRef);if(!part.exists)fail('data-loss','Sicherungsteil fehlt.');
        const removed=new Set(part.data().deletedPaths),saved=records(part.data()).filter(r=>removed.has(r.path));
        const live=[];for(const r of saved)live.push(await tx.get(db.doc(r.path)));
        const paths=[],time=Timestamp.fromMillis(now());for(let i=0;i<saved.length;i++){if(live[i].exists)continue;tx.create(db.doc(saved[i].path),{...decode(saved[i].fields,Timestamp),updatedAt:time});paths.push(saved[i].path);}
        tx.update(partRef,{restoredPaths:paths});
        // Restored histories get updatedAt; the next incremental backup adds them again.
        tx.update(ref,{status:d.part+1===job.parts?'restored':'restoring',nextRestorePart:d.part+1,restored:(job.restored||0)+paths.length});
        return {...summary(snapshot),status:d.part+1===job.parts?'restored':'restoring',nextRestorePart:d.part+1,restored:(job.restored||0)+paths.length};
      });
    }
  };
}
module.exports={createVehicleExport,eligible,fields,decode};

