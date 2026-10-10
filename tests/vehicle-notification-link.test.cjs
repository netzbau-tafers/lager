'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
const target='https://netzbau-tafers.github.io/lager/fahrzeug-bestaetigung.html?nachtrag=person_abcdefghijklmnop';
function worker(){
  const events={},opened=[];
  const context={URL,self:{registration:{scope:'https://netzbau-tafers.github.io/lager/'},location:{origin:'https://netzbau-tafers.github.io'},addEventListener:(name,callback)=>events[name]=callback,skipWaiting(){}},clients:{openWindow:async url=>opened.push(url),claim:async()=>{}},importScripts(){},firebase:{initializeApp(){},messaging(){}}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'firebase-messaging-sw.js'),'utf8'),context);
  return {events,opened,async click(data){let stopped=false,closed=false,pending;events.notificationclick({notification:{data,close(){closed=true;}},stopImmediatePropagation(){stopped=true;},waitUntil(promise){pending=promise;}});await pending;assert.equal(stopped,true);assert.equal(closed,true);}};
}
test('notification click opens exact request for foreground and Firebase background fields',async()=>{
  for(const data of [{url:target},{FCM_MSG:{data:{url:target}}},{FCM_MSG:{fcmOptions:{link:target}}},{FCM_MSG:{fcm_options:{link:target}}},{FCM_MSG:{webpush:{fcm_options:{link:target}}}}]){const w=worker();await w.click(data);assert.deepEqual(w.opened,[target]);}
});
test('already delivered vehicle links route to exact confirmation',async()=>{
  const w=worker();await w.click({FCM_MSG:{fcm_options:{link:target.replace('fahrzeug-bestaetigung.html','fahrzeuge.html')}}});assert.deepEqual(w.opened,[target]);
});
test('bobine and default links remain intact; foreign/out-of-scope links are rejected',async()=>{
  let w=worker();await w.click({url:'index.html?bobine=one'});assert.deepEqual(w.opened,['https://netzbau-tafers.github.io/lager/index.html?bobine=one']);
  w=worker();await w.click({});assert.deepEqual(w.opened,['https://netzbau-tafers.github.io/lager/index.html']);
  for(const url of ['https://other.example/','https://netzbau-tafers.github.io/another/index.html']){w=worker();await w.click({url});assert.deepEqual(w.opened,[]);}
});
function confirmation({user={uid:'recipient'},allowed=true,requestStatus='pending'}={}){
  const nodes=new Map(),calls=[],redirects=[];let requested;
  const document={getElementById(id){if(!nodes.has(id))nodes.set(id,{textContent:'',hidden:false,disabled:false,handlers:{},addEventListener(name,callback){this.handlers[name]=callback;}});return nodes.get(id);}};
  const request={targetUid:'recipient',vehicleName:'Unimog',plate:'FR 123',actor:{name:'Martin'},requestedBy:{name:'Kollege'},start:{toDate:()=>new Date('2026-10-09T05:00Z')},end:{toDate:()=>new Date('2026-10-09T15:15Z')},status:requestStatus};
  const context={URLSearchParams,document,location:{search:'?nachtrag=person_abcdefghijklmnop',replace:url=>redirects.push(url)},firebase:{app:()=>({functions:()=>({httpsCallable:()=>async data=>calls.push(data)})}),firestore:()=>({collection:name=>({doc:id=>({onSnapshot(callback){requested={name,id};callback({exists:true,data:()=>request});return ()=>{};}})})})},LagerAccess:{read:()=>allowed,onAuthStateChanged:callback=>callback(user)}};
  const html=fs.readFileSync(path.join(root,'fahrzeug-bestaetigung.html'),'utf8'),scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  vm.runInNewContext(scripts.at(-1)[1],context);
  return {nodes,calls,redirects,requested};
}
test('confirmation page loads only requested document and submits that exact ID',async()=>{
  const c=confirmation();assert.deepEqual(c.requested,{name:'fahrzeug_nachtraege',id:'person_abcdefghijklmnop'});assert.equal(c.nodes.get('vehicleName').textContent,'Unimog');assert.equal(c.nodes.get('confirmationActions').hidden,false);
  await c.nodes.get('confirmUse').handlers.click();assert.equal(c.calls.length,1);assert.equal(c.calls[0].id,'person_abcdefghijklmnop');assert.equal(c.calls[0].decision,'confirmed');
});
test('logged-out link preserves request through login; no vehicle access loads no request',()=>{
  let c=confirmation({user:null});assert.deepEqual(c.redirects,['home.html?vehicleBackfill=person_abcdefghijklmnop']);assert.equal(c.requested,undefined);
  c=confirmation({allowed:false});assert.equal(c.requested,undefined);assert.match(c.nodes.get('confirmationStatus').textContent,/keinen Zugriff/);
});
test('completed request cannot be decided again',async()=>{
  const c=confirmation({requestStatus:'confirmed'});assert.equal(c.nodes.get('confirmationActions').hidden,true);await c.nodes.get('rejectUse').handlers.click();assert.equal(c.calls.length,0);
});
test('login return targets confirmation page',()=>{
  const html=fs.readFileSync(path.join(root,'home.html'),'utf8');assert.match(html,/location\.replace\('fahrzeug-bestaetigung\.html\?nachtrag='\+encodeURIComponent\(backfillId\)\)/);
});
