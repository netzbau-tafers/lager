const test=require('node:test'),assert=require('node:assert/strict');
const {createService,MASTER}=require('./service.cjs');
class E extends Error{constructor(code,message){super(message);this.code=code;}}
function fixture({deleted=false,disabled=false,accessLevel='none',callerDeleted=false,callerDisabled=false,targetTitle='',targetPermissions={}}={}){
  const generated=[];
  const auth={
    async getUser(id){
      if(id===MASTER)return {email:'master@example.com',disabled:false};
      if(id==='editor'||id==='viewer'||id==='other')return {email:'caller@example.com',disabled:callerDisabled};
      return {email:'current@example.com',disabled};
    },
    async generatePasswordResetLink(email){generated.push(email);return 'https://example.com/reset?secret=test';},
    sendPasswordResetEmail(){throw Error('Email must never be sent');}
  };
  const db={collection(name){return {doc(id){return {async get(){
    if(name==='account_deletions')return {exists:id==='target'||id==='self'?deleted:callerDeleted};
    if(name==='user_access')return {exists:true,data:()=>({permissions:id==='target'?{...targetPermissions}:{benutzer:accessLevel}})};
    if(name==='users')return {exists:id==='target',data:()=>({adminTitle:targetTitle})};
    return {exists:false,data:()=>({})};
  }};}};}};
  return {generated,service:createService({auth,db,ErrorType:E})};
}
test('master can generate link for an existing account, using verified account email',async()=>{
  const f=fixture(),result=await f.service.resetLink({auth:{uid:MASTER},data:{uid:'target',email:'untrusted@example.com'}});
  assert.deepEqual(result,{uid:'target',email:'current@example.com',resetLink:'https://example.com/reset?secret=test'});
  assert.deepEqual(f.generated,['current@example.com']);
});
test('user administration edit permission can generate links for other accounts',async()=>{
  const f=fixture({accessLevel:'edit'});
  const result=await f.service.resetLink({auth:{uid:'editor'},data:{uid:'target',email:'untrusted@example.com'}});
  assert.equal(result.email,'current@example.com');
  assert.deepEqual(f.generated,['current@example.com']);
});
test('view, none and unauthenticated callers cannot generate reset links',async()=>{
  for(const accessLevel of ['view','none']){
    const f=fixture({accessLevel});
    await assert.rejects(f.service.resetLink({auth:{uid:'viewer'},data:{uid:'target'}}),error=>error.code==='permission-denied');
    assert.equal(f.generated.length,0);
  }
  const f=fixture({accessLevel:'edit'});
  await assert.rejects(f.service.resetLink({data:{uid:'target'}}),error=>error.code==='unauthenticated');
  assert.equal(f.generated.length,0);
});
test('editor may not generate a link for the master account',async()=>{
  const f=fixture({accessLevel:'edit'});
  await assert.rejects(f.service.resetLink({auth:{uid:'editor'},data:{uid:MASTER}}),error=>error.code==='permission-denied');
  assert.equal(f.generated.length,0);
});
test('disabled or deleted user-admin callers cannot generate links even with edit permission',async()=>{
  for(const option of [{callerDeleted:true},{callerDisabled:true}]){
    const f=fixture({...option,accessLevel:'edit'});
    await assert.rejects(f.service.resetLink({auth:{uid:'editor'},data:{uid:'target'}}),error=>error.code==='permission-denied');
    assert.equal(f.generated.length,0);
  }
});
test('deleted or disabled target accounts cannot generate links',async()=>{
  for(const option of [{deleted:true},{disabled:true}]){
    const f=fixture(option);
    await assert.rejects(f.service.resetLink({auth:{uid:MASTER},data:{uid:'target'}}),error=>error.code==='failed-precondition');
    assert.equal(f.generated.length,0);
  }
});
test('own link ignores supplied target and email, and sends no email',async()=>{
  const f=fixture(),result=await f.service.ownResetLink({auth:{uid:'self'},data:{uid:MASTER,email:'attacker@example.com'}});
  assert.deepEqual(result,{resetLink:'https://example.com/reset?secret=test'});
  assert.deepEqual(f.generated,['current@example.com']);
});
test('own link requires authentication and an active existing account',async()=>{
  await assert.rejects(fixture().service.ownResetLink({data:{}}),error=>error.code==='unauthenticated');
  for(const option of [{deleted:true},{disabled:true}]){
    const f=fixture(option);
    await assert.rejects(f.service.ownResetLink({auth:{uid:'self'}}),error=>error.code==='failed-precondition');
    assert.equal(f.generated.length,0);
  }
});

test('delegated editors cannot reset another Administrator account',async()=>{
  const f=fixture({accessLevel:'edit',targetTitle:'administrator'});
  await assert.rejects(f.service.resetLink({auth:{uid:'editor'},data:{uid:'target'}}),e=>e.code==='permission-denied');
  assert.deepEqual(f.generated,[]);
});
test('the main administrator can reset an Administrator account',async()=>{
  const f=fixture({targetTitle:'administrator'});
  const result=await f.service.resetLink({auth:{uid:MASTER},data:{uid:'target'}});
  assert.equal(result.email,'current@example.com');
  assert.equal(f.generated.length,1);
});
test('derived legacy admin titles are protected even without saved adminTitle',async()=>{
  const f=fixture({accessLevel:'edit',targetPermissions:{
    kabellager:'edit',baustellen:'edit',archiv:'edit',materialvorlagen:'edit',beendete:'edit'
  }});
  await assert.rejects(f.service.resetLink({auth:{uid:'editor'},data:{uid:'target'}}),e=>e.code==='permission-denied');
  assert.deepEqual(f.generated,[]);
});
test('other explicit titles remain manageable by delegated editors',async()=>{
  const f=fixture({accessLevel:'edit',targetTitle:'mitarbeiter',targetPermissions:{
    kabellager:'edit',baustellen:'edit',archiv:'edit',materialvorlagen:'edit',beendete:'edit'
  }});
  assert.equal((await f.service.resetLink({auth:{uid:'editor'},data:{uid:'target'}})).uid,'target');
  assert.equal(f.generated.length,1);
});
