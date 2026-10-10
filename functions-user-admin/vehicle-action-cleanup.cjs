'use strict';
const RETENTION_MS=7*24*60*60*1000;
const PAGE_SIZE=400,MAX_PAGES=25;
// Query only expired receipts, never the usage/fuel history or current vehicle state.
function createVehicleActionCleanup({db,Timestamp,logger,now=Date.now}){
  return async function cleanup(){
    const cutoff=Timestamp.fromMillis(now()-RETENTION_MS);
    let cursor=null,deleted=0,scanned=0,pages=0,complete=false;
    for(;pages<MAX_PAGES;pages++){
      let query=db.collectionGroup('aktionen').where('createdAt','<',cutoff).orderBy('createdAt','asc').limit(PAGE_SIZE);
      if(cursor)query=query.startAfter(cursor);
      const snapshot=await query.get();
      if(snapshot.empty){complete=true;break;}
      const batch=db.batch();let count=0;
      for(const doc of snapshot.docs){
        scanned++;
        // Collection-group names may be reused: protect every other document path.
        if(!/^fahrzeuge\/[^/]+\/aktionen\/[^/]+$/.test(doc.ref.path))continue;
        const createdAt=doc.data().createdAt;
        if(typeof createdAt?.toMillis!=='function'||createdAt.toMillis()>=cutoff.toMillis())continue;
        batch.delete(doc.ref);count++;
      }
      if(count){await batch.commit();deleted+=count;}
      cursor=snapshot.docs.at(-1);
      if(snapshot.docs.length<PAGE_SIZE){complete=true;break;}
    }
    logger.info('Alte Fahrzeugaktionen bereinigt',{deleted,scanned,complete});
    // Bounded work per invocation; any remaining backlog is processed next day.
    if(!complete)logger.warn('Fahrzeugaktionen: weitere Bereinigung beim nächsten Lauf erforderlich.');
    return {deleted,scanned,complete};
  };
}
module.exports={createVehicleActionCleanup,RETENTION_MS};
