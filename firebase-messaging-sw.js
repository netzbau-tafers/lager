/* Push worker scoped to /lager/, including GitHub Pages project paths. */
self.addEventListener('notificationclick',event=>{
  event.stopImmediatePropagation();
  event.notification.close();
  const raw=event.notification.data?.url||event.notification.data?.FCM_MSG?.fcmOptions?.link||'index.html';
  const url=new URL(raw,self.registration.scope);
  if(url.origin!==self.location.origin||!url.pathname.startsWith(new URL(self.registration.scope).pathname))return;
  event.waitUntil(clients.openWindow(url.href));
});
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');
firebase.initializeApp({apiKey:'AIzaSyAfmH7jDf1kZQpk-Psbl2kvAvzZj3jGX-w',authDomain:'netzbau-tafers.firebaseapp.com',projectId:'netzbau-tafers',messagingSenderId:'389541837675',appId:'1:389541837675:web:db580ce67c57a9a16dea2e'});
firebase.messaging();
