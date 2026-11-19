'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {previousMonth,payload,mergeInterimSnapshot,createMonthlyCableSnapshot}=require('./cable-monthly-snapshot.cjs');
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
