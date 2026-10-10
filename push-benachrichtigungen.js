/* Optional device notifications. Permission is requested only by a button click. */
(() => {
  'use strict';
  const VAPID='BIn1gA-OK97yMuzLa6uv3_uQ4kmoev-JzTzWYdVGBldIuPYMOvT1LTA7cNgAzY0Ye12tUfZHQCRFjgAaI3fzHrM';
  const KEY='lagerPushDevice';
  let setupPromise,queue=Promise.resolve(),activeUid=null;
  const status=message=>{const node=document.getElementById('pushInfo');if(node)node.textContent=message;};
  const saved=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'null');}catch(_){return null;}};
  function script(src){return new Promise((resolve,reject)=>{const el=document.createElement('script');el.src=src;el.onload=resolve;el.onerror=()=>reject(new Error('Programmbibliothek konnte nicht geladen werden.'));document.head.append(el);});}
  async function setup(){
    if(!setupPromise)setupPromise=(async()=>{
      await script('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');
      if(!await firebase.messaging.isSupported())throw new Error('Dieser Browser unterstützt keine Push-Nachrichten. Auf dem iPhone: Seite zum Home-Bildschirm hinzufügen und von dort öffnen.');
      await script('https://www.gstatic.com/firebasejs/9.23.0/firebase-functions-compat.js');
      const registration=await navigator.serviceWorker.register(new URL('firebase-messaging-sw.js',location.href),{scope:new URL('./',location.href).pathname});
      await new Promise((resolve,reject)=>{
        const worker=registration.installing||registration.waiting||registration.active;
        if(worker?.state==='activated')return resolve();
        const timeout=setTimeout(()=>reject(new Error('Benachrichtigungsdienst konnte nicht gestartet werden. Bitte erneut versuchen.')),20000);
        worker?.addEventListener('statechange',()=>{if(worker.state==='activated'){clearTimeout(timeout);resolve();}else if(worker.state==='redundant'){clearTimeout(timeout);reject(new Error('Benachrichtigungsdienst konnte nicht gestartet werden.'));}});
      });
      const messaging=firebase.messaging();
      messaging.onMessage(payload=>{if(activeUid)registration.showNotification(payload.notification?.title||'Lagermanager',{body:payload.notification?.body||'',icon:'favicon.png',data:{url:payload.data?.url||payload.fcmOptions?.link||payload.fcm_options?.link||'index.html'}});});
      return {registration,messaging,call:(name,data)=>firebase.app().functions('europe-west1').httpsCallable(name)(data)};
    })().catch(error=>{setupPromise=null;throw error;});
    return setupPromise;
  }
  function enqueue(fn){const result=queue.then(fn);queue=result.catch(()=>{});return result;}
  async function bind(uid){
    const service=await setup();
    const token=await service.messaging.getToken({vapidKey:VAPID,serviceWorkerRegistration:service.registration});
    if(!token)throw new Error('Gerät konnte nicht registriert werden.');
    if(firebase.auth().currentUser?.uid!==uid)throw new Error('Anmeldung hat sich geändert. Bitte erneut versuchen.');
    await service.call('lagerRegisterPush',{token});
    localStorage.setItem(KEY,JSON.stringify({token,uid}));activeUid=uid;
    status('Benachrichtigungen sind auf diesem Gerät aktiviert.');
    return {service,token};
  }
  async function disable(){
    const device=saved();
    if(device&&firebase.auth().currentUser){const service=await setup();await service.call('lagerUnregisterPush',{token:device.token});await service.messaging.deleteToken();}
    localStorage.removeItem(KEY);activeUid=null;
    const registration=await navigator.serviceWorker?.getRegistration(new URL('./',location.href).href);
    if(registration)for(const notification of await registration.getNotifications())notification.close();
    status('Benachrichtigungen sind auf diesem Gerät ausgeschaltet.');
  }
  function boot(){
    const auth=firebase.auth();
    const enable=document.getElementById('pushEnable'),off=document.getElementById('pushDisable'),test=document.getElementById('pushTest');
    const run=fn=>enqueue(fn).catch(error=>status(error.message||'Aktion fehlgeschlagen. Bitte erneut versuchen.'));
    if(enable)enable.onclick=()=>{
      if(!('Notification' in window))return status('Auf dem iPhone: Seite zum Home-Bildschirm hinzufügen und von dort öffnen.');
      // Request synchronously in the click handler, before loading libraries (iOS requirement).
      const permission=Notification.requestPermission();
      run(async()=>{if(await permission!=='granted')throw new Error('Benachrichtigungen wurden nicht erlaubt. Prüfe die Browser- oder Smartphone-Einstellungen.');const uid=auth.currentUser?.uid;if(!uid)throw new Error('Bitte anmelden.');status('Gerät wird eingerichtet …');await bind(uid);});
    };
    if(off)off.onclick=()=>run(disable);
    if(test)test.onclick=()=>run(async()=>{const device=saved();if(!device||device.uid!==auth.currentUser?.uid)throw new Error('Bitte zuerst Benachrichtigungen aktivieren.');const service=await setup();await service.call('lagerTestPush',{token:device.token});status('Testnachricht versendet. Prüfe die Benachrichtigungen auf deinem Smartphone.');});
    LagerAccess.onAuthStateChanged(user=>{
      activeUid=null;
      if(!user)return;
      const device=saved();
      if(device&&device.uid===user.uid&&'Notification' in window&&Notification.permission==='granted'&&LagerAccess.write('kabellager'))run(()=>bind(user.uid));
      else status('Benachrichtigungen sind auf diesem Gerät noch nicht aktiviert.');
      if(enable)enable.disabled=!LagerAccess.write('kabellager');
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();

