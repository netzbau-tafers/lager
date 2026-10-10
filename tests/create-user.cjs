'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createService,MASTER}=require('../functions-user-admin/service.cjs');
class ApiError extends Error{constructor(code,message){super(message);this.code=code;}}
const permissions=Object.fromEntries(['kabellager','baustellen','archiv','kabelreport','logs','spiel','materialvorlagen','beendete'].map(key=>[key,'none']));
function fixture({batchFail=false,duplicate=false,linkFail=false,cleanupFail=false}={}){
 const events=[],records=new Map();let created;
 const auth={getUser:async()=>({disabled:false}),createUser:async data=>{events.push('create');if(duplicate)throw Object.assign(Error(),{code:'auth/email-already-exists'});created=data;return {uid:'new',email:data.email};},updateUser:async(_uid,data)=>{assert(records.has('user_access/new'));events.push('enable');created.disabled=data.disabled;},deleteUser:async()=>{events.push('delete');if(cleanupFail)throw Error('failure');},generatePasswordResetLink:async()=>{events.push('link');if(linkFail)throw Error();return 'https://example.test/reset';}};
 const db={collection:name=>({doc:uid=>({path:name+'/'+uid})}),batch:()=>{const changes=[];return {set:(ref,data)=>changes.push(['set',ref.path,data]),delete:ref=>changes.push(['delete',ref.path]),commit:async()=>{events.push('batch');if(batchFail)throw Error('failed');for(const [op,path,data]of changes)op==='set'?records.set(path,data):records.delete(path);}}}};
 return {service:createService({auth,db,timestamp:()=>123,ErrorType:ApiError}),events,records,created:()=>created,request:{auth:{uid:MASTER},data:{email:'new@example.com',username:'Neu',permissions}}};
}
test('creation requires master before any changes',async()=>{const f=fixture();for(const auth of [undefined,{uid:'worker'}])await assert.rejects(f.service.create({...f.request,auth}));assert.deepEqual(f.events,[]);});
test('invalid and excessive permissions are rejected',async()=>{const f=fixture();for(const data of [{...f.request.data,email:'bad'},{...f.request.data,username:'<bad>'},{...f.request.data,permissions:{...permissions,extra:'edit'}},{...f.request.data,permissions:{...permissions,beendete:'view'}}])await assert.rejects(f.service.create({...f.request,data}),e=>e.code==='invalid-argument');assert.deepEqual(f.events,[]);});
test('rights and profile exist before enabling; random password is never returned or stored',async()=>{const f=fixture(),result=await f.service.create(f.request);assert.deepEqual(f.events,['create','batch','enable','link']);assert.equal(result.created,true);assert.equal(result.setupLink,'https://example.test/reset');assert.equal(f.created().emailVerified,false);assert(f.created().password.length>=32);assert.equal(f.created().disabled,false);assert.deepEqual(f.records.get('user_access/new').permissions,{...permissions,fahrtenbuch:'none',fahrzeuge:'none',fahrzeugeErstellen:'none',fahrzeugeUebernehmen:'none'});assert(!JSON.stringify([...f.records]).includes(f.created().password));assert(!JSON.stringify(result).includes(f.created().password));});
test('duplicate email is reported without altering existing account',async()=>{const f=fixture({duplicate:true});await assert.rejects(f.service.create(f.request),e=>e.code==='already-exists');assert.deepEqual(f.events,['create']);});
test('failed setup never enables and attempts cleanup',async()=>{const f=fixture({batchFail:true});await assert.rejects(f.service.create(f.request));assert.equal(f.created().disabled,true);assert(!f.events.includes('enable'));assert(f.events.includes('delete'));});
test('failed cleanup provides UID for recovery',async()=>{const f=fixture({batchFail:true,cleanupFail:true});await assert.rejects(f.service.create(f.request),e=>e.code==='internal'&&e.message.includes('new'));});
test('link failure reports account created, without repeating creation',async()=>{const f=fixture({linkFail:true});const result=await f.service.create(f.request);assert(result.created);assert.equal(result.setupLink,null);assert.equal(f.created().disabled,false);});


test('new vehicle rights are accepted and invalid levels rejected',async()=>{
 const f=fixture();const rights={...permissions,fahrtenbuch:'edit',fahrzeuge:'view',fahrzeugeErstellen:'edit',fahrzeugeUebernehmen:'edit'};
 await f.service.create({...f.request,data:{...f.request.data,permissions:rights}});assert.deepEqual(f.records.get('user_access/new').permissions,rights);
 for(const extra of [{fahrtenbuch:'view'},{fahrzeuge:'all'},{fahrzeugeErstellen:'view'},{fahrzeugeUebernehmen:'view'}]){const g=fixture();await assert.rejects(g.service.create({...g.request,data:{...g.request.data,permissions:{...permissions,...extra}}}),e=>e.code==='invalid-argument');assert.equal(g.events.length,0);}
});
