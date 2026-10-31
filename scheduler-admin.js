(function(){
'use strict';
const MASTER='pmyu29TlC3QM7JIysmy2EmiHSWW2';
const panel=document.getElementById('schedulerPanel');
const list=document.getElementById('schedulerJobs');
const status=document.getElementById('schedulerStatus');
const api=firebase.app().functions('europe-west1');
const read=api.httpsCallable('lagerSchedulerStatus');
const write=api.httpsCallable('lagerSchedulerSet');
const groups=[
 ['bobinen','Bobinen-Erinnerungen','Prüfung alle 15 Minuten an Werktagen'],
 ['fahrzeuge','Fahrzeug-Erinnerungen','Montag–Donnerstag 17:10 Uhr, Freitag 11:55 Uhr'],
 ['service','Fahrzeugservice','Tägliche Service-Erinnerung'],
 ['bereinigung','Fahrzeug-Bereinigung','Tägliche Bereinigung um 03:15 Uhr']
];
function message(value){status.textContent=value;}
async function refresh(){
 message('Status wird geladen …');
 try{
  const data=(await read()).data.groups;
  list.replaceChildren();
  for(const [key,title,description] of groups){
   const jobs=data[key]||[];
   const ready=jobs.length>0&&jobs.every(job=>job.found);
   const active=ready&&jobs.every(job=>job.state==='ENABLED');
   const paused=ready&&jobs.every(job=>job.state==='PAUSED');
   const row=document.createElement('div');row.className='scheduler-row';
   const info=document.createElement('div');
   const heading=document.createElement('strong');heading.textContent=title;
   const details=document.createElement('small');
   details.textContent=description+' · '+(active?'Aktiv':paused?'Pausiert':ready?'Unterschiedliche Zustände':'Nicht verfügbar');
   info.append(heading,details);
   const button=document.createElement('button');
   button.type='button';button.textContent=active?'Pausieren':'Aktivieren';
   if(active)button.className='pause';
   button.disabled=!ready;
   button.addEventListener('click',async()=>{
    const enabled=!active;
    if(!confirm(title+' wirklich '+(enabled?'aktivieren':'pausieren')+'?'))return;
    button.disabled=true;message('Änderung wird ausgeführt …');
    try{await write({group:key,enabled});await refresh();message('Änderung gespeichert.');}
    catch(error){await refresh();message('Fehler: '+(error.message||'Aktion fehlgeschlagen'));}
   });
   row.append(info,button);list.append(row);
  }
  message('');
 }catch(error){message('Status konnte nicht geladen werden: '+(error.message||'Unbekannter Fehler'));}
}
firebase.auth().onAuthStateChanged(user=>{
 if(!user||user.uid!==MASTER){panel.hidden=true;return;}
 panel.hidden=false;refresh();
});
})();
