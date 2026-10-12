'use strict';
const {MASTER}=require('./service.cjs');
function createTakeoverNotifier({db,auth,messaging,logger,now=Date.now}){
  return async event=>{
    const entry=event.data?.data(),uid=entry?.from?.uid;
    if(entry?.type!=='takeover'||!uid||uid===entry.actor?.uid)return;
    const [user,deleted,access,devices]=await Promise.all([
      auth.getUser(uid),db.collection('account_deletions').doc(uid).get(),
      db.collection('user_access').doc(uid).get(),db.collection('push_devices').where('uid','==',uid).get()
    ]);
    if(user.disabled||deleted.exists||(uid!==MASTER&&!['view','edit'].includes(access.data()?.permissions?.fahrzeuge)))return;
    const vehicleId=event.params.vehicleId;
    const link='https://netzbau-tafers.github.io/lager/fahrzeuge.html?fahrzeug='+encodeURIComponent(vehicleId)+'&verlauf=1';
    for(const device of devices.docs){
      const latest=await device.ref.get(),data=latest.data();
      if(!latest.exists||data.uid!==uid||now()-(data.updatedAt?.toMillis?.()||0)>=90*24*60*60*1000)continue;
      try{
        await messaging.send({token:data.token,data:{url:link,kind:'vehicle-takeover',vehicleId},webpush:{headers:{TTL:'86400'},notification:{title:'Fahrzeug übernommen',body:entry.actor.name+' hat '+entry.vehicleName+' ('+entry.plate+') von dir übernommen. Deine Nutzung wurde beendet. Bei Bedarf kannst du deine Nutzungszeit im Verlauf anpassen.',icon:'https://netzbau-tafers.github.io/lager/favicon.png',tag:'vehicle-takeover-'+event.params.eventId,data:{url:link}},fcmOptions:{link}}});
      }catch(error){
        if(['messaging/registration-token-not-registered','messaging/invalid-registration-token'].includes(error.code))await device.ref.delete();
        else logger.warn('Übernahme-Benachrichtigung fehlgeschlagen',{code:error.code||'unknown'});
      }
    }
  };
}
module.exports={createTakeoverNotifier};
