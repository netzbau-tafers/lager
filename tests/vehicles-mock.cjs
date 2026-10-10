module.exports=function vehicleMock(scenario){
  const stamp=()=>({toDate:()=>new Date('2026-10-09T08:00:00Z'),toMillis:()=>Date.parse('2026-10-09T08:00:00Z')});
  const user={uid:'worker',email:'max@example.test'},p={kabellager:'none',baustellen:'none',fahrzeuge:'edit',fahrzeugeErstellen:'edit',fahrzeugeUebernehmen:'edit',...(scenario.permissions||{})};
  const data=new Map([['users/worker',{username:'Max Muster'}],['user_access/worker',{permissions:p}]]),listeners=new Map();globalThis.vehicleCalls=[];globalThis.historyReads=[];
  for(const [id,value]of Object.entries(scenario.vehicles||{bus:{name:'Bus',plate:'FR 123',km:123456,revision:0,active:null,status:'frei'}})){data.set('fahrzeuge/'+id,{kmAt:stamp(),kmBy:{name:'Max Muster'},...value,...(value.active?{active:{...value.active,start:stamp()}}:{})});}
  for(const id of scenario.favorites||[])data.set('fahrzeug_favoriten/worker/fahrzeuge/'+id,{updatedAt:stamp()});
  const snapshot=path=>({id:path.split('/').at(-1),exists:data.has(path),data:()=>data.get(path)});
  function collectionSnapshot(path){const docs=[...data.keys()].filter(key=>key.startsWith(path+'/')&&key.slice(path.length+1).indexOf('/')===-1).map(snapshot);return {docs,size:docs.length,empty:!docs.length};}
  function listen(key,callback){if(!listeners.has(key))listeners.set(key,new Set());const set=listeners.get(key);set.add(callback);queueMicrotask(()=>{if(set.has(callback))callback(key.endsWith('/#')?collectionSnapshot(key.slice(0,-2)):snapshot(key));});return ()=>set.delete(callback);}
  function emit(path){for(const key of [path,path.slice(0,path.lastIndexOf('/'))+'/#'])for(const callback of listeners.get(key)||[])queueMicrotask(()=>{if(listeners.get(key)?.has(callback))callback(key.endsWith('/#')?collectionSnapshot(key.slice(0,-2)):snapshot(key));});}
  function doc(path){return {id:path.split('/').at(-1),get:async()=>snapshot(path),set:async value=>{data.set(path,value);emit(path);},delete:async()=>{data.delete(path);emit(path);},collection:name=>collection(path+'/'+name),onSnapshot:callback=>listen(path,callback)};}
  function collection(path){
    if(path.endsWith('/verlauf')){
      let count=Infinity,cursor=null,filters=[];
      const q={orderBy:()=>q,limit:value=>{count=value;return q;},startAfter:value=>{cursor=value;return q;},where:(field,op,value)=>{filters.push({op,value:value.toMillis()});return q;},get:async()=>{
        historyReads.push({path,count,cursor:cursor?.id,filters});
        if(scenario.historyError&&historyReads.length===1)throw new Error('offline');
        const docs=Array.from({length:scenario.historyCount||0},(_,i)=>({id:String(i),data:()=>({type:'fuel',km:i,actor:{name:'Test'},start:stamp()})}));
        const offset=cursor?Number(cursor.id)+1:0;return {docs:docs.slice(offset,offset+count)};
      }};return q;
    }
    const q={doc:id=>doc(path+'/'+id),onSnapshot:callback=>listen(path+'/#',callback),get:async()=>collectionSnapshot(path),where:()=>q,orderBy:()=>q,limit:()=>q};return q;}
  const db={collection},auth={currentUser:user,onAuthStateChanged:callback=>{queueMicrotask(()=>callback(user));return ()=>{};},signOut:async()=>{}};
  globalThis.setVehicle=(id,value)=>{data.set('fahrzeuge/'+id,{...data.get('fahrzeuge/'+id),...value});emit('fahrzeuge/'+id);};
  const firestore=()=>db;firestore.FieldValue={serverTimestamp:stamp};firestore.Timestamp={fromMillis:value=>({toMillis:()=>value})};
  const functions=()=>({httpsCallable:name=>async values=>{
    vehicleCalls.push({name,values});if(scenario.actionError)throw Object.assign(new Error(scenario.actionError),{code:'functions/failed-precondition'});
    if(name==='lagerCreateVehicle'){setVehicle('new',{...values,revision:0,active:null,kmAt:stamp()});return {data:{id:'new'}};}
    const v=data.get('fahrzeuge/'+values.id);if(values.action==='start')setVehicle(values.id,{active:{uid:user.uid,name:'Max Muster',start:stamp()},revision:v.revision+1});
    if(values.action==='free')setVehicle(values.id,{active:null,revision:v.revision+1});
    if(values.action==='fuel')setVehicle(values.id,{km:values.km,kmAt:stamp(),revision:v.revision+1});
    if(values.action==='takeover')setVehicle(values.id,{active:{uid:user.uid,name:'Max Muster',start:stamp()},revision:v.revision+1});
    return {data:{saved:true}};
  }});
  globalThis.firebase={apps:[],initializeApp:()=>{},app:()=>({functions}),auth:()=>auth,firestore};
};
