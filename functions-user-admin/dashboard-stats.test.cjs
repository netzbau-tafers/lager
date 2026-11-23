'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {calculateDashboard,createDashboardGet,swissYear}=require('./dashboard-stats.cjs');

function fixture(){
  const state={reads:0,writes:0,document:null,where:[]};
  const Timestamp={fromDate(date){return {toMillis:()=>date.getTime(),toDate:()=>date};}};
  const snapshots=[
    {status:'ready',year:2026,month:1,totalMeters:1500.5,totalBookings:3,finalized:true,rows:[{typ:'XKDT',meter:1200.5},{typ:'GKN',meter:300}]},
    {status:'ready',year:2026,month:2,totalMeters:2500,totalBookings:5,finalized:true,rows:[{typ:'XKDT',meter:500},{typ:'GKN',meter:2000}]},
    {status:'in-progress',year:2026,month:3,totalMeters:5000,totalBookings:2,rows:[]}
  ];
  const db={
    collection(name){
      if(name==='dashboard_stats')return {doc(){
        return {
          async get(){state.reads++;return state.document?{exists:true,data:()=>state.document}:{exists:false};},
          async set(data){state.writes++;state.document=data;}
        };
      }};
      if(name==='kabel_report_snapshots')return {where(field,op,value){
        assert.equal(field,'year');assert.equal(op,'==');assert.equal(value,2026);
        return {async get(){state.reads++;return {forEach(fn){snapshots.forEach((x,i)=>fn({id:String(i),data:()=>x}));}};}};
      }};
      if(name==='logs')return {where(){return {
        where(){return this;},orderBy(){return this;},limit(){return this;},startAfter(){return this;},
        async get(){state.reads++;return {docs:[],size:0};}
      };}};
      if(name==='baustellen')return {where(field,op,value){
        state.where.push({field,op,value});
        return {
          where(){return this;},
          count(){return {async get(){state.reads++;return {data:()=>({count:field==='status'?4:12})};}};}
        };
      }};
      throw Error('unexpected collection: '+name);
    }
  };
  return {state,db,Timestamp};
}

test('calculates totals, records and cable types only from ready snapshots',async()=>{
  const {db,Timestamp}=fixture();
  const output=await calculateDashboard({db,Timestamp,year:2026,now:new Date('2026-11-21T13:00:00Z')});
  assert.equal(output.totalMeters,4000.5);
  assert.equal(output.bookings,8);
  assert.equal(output.archivedSites,12);
  assert.equal(output.activeSites,4);
  assert.equal(output.totalSites,16);
  assert.equal(output.recordMonth,2);
  assert.equal(output.recordMeters,2500);
  assert.equal(output.topType,'GKN');
  assert.equal(output.topTypeMeters,2300);
  assert.equal(output.lastClosedMonth,2);
  assert.equal(output.monthlyMeters.length,12);
  assert.equal(output.monthlyMeters[2],0);
});

test('shared result is reused for 12 hours without scanning snapshots again',async()=>{
  const {db,Timestamp,state}=fixture();
  let clock=new Date('2026-11-21T13:00:00Z');
  const callback=createDashboardGet({db,Timestamp,logger:{info(){}},now:()=>clock});
  const first=await callback({auth:{uid:'test'}});
  assert.equal(first.year,2026);
  assert.equal(state.writes,1);
  const initialReads=state.reads;
  clock=new Date('2026-11-21T14:00:00Z');
  const second=await callback({auth:{uid:'test'}});
  assert.deepEqual(first,second);
  assert.equal(state.reads,initialReads+1);
  assert.equal(state.writes,1);
});

test('Swiss year changes on December 31 at 23:00 UTC',()=>{
  assert.equal(swissYear(new Date('2026-12-31T22:59:59Z')),2026);
  assert.equal(swissYear(new Date('2026-12-31T23:00:00Z')),2027);
});

test('invalidated cache is recalculated before twelve hours',async()=>{
  const {db,Timestamp,state}=fixture();
  let clock=new Date('2026-11-21T13:00:00Z');
  const callback=createDashboardGet({db,Timestamp,logger:{info(){}},now:()=>clock});
  await callback({auth:{uid:'test'}});
  state.document.invalidatedAt=Timestamp.fromDate(new Date('2026-11-21T13:30:00Z'));
  clock=new Date('2026-11-21T14:00:00Z');
  await callback({auth:{uid:'test'}});
  assert.equal(state.writes,2);
});
