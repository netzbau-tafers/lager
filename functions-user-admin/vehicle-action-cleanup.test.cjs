'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createVehicleActionCleanup,RETENTION_MS}=require('./vehicle-action-cleanup.cjs');
const ms=Date.parse('2026-10-10T01:15:00Z');
const timestamp=value=>({toMillis:()=>value});
function fixture(rows,fail=false){
  const data=new Map(rows),queries=[],commits=[];
  const db={collectionGroup(name){
    assert.equal(name,'aktionen');let cursor=null,cutoff,size;
    const q={where(field,operator,value){assert.equal(field,'createdAt');assert.equal(operator,'<');cutoff=value.toMillis();return q;},orderBy(field,order){assert.equal(field,'createdAt');assert.equal(order,'asc');return q;},limit(value){size=value;return q;},startAfter(value){cursor=value;return q;},async get(){
      queries.push({cutoff,size});
      const docs=[...data].filter(([path,row])=>path.split('/').at(-2)==='aktionen'&&typeof row.createdAt?.toMillis==='function'&&row.createdAt.toMillis()<cutoff).map(([path,row])=>({ref:{path},data:()=>row})).sort((a,b)=>a.data().createdAt.toMillis()-b.data().createdAt.toMillis()||a.ref.path.localeCompare(b.ref.path));
      const after=cursor?docs.filter(doc=>doc.data().createdAt.toMillis()>cursor.data().createdAt.toMillis()||(doc.data().createdAt.toMillis()===cursor.data().createdAt.toMillis()&&doc.ref.path.localeCompare(cursor.ref.path)>0)):docs;
      return {docs:after.slice(0,size),empty:!after.length};
    }};return q;
  },batch(){const paths=[];return {delete(ref){paths.push(ref.path);},async commit(){if(fail)throw Error('write failure');assert(paths.length<=400);commits.push(paths);for(const path of paths)data.delete(path);}};}};
  const cleanup=createVehicleActionCleanup({db,Timestamp:{fromMillis:timestamp},logger:{info(){},warn(){}},now:()=>ms});
  return {data,queries,commits,cleanup};
}
test('deletes only vehicle receipts older than seven days, including deleted vehicles',async()=>{
  const old={createdAt:timestamp(ms-RETENTION_MS-1)};
  const f=fixture([
    ['fahrzeuge/bus/aktionen/old',old],['fahrzeuge/deleted/aktionen/old',old],
    ['fahrzeuge/bus/aktionen/boundary',{createdAt:timestamp(ms-RETENTION_MS)}],
    ['fahrzeuge/bus/aktionen/recent',{createdAt:timestamp(ms-1000)}],
    ['fahrzeuge/bus/aktionen/missing',{}],['other/item/aktionen/old',old],
    ['fahrzeuge/bus/verlauf/old',old],['fahrzeuge/bus',old],['fahrzeug_nutzung/user',old]
  ]);
  assert.equal((await f.cleanup()).deleted,2);assert.equal(f.data.size,7);assert.equal((await f.cleanup()).deleted,0);
});
test('paginates more than one batch without skipping tied timestamps',async()=>{
  const f=fixture(Array.from({length:805},(_,i)=>['fahrzeuge/bus/aktionen/'+String(i).padStart(4,'0'),{createdAt:timestamp(ms-RETENTION_MS-1)}]));
  assert.deepEqual(await f.cleanup(),{deleted:805,scanned:805,complete:true});assert.deepEqual(f.commits.map(paths=>paths.length),[400,400,5]);assert.equal(f.data.size,0);
});
test('does not swallow write failures; retry can delete pending receipts',async()=>{
  const f=fixture([['fahrzeuge/bus/aktionen/old',{createdAt:timestamp(ms-RETENTION_MS-1)}]],true);
  await assert.rejects(f.cleanup(),/write failure/);assert.equal(f.data.size,1);
});
