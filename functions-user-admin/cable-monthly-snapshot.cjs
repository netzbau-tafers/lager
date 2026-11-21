'use strict';
// Monatlicher Kabel-Report-Abschluss. Die Berechnung entspricht kabel-report.html.
// Vorläufige Zwischenstände vervollständigen, endgültige Abschlüsse nicht überschreiben.
const ZONE='Europe/Zurich';
const clock=new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'});
const round=value=>Math.round(Number(value||0)*100)/100;
function localParts(date){const p=Object.fromEntries(clock.formatToParts(date).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));return p;}
function previousMonth(now){
  const {year,month}=localParts(now);
  const d=new Date(Date.UTC(year,month-2,1));
  return {year:d.getUTCFullYear(),monthIndex:d.getUTCMonth()};
}
function sanitize(value,max=200){return String(value||'').replace(/[<>]/g,'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,' ').replace(/\r\n?/g,'\n').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim().slice(0,max);}
function parseNumber(value){const s=String(value||'').replace(/[^0-9,.-]/g,'').replace(/,/g,'.').trim();if(!s)return null;const n=Number(s);return Number.isFinite(n)?n:null;}
function detail(details,label){for(const part of String(details||'').split('|')){const clean=sanitize(part,500),prefix=label+':';if(clean.startsWith(prefix))return sanitize(clean.slice(prefix.length),200);}return '';}
function usedFromRechnung(details){for(const regex of [/Abschnittssumme:[^|]*?-\s*([0-9.,]+)\s*m\s*=\s*[0-9.,]+\s*m/i,/\|\s*=\s*([0-9.,]+)\s*m\s*=\s*[0-9.,]+\s*m/i]){const m=String(details||'').match(regex);if(m){const n=parseNumber(m[1]);if(n!==null)return round(n);}}return null;}
function entriesForMonth(logs,year,monthIndex){
  const state=new Map(),entries=[];
  // Firestore liefert bei identischem createdAt eine stabile Dokument-ID-Reihenfolge.
  logs.sort((a,b)=>a.createdAt.toMillis()-b.createdAt.toMillis()||a.id.localeCompare(b.id));
  for(const log of logs){
    if(String(log.bereich||'')!=='Kabellager')continue;
    const at=log.createdAt.toDate(),{year:logYear,month:logMonth}=localParts(at);
    const id=String(log.objektId||''),details=String(log.details||''),action=String(log.aktion||'');
    const current=state.get(id)||{typ:'Unbekannter Typ',nummer:'',inUseLength:null};
    current.typ=detail(details,'Typ')||current.typ;
    current.nummer=detail(details,'Nummer')||current.nummer;
    if(action==='Bobine auf In Gebrauch gesetzt'){
      current.inUseLength=parseNumber(detail(details,'Länge'));state.set(id,current);continue;
    }
    if(action==='Bobine erstellt'||action==='Bobine bearbeitet'){state.set(id,current);continue;}
    let meters=null,source='';
    if(action==='Bobine zurück ins Lager gebucht'){
      const remaining=parseNumber(detail(details,'Neue Länge'));
      // Rückbuchungen enthalten die ursprüngliche Länge und sind auch ohne ältere Logs auswertbar.
      const previous=parseNumber(detail(details,'Alte Länge'));
      const startLength=current.inUseLength!==null?current.inUseLength:previous;
      if(startLength!==null&&remaining!==null)meters=round(Math.max(0,startLength-remaining));
      if((meters===null||meters===0)&&details)meters=usedFromRechnung(details);
      current.inUseLength=null;state.set(id,current);source='Rückbuchung';
    }else if(action==='Bobine gelöscht'){
      meters=round(parseNumber(detail(details,'Länge'))||0);state.delete(id);source='Komplett gelöscht';
    }
    if(logYear===year&&logMonth===monthIndex+1&&meters!==null&&meters>0){
      entries.push({typ:current.typ||'Unbekannter Typ',nummer:current.nummer||'',meter:meters,source,month:monthIndex,timestamp:at.getTime()});
    }
  }
  return entries;
}
function payload(year,monthIndex,entries){
  const periodKey=year+'-'+String(monthIndex+1).padStart(2,'0'),grouped=new Map();
  let returns=0,deletes=0;
  const sourceKeys=new Set();
  for(const e of entries){
    const row=grouped.get(e.typ)||{typ:e.typ,meter:0,count:0,returnsCount:0,deletesCount:0};
    row.meter+=e.meter;row.count++;
    if(e.source==='Rückbuchung'){row.returnsCount++;returns++;}
    if(e.source==='Komplett gelöscht'){row.deletesCount++;deletes++;}
    grouped.set(e.typ,row);
    sourceKeys.add([sanitize(e.typ||'Unbekannter Typ',200)||'Unbekannter Typ',sanitize(e.nummer,200),round(e.meter),sanitize(e.source,100),e.month,e.timestamp].join('|'));
  }
  const rows=[...grouped.values()].map(x=>({...x,meter:round(x.meter)})).sort((a,b)=>b.meter-a.meter||a.typ.localeCompare(b.typ,'de',{sensitivity:'base'}));
  return {periodKey,year,month:monthIndex+1,monthIndex,status:'ready',rows,totalMeters:round(entries.reduce((s,e)=>s+e.meter,0)),totalBookings:entries.length,totalReturns:returns,totalDeletes:deletes,sourceLogCount:entries.length,sourceKeys:[...sourceKeys].sort()};
}
// Bereits archivierte Buchungen behalten; neue Ereignisse nur einmal übernehmen.
function mergeInterimSnapshot(existing,year,monthIndex,entries){
  const full=payload(year,monthIndex,entries);
  if(!existing)return full;
  const keys=new Set(Array.isArray(existing.sourceKeys)?existing.sourceKeys:[]);
  const generatedAt=existing.generatedAt||existing.updatedAt||existing.createdAt;
  const createdMillis=generatedAt&&typeof generatedAt.toMillis==='function'?generatedAt.toMillis():0;
  const onlyNew=entries.filter(e=>{
    const key=[sanitize(e.typ||'Unbekannter Typ',200)||'Unbekannter Typ',sanitize(e.nummer,200),round(e.meter),sanitize(e.source,100),e.month,e.timestamp].join('|');
    if(keys.has(key))return false;
    // Legacy snapshots without sourceKeys: use the original timestamp to avoid
    // re-adding the same historical events. Empty snapshots have no old rows.
    if(keys.size===0&&Array.isArray(existing.rows)&&existing.rows.length>0&&createdMillis&&e.timestamp<=createdMillis)return false;
    keys.add(key);return true;
  });
  if(keys.size===0&&(!existing.rows||existing.rows.length===0))return full;
  const grouped=new Map();
  for(const row of [...(Array.isArray(existing.rows)?existing.rows:[]),...payload(year,monthIndex,onlyNew).rows]){
    const previous=grouped.get(row.typ)||{typ:row.typ,meter:0,count:0,returnsCount:0,deletesCount:0};
    for(const field of ['meter','count','returnsCount','deletesCount'])previous[field]+=Number(row[field]||0);
    grouped.set(row.typ,previous);
  }
  const rows=[...grouped.values()].map(row=>({...row,meter:round(row.meter)}))
    .sort((a,b)=>b.meter-a.meter||a.typ.localeCompare(b.typ,'de',{sensitivity:'base'}));
  return {...full,rows,totalMeters:round(rows.reduce((sum,row)=>sum+row.meter,0)),
    totalBookings:rows.reduce((sum,row)=>sum+row.count,0),
    totalReturns:rows.reduce((sum,row)=>sum+row.returnsCount,0),
    totalDeletes:rows.reduce((sum,row)=>sum+row.deletesCount,0),
    sourceLogCount:keys.size,sourceKeys:[...keys].sort()};
}

const LOG_RETENTION_DAYS=60;
const LOG_DELETE_BATCH_SIZE=400;
// Nur der automatische Monatsabschluss ruft diese Bereinigung auf.
// Kabel-Logs werden erst entfernt, wenn ihr Kalendermonat endgültig gesichert ist.
async function deleteOldLogsAfterAutomaticSnapshot({db,Timestamp,logger,now}){
  const cutoff=new Date(now.getTime()-LOG_RETENTION_DAYS*24*60*60*1000);
  const cutoffTimestamp=Timestamp.fromDate(cutoff);
  const snapshots=new Map();
  const result={cutoff:cutoff.toISOString(),scanned:0,deleted:0,protected:0};
  let cursor=null;
  for(;;){
    let query=db.collection('logs').where('createdAt','<',cutoffTimestamp)
      .orderBy('createdAt').orderBy('__name__').limit(LOG_DELETE_BATCH_SIZE);
    if(cursor)query=query.startAfter(cursor);
    const page=await query.get();
    if(page.empty||page.docs.length===0)break;
    const batch=db.batch();
    let batchCount=0;
    for(const doc of page.docs){
      const log=doc.data(),createdAt=log.createdAt;
      if(!createdAt||typeof createdAt.toDate!=='function'||createdAt.toDate()>=cutoff)continue;
      result.scanned++;
      if(String(log.bereich||'')==='Kabellager'){
        const {year,month}=localParts(createdAt.toDate());
        const key=year+'-'+String(month).padStart(2,'0');
        if(!snapshots.has(key)){
          const snapshot=await db.collection('kabel_report_snapshots').doc(key).get();
          snapshots.set(key,snapshot.exists&&snapshot.data().status==='ready'&&snapshot.data().finalized===true);
        }
        if(!snapshots.get(key)){
          result.protected++;
          continue;
        }
      }
      batch.delete(doc.ref);
      batchCount++;
    }
    if(batchCount){
      await batch.commit();
      result.deleted+=batchCount;
    }
    cursor=page.docs[page.docs.length-1];
    if(page.docs.length<LOG_DELETE_BATCH_SIZE)break;
  }
  logger.info('Automatische Log-Bereinigung nach Monatsabschluss',result);
  return result;
}

function createMonthlyCableSnapshot({db,Timestamp,FieldValue,logger,now=()=>new Date()}){
  return async function run(){
    const {year,monthIndex}=previousMonth(now()),key=year+'-'+String(monthIndex+1).padStart(2,'0');
    const ref=db.collection('kabel_report_snapshots').doc(key);
    const initial=await ref.get();
    if(initial.exists&&initial.data().finalized===true){
      logger.info('Kabel-Monat bereits abgeschlossen',{key});
      const cleanup=await deleteOldLogsAfterAutomaticSnapshot({db,Timestamp,logger,now:now()});
      return {key,status:'finalized',cleanup};
    }
    // Das Frontend verarbeitet ebenfalls alle Protokolle des betreffenden Kalenderjahres.
    // Plus ein UTC-Puffertag je Grenze, damit die Schweizer Ortszeit korrekt bleibt.
    const from=Timestamp.fromDate(new Date(Date.UTC(year,0,1)-86400000));
    const to=Timestamp.fromDate(new Date(Date.UTC(year+1,0,1)+86400000));
    const logs=[];
    let cursor=null;
    for(;;){
      let query=db.collection('logs').where('createdAt','>=',from).where('createdAt','<',to).orderBy('createdAt').orderBy('__name__').limit(500);
      if(cursor)query=query.startAfter(cursor);
      const page=await query.get();
      for(const doc of page.docs){const data=doc.data();if(data.createdAt&&typeof data.createdAt.toMillis==='function')logs.push({id:doc.id,...data});}
      if(page.size<500)break;
      cursor=page.docs[page.docs.length-1];
    }
    const entries=entriesForMonth(logs,year,monthIndex);
    // In der Transaktion erneut prüfen: parallele manuelle Speicherungen oder
    // Scheduler-Retries dürfen den Abschluss nicht überschreiben.
    const result=await db.runTransaction(async transaction=>{
      const current=await transaction.get(ref);
      if(current.exists&&current.data().finalized===true)return {key,status:'finalized'};
      const data=mergeInterimSnapshot(current.exists?current.data():null,year,monthIndex,entries);
      transaction.set(ref,{...data,finalized:true,interim:false,
        finalizedAt:FieldValue.serverTimestamp(),generatedAt:FieldValue.serverTimestamp(),
        generatedByUid:'',generatedByEmail:'',generatedAutomatically:true});
      return {key,status:'created',meters:data.totalMeters,bookings:data.totalBookings};
    });
    // Erst nach bestätigtem Abschluss bereinigen – niemals bei manuellen Snapshots.
    const cleanup=await deleteOldLogsAfterAutomaticSnapshot({db,Timestamp,logger,now:now()});
    logger.info('Kabel-Monatsabschluss',{...result,logs:logs.length,cleanup});
    return {...result,cleanup};
  };
}
module.exports={createMonthlyCableSnapshot,previousMonth,entriesForMonth,payload,mergeInterimSnapshot,deleteOldLogsAfterAutomaticSnapshot};
