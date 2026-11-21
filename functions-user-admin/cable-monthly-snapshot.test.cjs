'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {previousMonth,payload,mergeInterimSnapshot,createMonthlyCableSnapshot,deleteOldLogsAfterAutomaticSnapshot,entriesForMonth}=require('./cable-monthly-snapshot.cjs');
const at=(iso)=>({toDate:()=>new Date(iso),toMillis:()=>Date.parse(iso)});
const e=(meter,timestamp)=>({typ:'GKN',nummer:'42',meter,source:'Rückbuchung',month:10,timestamp});
test('December closes under previous year in January',()=>{
  assert.deepEqual(previousMonth(new Date('2027-01-01T02:30:00Z')),{year:2026,monthIndex:11});
});
test('existing interim entries are counted once and later events added',()=>{
  const first=e(5000,Date.parse('2026-11-10T09:00:00Z'));
  const later=e(2000,Date.parse('2026-11-20T09:00:00Z'));
  const interim={...payload(2026,10,[first]),finalized:false};
  const merged=mergeInterimSnapshot(interim,2026,10,[first,later]);
  assert.equal(merged.totalMeters,7000);
  assert.equal(merged.totalBookings,2);
  assert.equal(merged.sourceKeys.length,2);
});
test('automatic close finalizes an interim snapshot and skips a second run',async()=>{
  const first=e(5000,Date.parse('2026-11-10T09:00:00Z'));
  const later=e(2000,Date.parse('2026-11-20T09:00:00Z'));
  const docs=new Map([['2026-11',{...payload(2026,10,[first]),finalized:false}]]);
  const events=[
    {id:'a',bereich:'Kabellager',objektId:'b1',aktion:'Bobine auf In Gebrauch gesetzt',details:'Typ: GKN | Nummer: 42 | Länge: 7000',createdAt:at('2026-11-10T08:00:00Z')},
    {id:'b',bereich:'Kabellager',objektId:'b1',aktion:'Bobine zurück ins Lager gebucht',details:'Typ: GKN | Nummer: 42 | Neue Länge: 2000',createdAt:at('2026-11-10T09:00:00Z')},
    {id:'c',bereich:'Kabellager',objektId:'b2',aktion:'Bobine auf In Gebrauch gesetzt',details:'Typ: GKN | Nummer: 42 | Länge: 3000',createdAt:at('2026-11-20T08:00:00Z')},
    {id:'d',bereich:'Kabellager',objektId:'b2',aktion:'Bobine zurück ins Lager gebucht',details:'Typ: GKN | Nummer: 42 | Neue Länge: 1000',createdAt:at('2026-11-20T09:00:00Z')}
  ];
  const db={
    collection(name){
      if(name==='kabel_report_snapshots')return {doc:key=>({key,get:async()=>({exists:docs.has(key),data:()=>docs.get(key)})})};
      return {where(){return this;},orderBy(){return this;},limit(){return this;},get:async()=>({size:events.length,docs:events.map(x=>({id:x.id,data:()=>x}))})};
    },
    async runTransaction(cb){
      const transaction={
        get:async ref=>({exists:docs.has(ref.key),data:()=>docs.get(ref.key)}),
        set:(ref,value)=>docs.set(ref.key,value)
      };
      return cb(transaction);
    }
  };
  const handler=createMonthlyCableSnapshot({db,Timestamp:{fromDate:x=>x},FieldValue:{serverTimestamp:()=>at('2026-12-01T02:30:00Z')},logger:{info(){}},now:()=>new Date('2026-12-01T02:30:00Z')});
  assert.equal((await handler()).status,'created');
  assert.equal(docs.get('2026-11').totalMeters,7000);
  assert.equal(docs.get('2026-11').finalized,true);
  assert.equal((await handler()).status,'finalized');
  assert.equal(docs.get('2026-11').totalMeters,7000);
});

test('Rueckbuchung mit alter Laenge bleibt ohne Log aus dem Vormonat berechenbar',()=>{
  const entries=entriesForMonth([{
    id:'return',bereich:'Kabellager',objektId:'b-long',aktion:'Bobine zurück ins Lager gebucht',
    details:'Typ: GKN | Nummer: 88 | Neue Länge: 2000 | Alte Länge: 6000',
    createdAt:at('2026-11-19T10:00:00Z')
  }],2026,10);
  assert.equal(entries.length,1);
  assert.equal(entries[0].meter,4000);
});
test('Bereinigung loescht nur alte Logs und schont Kabellager ohne finalisierten Monatsabschluss',async()=>{
  const september={status:'ready',finalized:true};
  const snap=new Map([['2026-09',september],['2026-08',{status:'ready',finalized:false}]]);
  const logs=[
    {id:'closed',bereich:'Kabellager',createdAt:at('2026-09-01T11:00:00Z')},
    {id:'open',bereich:'Kabellager',createdAt:at('2026-08-02T11:00:00Z')},
    {id:'other',bereich:'Baustellenmaterial',createdAt:at('2026-09-02T11:00:00Z')},
    {id:'fresh',bereich:'Kabellager',createdAt:at('2026-11-20T11:00:00Z')}
  ];
  const deleted=[];
  const db={
    collection(name){
      if(name==='kabel_report_snapshots')return {doc:key=>({
        get:async()=>({exists:snap.has(key),data:()=>snap.get(key)})
      })};
      assert.equal(name,'logs');
      return {
        where(){return this;},orderBy(){return this;},limit(){return this;},
        get:async()=>({docs:logs.map(log=>({id:log.id,ref:{id:log.id},data:()=>log}))})
      };
    },
    batch(){return {delete(ref){deleted.push(ref.id);},async commit(){}};}
  };
  const cleanup=await deleteOldLogsAfterAutomaticSnapshot({
    db,Timestamp:{fromDate:d=>d},logger:{info(){}},now:new Date('2026-11-21T11:37:00Z')
  });
  assert.deepEqual(deleted.sort(),['closed','other']);
  assert.equal(cleanup.protected,1);
  assert.equal(cleanup.deleted,2);
});
