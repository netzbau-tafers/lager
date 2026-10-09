'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPush,due,WAIT}=require('./push.cjs');
const now=Date.now(),ts=ms=>({toMillis:()=>ms});
const bobine=()=>({nummer:'123',status:'In Gebrauch',inGebrauchVonUid:'alice',inGebrauchAm:ts(now-WAIT-1000)});
test('48h boundary and repeated use',()=>{
  const b=bobine();assert.equal(due(b,now),true);assert.equal(due(b,now-WAIT),false);
  assert.equal(due(b,now,now-1000),false);assert.equal(due(b,now+WAIT,now),true);
  assert.equal(due({...b,status:'Lager'},now),false);
  assert.equal(due({...b,inGebrauchAm:undefined},now),false);
  assert.equal(due({...b,inGebrauchVonUid:undefined},now),false);
});
test('acknowledgement applies only to the same usage',()=>{
  const b=bobine(),usage=String(b.inGebrauchAm.toMillis());
  assert.equal(due({...b,erinnerungGelesenFuer:usage,erinnerungGelesenAm:ts(now-1000)},now),false);
  assert.equal(due({...b,erinnerungGelesenFuer:'old',erinnerungGelesenAm:ts(now)},now),true);
  assert.equal(due({...b,erinnerungGelesenFuer:usage},now),false);
});
function fixture(){
  const data=new Map(),messages=[];let disabled=false;
  function ref(path){return {path,async get(){const value=data.get(path);return {exists:data.has(path),id:path.split('/').pop(),ref:this,data:()=>value};},async set(value,options){data.set(path,options?.merge?{...data.get(path),...value}:value);},async update(value){await this.set(value,{merge:true});},async delete(){data.delete(path);}};}
  const db={collection:name=>({doc:id=>ref(name+'/'+id),where:(key,op,value)=>({async get(){const docs=[];for(const [path,entry] of data)if(path.startsWith(name+'/')&&entry[key]===value)docs.push(await ref(path).get());return {docs};}})}),async runTransaction(fn){return fn({get:r=>r.get(),set:(r,v,o)=>r.set(v,o),delete:r=>r.delete()});}};
  class E extends Error{constructor(code,message){super(message);this.code=code;}}
  const service=createPush({db,auth:{getUser:async()=>({disabled})},messaging:{send:async message=>{messages.push(message);return 'sent';}},FieldValue:{serverTimestamp:()=>ts(Date.now())},ErrorType:E,logger:{info(){},warn(){}}});
  return {data,messages,service,setDisabled:value=>{disabled=value;}};
}
test('device owner changes; another user cannot unregister it',async()=>{
  const f=fixture(),token='x'.repeat(40);
  await f.service.register({auth:{uid:'alice'},data:{token}});
  await f.service.register({auth:{uid:'bob'},data:{token}});
  await f.service.unregister({auth:{uid:'alice'},data:{token}});
  assert.equal([...f.data.values()][0].uid,'bob');
  assert.equal(f.data.get('push_preferences/alice').enabled,false);
  assert.equal(f.data.get('push_preferences/bob').enabled,true);
  await f.service.unregister({auth:{uid:'bob'},data:{token}});assert.equal([...f.data.keys()].filter(k=>k.startsWith('push_devices/')).length,0);
  assert.equal(f.data.get('push_preferences/bob').enabled,false);
  await assert.rejects(f.service.register({data:{token}}),error=>error.code==='unauthenticated');
});
test('send only to responsible user; no duplicate next run; direct bobine link',async()=>{
  const f=fixture();f.data.set('bobinen/bobine-123',bobine());
  await f.service.register({auth:{uid:'alice'},data:{token:'a'.repeat(40)}});
  await f.service.register({auth:{uid:'bob'},data:{token:'b'.repeat(40)}});
  await f.service.remind();await f.service.remind();
  assert.equal(f.messages.length,1);assert.equal(f.messages[0].token,'a'.repeat(40));
  assert.match(f.messages[0].webpush.fcmOptions.link,/index.html\?bobine=bobine-123$/);
});
test('deleted, disabled and read-only accounts receive no reminders',async()=>{
  for(const mode of ['deleted','disabled','view']){
    const f=fixture();f.data.set('bobinen/test',bobine());
    await f.service.register({auth:{uid:'alice'},data:{token:'a'.repeat(40)}});
    if(mode==='deleted')f.data.set('account_deletions/alice',{});
    if(mode==='disabled')f.setDisabled(true);
    if(mode==='view')f.data.set('user_access/alice',{permissions:{kabellager:'view'}});
    await f.service.remind();assert.equal(f.messages.length,0);
  }
});
