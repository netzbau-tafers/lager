/* Push worker scoped to /lager/, including GitHub Pages project paths. */
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(clients.claim()));
self.addEventListener('notificationclick',event=>{
  event.stopImmediatePropagation();
  event.notification.close();
  const data=event.notification.data||{},message=data.FCM_MSG||{};
  const raw=data.url||message.data?.url||message.fcmOptions?.link||message.fcm_options?.link||message.webpush?.fcm_options?.link||'index.html';
  const url=new URL(raw,self.registration.scope);
  if(url.origin!==self.location.origin||!url.pathname.startsWith(new URL(self.registration.scope).pathname))return;
  // Also route already delivered backfill notifications to their exact confirmation.
  if(url.pathname.endsWith('/fahrzeuge.html')&&url.searchParams.has('nachtrag'))url.pathname=url.pathname.replace(/fahrzeuge\.html$/,'fahrzeug-bestaetigung.html');
  event.waitUntil(clients.openWindow(url.href));
});
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');
firebase.initializeApp({apiKey:'AIzaSyAfmH7jDf1kZQpk-Psbl2kvAvzZj3jGX-w',authDomain:'netzbau-tafers.firebaseapp.com',projectId:'netzbau-tafers',messagingSenderId:'389541837675',appId:'1:389541837675:web:db580ce67c57a9a16dea2e'});
firebase.messaging();

