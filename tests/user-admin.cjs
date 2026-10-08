'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createService,MASTER}=require('../functions-user-admin/service.cjs');
class CallableError extends Error{constructor(code,message){super(message);this.code=code;}}
function fixture({deleteFail=false,batchFail=false}={}){
 const events=[],records=new Map([['users/worker',{username:'Max'}],['user_access/worker',{permissions:{kabellager:'edit'}}]]);let exists=true;
 const auth={getUser:async id=>({uid:id,disabled:false}),listUsers:async(_size,token)=>({users:[{uid:'worker',email:'max@example.com',passwordHash:'secret',providerData:['secret']}],pageToken:token?undefined:'next'}),deleteUser:async id=>{events.push('auth-delete');if(deleteFail)throw Object.assign(Error('failure'),{code:'auth/internal-error'});if(!exists)throw Object.assign(Error('missing'),{code:'auth/user-not-found'});exists=false;}};
 const ref=(name,id)=>({path:name+'/'+id,set:async data=>{events.push('block');records.set(name+'/'+id,data);}});
 const db={collection:name=>({doc:id=>ref(name,id)}),batch:()=>{const removed=[];return {delete:reference=>removed.push(reference.path),commit:async()=>{events.push('cleanup');if(batchFail)throw Error('batch failed');for(const path of removed)records.delete(path);}}}};
 return {service:createService({auth,db,timestamp:()=>123,ErrorType:CallableError}),events,records,request:{auth:{uid:MASTER},data:{uid:'worker',confirmUid:'worker'}}};
}
test('only master may list or delete',async()=>{const f=fixture();for(const auth of [undefined,{uid:'worker'}]){await assert.rejects(f.service.remove({...f.request,auth}),e=>['unauthenticated','permission-denied'].includes(e.code));await assert.rejects(f.service.list({auth}),e=>['unauthenticated','permission-denied'].includes(e.code));}assert.equal(f.events.length,0);});
test('master account and malformed confirmations are rejected',async()=>{const f=fixture();for(const data of [{uid:MASTER,confirmUid:MASTER},{uid:'bad/path',confirmUid:'bad/path'},{uid:'worker'},{uid:123}])await assert.rejects(f.service.remove({...f.request,data}));assert.equal(f.events.length,0);});
test('block precedes Auth deletion; profile/access deleted and marker retained',async()=>{const f=fixture();await f.service.remove(f.request);assert.deepEqual(f.events,['block','auth-delete','cleanup']);assert(!f.records.has('users/worker'));assert(!f.records.has('user_access/worker'));assert(f.records.has('account_deletions/worker'));});
test('Auth failure retains marker and profile for retry',async()=>{const f=fixture({deleteFail:true});await assert.rejects(f.service.remove(f.request));assert(f.records.has('account_deletions/worker'));assert(f.records.has('users/worker'));assert.deepEqual(f.events,['block','auth-delete']);});
test('retry after Auth deletion completes idempotently',async()=>{const f=fixture();await f.service.remove(f.request);await f.service.remove(f.request);assert(!f.records.has('users/worker'));});
test('cleanup failure preserves block',async()=>{const f=fixture({batchFail:true});await assert.rejects(f.service.remove(f.request));assert(f.records.has('account_deletions/worker'));});
test('listing supports pages and returns only necessary fields',async()=>{const f=fixture();const result=await f.service.list({auth:{uid:MASTER},data:{}});assert.equal(result.pageToken,'next');assert.deepEqual(Object.keys(result.users[0]).sort(),['disabled','displayName','email','uid']);assert.equal((await f.service.list({auth:{uid:MASTER},data:{pageToken:'next'}})).pageToken,null);});
