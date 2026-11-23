'use strict';
// Ereignisgesteuerte Jahresübersicht: Neuberechnung nur bei Änderungen der Quelldaten.
const MONTHS=12;
const SHARED_CACHE_MS=12*60*60*1000;
const DASHBOARD_SCHEMA_VERSION=2;
const {entriesForMonth,mergeInterimSnapshot}=require('./cable-monthly-snapshot.cjs');

function swissYear(date){
  return Number(new Intl.DateTimeFormat('en',{timeZone:'Europe/Zurich',year:'numeric'}).format(date));
}
function yearStart(year,Timestamp){
  // Der 1. Januar um 00:00 Uhr ist in der Schweiz immer CET (UTC+1).
  return Timestamp.fromDate(new Date(Date.UTC(year,0,1)-60*60*1000));
}
const safeNum=value=>{
  const n=Number(value);
  return Number.isFinite(n)?Math.max(0,n):0;
};
const round=value=>Math.round(value*100)/100;

async function calculateDashboard({db,Timestamp,year,now}){
  // Monats-Snapshots sind bereits die Datenquelle des Kabelreports.
  const [snapshotDocs,archivedCount,activeCount]=await Promise.all([
    db.collection('kabel_report_snapshots').where('year','==',year).get(),
    db.collection('baustellen')
      .where('archiviertAm','>=',yearStart(year,Timestamp))
      .where('archiviertAm','<',yearStart(year+1,Timestamp)).count().get(),
    db.collection('baustellen').where('status','==','aktiv').count().get()
  ]);

  const monthlyMeters=Array(MONTHS).fill(0);
  const snapshotsByMonth=new Map();
  const byType=new Map();
  let bookings=0;
  let lastClosedMonth=0;
  snapshotDocs.forEach(doc=>{
    const data=doc.data()||{};
    if(data.status!=='ready')return;
    const month=Number(data.month||Number(data.monthIndex)+1);
    if(!Number.isInteger(month)||month<1||month>12)return;
    snapshotsByMonth.set(month,data);
    monthlyMeters[month-1]=round(safeNum(data.totalMeters));
    bookings+=safeNum(data.totalBookings);
    if(data.finalized===true)lastClosedMonth=Math.max(lastClosedMonth,month);
    for(const row of Array.isArray(data.rows)?data.rows:[]){
      const type=String(row.typ||'').trim();
      if(type)byType.set(type,round((byType.get(type)||0)+safeNum(row.meter)));
    }
  });
  // Gleich wie im Kabelreport: Alle noch nicht finalisierten Monate ergänzen.
  // Sonst fehlen z.B. Oktober-Buchungen, wenn der Oktober-Snapshot vorläufig ist.
  const currentMonth=Number(new Intl.DateTimeFormat('en',{timeZone:'Europe/Zurich',month:'numeric'}).format(now));
  for(let month=1;month<=currentMonth;month++){
    const saved=snapshotsByMonth.get(month);
    if(saved?.finalized===true)continue;
    const from=Timestamp.fromDate(new Date(Date.UTC(year,month-1,1)-86400000));
    const to=Timestamp.fromDate(new Date(Date.UTC(year,month,1)+86400000));
    const liveLogs=[];
    let cursor=null;
    for(;;){
      let query=db.collection('logs').where('createdAt','>=',from).where('createdAt','<',to)
        .orderBy('createdAt').orderBy('__name__').limit(500);
      if(cursor)query=query.startAfter(cursor);
      const page=await query.get();
      for(const doc of page.docs){
        const data=doc.data();
        if(data.createdAt&&typeof data.createdAt.toMillis==='function'&&data.bereich==='Kabellager')liveLogs.push({id:doc.id,...data});
      }
      if(page.size<500)break;
      cursor=page.docs[page.docs.length-1];
    }
    const entries=entriesForMonth(liveLogs,year,month-1);
    const interim=mergeInterimSnapshot(saved||null,year,month-1,entries);
    monthlyMeters[month-1]=round(safeNum(interim.totalMeters));
    bookings+=safeNum(interim.totalBookings)-safeNum(saved?.totalBookings);
    for(const row of Array.isArray(saved?.rows)?saved.rows:[]){
      const type=String(row.typ||'').trim();
      if(type)byType.set(type,round((byType.get(type)||0)-safeNum(row.meter)));
    }
    for(const row of interim.rows){
      const type=String(row.typ||'').trim();
      if(type)byType.set(type,round((byType.get(type)||0)+safeNum(row.meter)));
    }
  }
  const totalMeters=round(monthlyMeters.reduce((sum,n)=>sum+n,0));
  let recordMonth=0;
  for(let i=0;i<MONTHS;i++){
    if(monthlyMeters[i]>0&&(!recordMonth||monthlyMeters[i]>monthlyMeters[recordMonth-1]))recordMonth=i+1;
  }
  const topType=[...byType].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'de'))[0]||null;
  const archivedSites=safeNum(archivedCount.data().count);
  const activeSites=safeNum(activeCount.data().count);

  return {
    year,totalMeters,bookings,monthlyMeters,
    archivedSites,activeSites,totalSites:archivedSites+activeSites,
    recordMonth,recordMeters:recordMonth?monthlyMeters[recordMonth-1]:0,
    topType:topType?topType[0]:'',topTypeMeters:topType?topType[1]:0,
    lastClosedMonth,updatedAt:now.toISOString()
  };
}

function createDashboardGet({db,Timestamp,logger,now=()=>new Date()}){
  return async function getDashboard(request){
    if(!request.auth)throw new Error('unauthenticated');
    const at=now(),year=swissYear(at);
    const ref=db.collection('dashboard_stats').doc(String(year));
    const previous=await ref.get();
    if(previous.exists){
      const data=previous.data()||{};
      const lastUpdate=data.calculatedAt&&typeof data.calculatedAt.toMillis==='function'
        ?data.calculatedAt.toMillis():0;
      const invalidatedAt=data.invalidatedAt&&typeof data.invalidatedAt.toMillis==='function'?data.invalidatedAt.toMillis():0;
      if(data.schemaVersion===DASHBOARD_SCHEMA_VERSION&&lastUpdate>0&&at.getTime()-lastUpdate<SHARED_CACHE_MS&&lastUpdate>=invalidatedAt){
        const {calculatedAt,invalidatedAt,...payload}=data;
        return payload;
      }
    }
    const payload=await calculateDashboard({db,Timestamp,year,now:at});
    await ref.set({...payload,schemaVersion:DASHBOARD_SCHEMA_VERSION,calculatedAt:Timestamp.fromDate(at)},{merge:true});
    logger.info('Jahres-Dashboard erneuert',{year,monthsWithMeters:payload.monthlyMeters.filter(Boolean).length});
    return payload;
  };
}

module.exports={createDashboardGet,calculateDashboard,swissYear};
