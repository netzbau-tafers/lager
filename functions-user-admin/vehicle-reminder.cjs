'use strict';
const MASTER='pmyu29TlC3QM7JIysmy2EmiHSWW2';
const millis=value=>value?.toMillis?.()??NaN;
function reminderDay(ms){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Zurich',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(ms).map(p=>[p.type,p.value]));
  const minute=Number(p.hour)*60+Number(p.minute);
  const target=['Mon','Tue','Wed','Thu'].includes(p.weekday)?1030:p.weekday==='Fri'?715:-1;
  // Allow short scheduler delays, but never deliver a stale reminder later in the day.
  return target>=0&&minute>=target&&minute<target+10?p.year+'-'+p.month+'-'+p.day:null;
}
function createVehicleReminder({db,auth,messaging,FieldValue,logger,clock=Date.now}){
  return async function remind(){
    const now=clock(),day=reminderDay(now);
    if(!day)return;
    const vehicles=await db.collection('fahrzeuge').where('status','==','inGebrauch').get();
    let sent=0;
    for(const vehicle of vehicles.docs){
      const v=vehicle.data(),uid=v.active?.uid,session=v.active?.sessionId;
      if(!uid||!session)continue;
      try{
        const [deleted,access,user,devices]=await Promise.all([
          db.collection('account_deletions').doc(uid).get(),
          db.collection('user_access').doc(uid).get(),auth.getUser(uid),
          db.collection('push_devices').where('uid','==',uid).get()
        ]);
        if(deleted.exists||user.disabled||(uid!==MASTER&&!['view','edit'].includes(access.data()?.permissions?.fahrzeuge)))continue;
        const currentDevices=devices.docs.filter(d=>now-millis(d.data().updatedAt)<90*24*60*60*1000);
        if(!currentDevices.length)continue;
        const state=db.collection('push_reminders').doc('vehicle-'+vehicle.id);
        const claimed=await db.runTransaction(async tx=>{
          const [live,previous]=await Promise.all([tx.get(vehicle.ref),tx.get(state)]);
          const data=live.data(),old=previous.data()||{};
          if(data?.status!=='inGebrauch'||data.active?.uid!==uid||data.active?.sessionId!==session||old.day===day||millis(old.leaseUntil)>now)return false;
          tx.set(state,{uid,session,leaseUntil:new Date(now+10*60*1000)},{merge:true});
          return true;
        });
        if(!claimed)continue;
        let delivered=false;
        try{
          for(const device of currentDevices){
            const [latest,live]=await Promise.all([device.ref.get(),vehicle.ref.get()]);
            const data=live.data();
            if(!latest.exists||latest.data().uid!==uid||data?.status!=='inGebrauch'||data.active?.uid!==uid||data.active?.sessionId!==session||reminderDay(clock())!==day)continue;
            try{
              await messaging.send({token:latest.data().token,webpush:{
                headers:{TTL:'600'},notification:{
                  title:'Fahrzeug noch in Gebrauch?',
                  body:'Benutzt du '+String(data.name||'das Fahrzeug').slice(0,100)+' noch? Bitte gib es frei, wenn du fertig bist.',
                  icon:'https://netzbau-tafers.github.io/lager/favicon.png',tag:'vehicle-'+vehicle.id
                },fcmOptions:{link:'https://netzbau-tafers.github.io/lager/fahrzeuge.html'}
              }});
              delivered=true;
            }catch(error){
              if(['messaging/registration-token-not-registered','messaging/invalid-registration-token'].includes(error.code))await device.ref.delete();
              else logger.warn('Fahrzeug-Push fehlgeschlagen',{code:error.code||'unknown'});
            }
          }
        }finally{
          await state.set({leaseUntil:new Date(0),...(delivered?{day,sentAt:FieldValue.serverTimestamp()}: {})},{merge:true});
        }
        if(delivered)sent++;
      }catch(error){logger.warn('Fahrzeug-Erinnerung fehlgeschlagen',{code:error.code||'unknown'});}
    }
    logger.info('Fahrzeug-Erinnerungen geprüft',{sent});
  };
}
module.exports={createVehicleReminder,reminderDay};
