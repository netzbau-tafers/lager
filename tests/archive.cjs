'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createArchive}=require('../functions-user-admin/archive.cjs');
const MASTER='pmyu29TlC3QM7JIysmy2EmiHSWW2';
class Failure extends Error{constructor(code,message){super(message);this.code=code;}}
function setup({status='beendet',count=2,permissions={baustellen:'edit',beendete:'edit'},collision=false,deleted=false,disabled=false,failCommit=false}={}){
 const records=new Map([['baustellen/site',{status,name:'Test',nummer:'1',custom:42}],['user_access/u',{permissions}]]);
 if(deleted)records.set('account_deletions/u',{});
 for(let i=0;i<count;i++)records.set('baustellen_material/m'+i,{baustelleId:'site',menge:i+1,spontis:'123'});
 if(collision)records.set('baustellen_material_archiv/m0',{baustelleId:'other'});
 let auto=0;
 const ref=(collection,id)=>({path:collection+'/'+id,id});
 const db={collection:name=>({doc:id=>ref(name,id||'auto'+ ++auto),where:(field,op,value)=>({collection:name,field,value})}),runTransaction:async callback=>{
   const writes=[];let writing=false;
   const tx={get:async r=>{assert.equal(writing,false,'All reads precede writes');
     if(r.collection){const docs=[...records].filter(([p,v])=>p.startsWith(r.collection+'/')&&v[r.field]===r.value).map(([p,v])=>({id:p.split('/')[1],ref:{path:p},data:()=>structuredClone(v)}));return {docs,size:docs.length};}
     const v=records.get(r.path);return {exists:records.has(r.path),data:()=>structuredClone(v)};
   },set:(r,v)=>{writing=true;writes.push(['set',r.path,v]);},delete:r=>{writing=true;writes.push(['delete',r.path]);}};
   const result=await callback(tx);if(failCommit)throw new Error('commit failed');
   for(const [op,path,v]of writes){if(op==='set')records.set(path,v);else records.delete(path);}return result;
 }};
 return {records,move:createArchive({db,auth:{getUser:async()=>({email:'test@example.com',disabled})},timestamp:()=>99,ErrorType:Failure})};
}
const req={auth:{uid:'u'},data:{id:'site'}};
test('moves all fields and stable IDs, removes originals, writes compatible log',async()=>{
 const {records,move}=setup();await move(req);
 assert.equal(records.has('baustellen/site'),false);assert.equal(records.has('baustellen_material/m0'),false);
 assert.deepEqual(records.get('baustellen_archiv/site'),{status:'archiviert',name:'Test',nummer:'1',custom:42,archiviertAm:99});
 assert.deepEqual(records.get('baustellen_material_archiv/m1'),{baustelleId:'site',menge:2,spontis:'123'});
 assert.equal(records.get('logs/auto1').benutzerUid,'u');assert.equal(records.get('logs/auto1').createdAt,99);
 await move(req);assert.equal([...records.keys()].filter(k=>k.startsWith('logs/')).length,1);
});
for(const [name,options,code]of [
 ['active',{status:'aktiv'},'failed-precondition'],['no finished right',{permissions:{baustellen:'edit',beendete:'none'}},'permission-denied'],
 ['read only',{permissions:{baustellen:'view',beendete:'edit'}},'permission-denied'],['deleted',{deleted:true},'permission-denied'],
 ['disabled',{disabled:true},'permission-denied'],['collision',{collision:true},'already-exists'],['too large',{count:249},'resource-exhausted'],
 ['legacy archive requires master',{status:'archiviert'},'failed-precondition']]){
 test(name+' leaves originals untouched',async()=>{const {records,move}=setup(options);const before=structuredClone(records);await assert.rejects(move(req),e=>e.code===code);assert.deepEqual(records,before);});
}
test('commit failure leaves originals untouched',async()=>{const {records,move}=setup({failCommit:true});const before=structuredClone(records);await assert.rejects(move(req));assert.deepEqual(records,before);});
test('master migrates legacy archive and preserves date',async()=>{const {records,move}=setup({status:'archiviert'});records.get('baustellen/site').archiviertAm=12;await move({auth:{uid:MASTER},data:{id:'site'}});assert.equal(records.get('baustellen_archiv/site').archiviertAm,12);});
test('248 positions succeed within 499 writes',async()=>{const {records,move}=setup({count:248});await move(req);assert.equal([...records.keys()].filter(k=>k.startsWith('baustellen_material_archiv/')).length,248);});
test('authentication and invalid IDs rejected',async()=>{const {move}=setup();await assert.rejects(move({data:{id:'site'}}),e=>e.code==='unauthenticated');await assert.rejects(move({...req,data:{id:'x/y'}}),e=>e.code==='invalid-argument');});
