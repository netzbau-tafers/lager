'use strict';
const {createHash}=require('node:crypto');
const WAIT=48*60*60*1000;
const MASTER='pmyu29TlC3QM7JIysmy2EmiHSWW2';
const time=value=>value&&typeof value.toMillis==='function'?value.toMillis():NaN;
function workWindow(now){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Zurich',weekday:'short',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));
  const seconds=Number(parts.hour)*3600+Number(parts.minute)*60+Number(parts.second);
  const end=['Mon','Tue','Wed','Thu'].includes(parts.weekday)?17*3600+10*60:parts.weekday==='Fri'?11*3600+50*60:0;
  return {allowed:seconds>=7*3600&&seconds<end,ttl:Math.max(0,Math.min(3600,end-seconds))};
}
function due(b,now,lastSent=0){
  const start=time(b.inGebrauchAm);
  const acknowledged=b.erinnerungGelesenFuer===String(start)?time(b.erinnerungGelesenAm):NaN;
  if(b.erinnerungGelesenFuer===String(start)&&!Number.isFinite(acknowledged))return false;
  return b.status==='In Gebrauch'&&typeof b.inGebrauchVonUid==='string'&&Number.isFinite(start)&&
    now-Math.max(start,Number.isFinite(acknowledged)?acknowledged:0,lastSent)>=WAIT;
}
function createPush({db,auth,messaging,FieldValue,ErrorType,logger,clock=Date.now}){
  const tokens=db.collection('push_devices');
  const preferences=db.collection('push_preferences');
  const DEVICE_AGE=90*24*60*60*1000;
  async function syncPreference(uid){
    await db.runTransaction(async tx=>{
      const pref=preferences.doc(uid);await tx.get(pref);
      const devices=await tx.get(tokens.where('uid','==',uid));
      const until=Math.max(0,...devices.docs.map(d=>time(d.data().updatedAt)+DEVICE_AGE).filter(Number.isFinite));
      tx.set(pref,{enabled:until>clock(),activeUntil:new Date(until)});
    });
  }
  async function allowed(uid){
    const [marker,access,user]=await Promise.all([db.collection('account_deletions').doc(uid).get(),db.collection('user_access').doc(uid).get(),auth.getUser(uid)]);
    return !marker.exists&&!user.disabled&&(uid===MASTER||!access.exists||access.data().permissions?.kabellager==='edit');
  }
  async function caller(request){
    if(!request.auth)throw new ErrorType('unauthenticated','Bitte anmelden.');
    if(!await allowed(request.auth.uid))throw new ErrorType('permission-denied','Keine Berechtigung für Kabelerinnerungen.');
    return request.auth.uid;
  }
  function tokenRef(token){
    if(typeof token!=='string'||token.length<20||token.length>4096||/\s/.test(token))throw new ErrorType('invalid-argument','Ungültiges Gerät.');
    return tokens.doc(createHash('sha256').update(token).digest('hex'));
  }
  return {
    async register(request){
      const uid=await caller(request),token=request.data?.token,ref=tokenRef(token);
      // A browser token has one current owner, including when accounts change.
      let previousUid;
      await db.runTransaction(async tx=>{
        const previous=await tx.get(ref);previousUid=previous.data()?.uid;
        await tx.get(preferences.doc(uid));
        tx.set(ref,{uid,token,updatedAt:FieldValue.serverTimestamp()});
        tx.set(preferences.doc(uid),{enabled:true,activeUntil:new Date(clock()+DEVICE_AGE)});
      });
      if(previousUid&&previousUid!==uid)await syncPreference(previousUid);
      return {registered:true};
    },
    async unregister(request){
      if(!request.auth)throw new ErrorType('unauthenticated','Bitte anmelden.');
      const ref=tokenRef(request.data?.token);
      await db.runTransaction(async tx=>{const doc=await tx.get(ref);if(doc.exists&&doc.data().uid===request.auth.uid)tx.delete(ref);});
      await syncPreference(request.auth.uid);
      return {removed:true};
    },
    async test(request){
      const uid=await caller(request),ref=tokenRef(request.data?.token),doc=await ref.get();
      if(!doc.exists||doc.data().uid!==uid)throw new ErrorType('permission-denied','Bitte zuerst dieses Gerät aktivieren.');
      const sent=time(doc.data().testAt);
      if(Number.isFinite(sent)&&clock()-sent<60000)throw new ErrorType('resource-exhausted','Bitte eine Minute warten.');
      await ref.update({testAt:FieldValue.serverTimestamp()});
      await messaging.send({token:doc.data().token,webpush:{headers:{TTL:'300'},notification:{title:'Lagermanager – Test',body:'Smartphone-Benachrichtigungen funktionieren.',icon:'https://netzbau-tafers.github.io/lager/favicon.png'},fcmOptions:{link:'https://netzbau-tafers.github.io/lager/profil.html'}}});
      return {sent:true};
    },
    async remind(){
      const now=clock();
      if(!workWindow(now).allowed)return;
      const snapshot=await db.collection('bobinen').where('status','==','In Gebrauch').get();
      let sent=0;
      const userCache=new Map();
      for(const bobine of snapshot.docs){
        const b=bobine.data();if(!due(b,now))continue;
        const uid=b.inGebrauchVonUid;
        try{
          if(!userCache.has(uid))userCache.set(uid,await allowed(uid));
          if(!userCache.get(uid))continue;
          const deviceSnapshot=await tokens.where('uid','==',uid).get();
          const devices=deviceSnapshot.docs.filter(d=>now-time(d.data().updatedAt)<90*24*60*60*1000);
          if(!devices.length)continue;
          const state=db.collection('push_reminders').doc(bobine.id);
          const usage=String(time(b.inGebrauchAm));
          const claimed=await db.runTransaction(async tx=>{
            const [current,previous]=await Promise.all([tx.get(bobine.ref),tx.get(state)]);
            if(!current.exists)return false;
            const live=current.data(),old=previous.data()||{};
            const last=old.usage===usage&&old.uid===uid?time(old.sentAt):0;
            if(String(time(live.inGebrauchAm))!==usage||live.inGebrauchVonUid!==uid||!due(live,now,Number.isFinite(last)?last:0)||time(old.leaseUntil)>now)return false;
            tx.set(state,{uid,usage,leaseUntil:new Date(now+10*60*1000)},{merge:true});return true;
          });
          if(!claimed)continue;
          let delivered=false;
          for(const device of devices){
            // Re-read ownership before sending so an account switch invalidates old snapshots.
            const [latest,currentBobine]=await Promise.all([device.ref.get(),bobine.ref.get()]);
            if(!latest.exists||latest.data().uid!==uid||!currentBobine.exists||currentBobine.data().inGebrauchVonUid!==uid||String(time(currentBobine.data().inGebrauchAm))!==usage||!due(currentBobine.data(),clock()))continue;
            try{
              const window=workWindow(clock());if(!window.allowed)break;
              await messaging.send({token:latest.data().token,webpush:{headers:{TTL:String(window.ttl)},notification:{title:'Bobine noch in Gebrauch',body:'Bobine '+String(b.nummer||'ohne Nummer').slice(0,80)+' ist seit über 48 Stunden in Gebrauch. Bitte prüfen.',icon:'https://netzbau-tafers.github.io/lager/favicon.png',tag:'bobine-'+bobine.id},fcmOptions:{link:'https://netzbau-tafers.github.io/lager/index.html?bobine='+encodeURIComponent(bobine.id)}}});
              delivered=true;
            }catch(error){
              if(['messaging/registration-token-not-registered','messaging/invalid-registration-token'].includes(error.code)){await device.ref.delete();await syncPreference(uid);}
              else logger.warn('Push-Versand fehlgeschlagen',{code:error.code||'unknown'});
            }
          }
          await state.set({leaseUntil:new Date(0),...(delivered?{sentAt:FieldValue.serverTimestamp()}: {})},{merge:true});
          if(delivered)sent++;
        }catch(error){logger.warn('Bobinen-Erinnerung fehlgeschlagen',{code:error.code||'unknown'});}
      }
      logger.info('Bobinen-Erinnerungen geprüft',{sent});
    }
  };
}
module.exports={createPush,due,WAIT,workWindow};
