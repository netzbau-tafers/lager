module.exports = function mock(scenario){
  globalThis.calls=[];globalThis.saved=[];const timestamp={toDate:()=>new Date('2026-10-06T05:00:00Z'),toMillis:()=>1791262800000};
  const user=scenario.user;const profiles={'pmyu29TlC3QM7JIysmy2EmiHSWW2':{username:'Martin Gross',email:'martin@example.com'},worker:{username:'Max Muster',email:'max@example.com',lastSeenAt:timestamp}};
  const access=scenario.permissions?{[user.uid]:{permissions:scenario.permissions}}:{};
  const snapshot=(name,id)=>({id,exists:!!(name==='users'?profiles[id]:name==='user_access'?access[id]:null),data:()=>name==='users'?profiles[id]:name==='user_access'?access[id]:{},docs:[]});
  function collection(name){const q={where:()=>q,orderBy:()=>q,limit:()=>q,get:async()=>{calls.push(['get',name]);return {docs:Object.entries(name==='users'?profiles:name==='user_access'?access:{}).map(([id,data])=>({id,data:()=>data}))};},onSnapshot:(cb)=>{calls.push(['listen',name]);queueMicrotask(()=>{const docs=Object.entries(scenario.records?.[name]||{}).map(([id,data])=>({id,data:()=>data}));cb({docs,docChanges:()=>[],empty:!docs.length});});return ()=>{};},add:async data=>{saved.push({name,data});return {id:'new'};},doc:id=>({get:async()=>snapshot(name,id),set:async data=>{saved.push({name,id,data});},update:async data=>saved.push({name,id,data}),onSnapshot:cb=>{queueMicrotask(()=>cb(snapshot(name,id)));return ()=>{};}})};return q;}
  const db={collection,batch:()=>{const writes=[];return {set:(ref,data)=>writes.push(data),commit:async()=>saved.push(...writes)}},runTransaction:async()=>{}};
  const auth={setPersistence:async()=>{},currentUser:user,onAuthStateChanged:callback=>{queueMicrotask(()=>callback(user));return ()=>{};},signOut:async()=>{auth.currentUser=null;}};
  const firestore=()=>db;firestore.FieldValue={serverTimestamp:()=>({server:true}),delete:()=>({delete:true})};firestore.Timestamp={now:()=>timestamp};
  const authFactory=()=>auth;authFactory.Auth={Persistence:{LOCAL:'local'}};globalThis.firebase={apps:[],initializeApp:()=>({firestore,auth:authFactory}),auth:authFactory,firestore,storage:()=>({ref:()=>({})})};
}
;
