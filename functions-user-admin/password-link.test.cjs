const test=require('node:test'),assert=require('node:assert/strict');
const {createService,MASTER}=require('./service.cjs');
class E extends Error{constructor(code,message){super(message);this.code=code;}}
function fixture({deleted=false,disabled=false}={}){
  const generated=[];
  const auth={async getUser(uid){return uid===MASTER?{disabled:false}:{email:'current@example.com',disabled};},async generatePasswordResetLink(email){generated.push(email);return 'https://example.com/reset?secret=test';},sendPasswordResetEmail(){throw Error('Email must never be sent');}};
  const db={collection:()=>({doc:()=>({get:async()=>({exists:deleted})})})};
  return {generated,service:createService({auth,db,ErrorType:E})};
}
test('returns link using the current account email without sending email',async()=>{
  const f=fixture();const result=await f.service.resetLink({auth:{uid:MASTER},data:{uid:'target',email:'untrusted@example.com'}});
  assert.equal(result.uid,'target');assert.equal(result.email,'current@example.com');assert.equal(result.resetLink,'https://example.com/reset?secret=test');assert.deepEqual(f.generated,['current@example.com']);
});
test('non-master and unauthenticated callers cannot generate links',async()=>{
  const f=fixture();for(const auth of [undefined,{uid:'other'}])await assert.rejects(f.service.resetLink({auth,data:{uid:'target'}}));assert.equal(f.generated.length,0);
});
test('deleted and disabled accounts cannot generate links',async()=>{
  for(const option of [{deleted:true},{disabled:true}]){const f=fixture(option);await assert.rejects(f.service.resetLink({auth:{uid:MASTER},data:{uid:'target'}}),e=>e.code==='failed-precondition');assert.equal(f.generated.length,0);}
});

test('own link ignores supplied target and email, and sends no email',async()=>{
  const f=fixture();const result=await f.service.ownResetLink({auth:{uid:'self'},data:{uid:MASTER,email:'attacker@example.com'}});
  assert.deepEqual(result,{resetLink:'https://example.com/reset?secret=test'});
  assert.deepEqual(f.generated,['current@example.com']);
});
test('own link requires authentication and an active existing account',async()=>{
  await assert.rejects(fixture().service.ownResetLink({data:{}}),e=>e.code==='unauthenticated');
  for(const option of [{deleted:true},{disabled:true}]){
    const f=fixture(option);await assert.rejects(f.service.ownResetLink({auth:{uid:'self'}}),e=>e.code==='failed-precondition');assert.equal(f.generated.length,0);
  }
});
