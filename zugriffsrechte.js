/* Access decisions are also enforced by firestore.rules. */
(function(){
  'use strict';
  const MASTER='pmyu29TlC3QM7JIysmy2EmiHSWW2';
  const ADMINS=['smnnQd4RhEQZR3uuNN0otNALUqi1',MASTER,'PAtM8Lv1TBNLSiQzBLJK9Oda8KK2','hwZEme8xvkasSAGrmOtQRLOnnXn1','PKDpb7Cb7ig8ZKZRMm23FOKnCHQ2','Tgj9KT6C21XjeistBWRiSVYqTDC2','DSMERv7Uu4b4eEYQx5SKbjvdher2'];
  const LIMITED=['POSB6W7xeDZ8Dlba03ZP3J02dMC3','AX08qKp7lte6vslQMFn76FVqxw53','KYqiqNKTmkQQYVWAa6bp6vSvTlV2'];
  const areas={kabellager:'Kabellager',baustellen:'Baustellenmaterial und Vorlagen',archiv:'Archiv',kabelreport:'Kabel Report',logs:'Protokoll',spiel:'Mast Runner'};
  const pages={'index.html':'kabellager','baustellen.html':'baustellen','archiv.html':'archiv','kabel-report.html':'kabelreport','logs.html':'logs','strommast-game.html':'spiel','gespart.html':'gespart','benutzer.html':'benutzer'};
  let uid=null,permissions={},configured=false,ready=null,unsubscribe=null,profileUnsubscribe=null;
  function defaults(id){const admin=ADMINS.includes(id),limited=LIMITED.includes(id);return {kabellager:'edit',baustellen:limited?'none':'edit',archiv:admin?'edit':'none',kabelreport:admin?'edit':'view',logs:admin?'edit':'none',spiel:'edit',gespart:'edit'};}
  function level(area){if(!uid)return 'none';if(uid===MASTER)return 'edit';if(area==='benutzer')return 'none';return permissions[area]||'none';}
  function read(area){return ['view','edit'].includes(level(area));}
  function write(area){return level(area)==='edit';}
  function page(){return pages[location.pathname.split('/').pop()||'index.html'];}
  function checkPage(){const area=page();if(area&&!read(area)){location.replace('home.html');return false;}return true;}
  function apply(){
    const menu=document.getElementById('dropdownMenu');
    if(menu){
      if(uid===MASTER&&!menu.querySelector('[data-page="benutzer"]')){const link=document.createElement('a');link.href='benutzer.html';link.dataset.page='benutzer';link.textContent='Benutzerverwaltung';menu.insertBefore(link,menu.querySelector('.logout-safe'));}
      const keys={index:'kabellager',baustellen:'baustellen',archiv:'archiv',kabelreport:'kabelreport',logs:'logs',benutzer:'benutzer'};
      for(const node of menu.querySelectorAll('[data-page]')){const area=keys[node.dataset.page];if(area)node.style.display=read(area)?'inline-flex':'none';}
      // Capture navigation so older inline administrator checks cannot deny assigned access.
      if(!menu.dataset.accessReady){menu.dataset.accessReady='true';menu.addEventListener('click',event=>{const node=event.target.closest('[data-page]');const key=node?.dataset.page;if(!keys[key])return;event.preventDefault();event.stopImmediatePropagation();if(read(keys[key]))location.href=key==='index'?'index.html':key==='kabelreport'?'kabel-report.html':key+'.html';},true);}
    }
    for(const link of document.querySelectorAll('a[href]')){const area=pages[link.getAttribute('href').split('?')[0]];if(area)link.hidden=!read(area);}
    for(const node of document.querySelectorAll('[data-access-write]')){const disabled=!write(node.dataset.accessWrite);node.hidden=disabled;if('disabled' in node)node.disabled=disabled;}
    const area=page();if(area&&read(area)&&!write(area)&&!document.getElementById('accessReadOnly')){const note=document.createElement('p');note.id='accessReadOnly';note.textContent='Nur ansehen: Du hast für diesen Bereich keine Bearbeitungsrechte.';note.setAttribute('role','status');(document.querySelector('main')||document.getElementById('appContent')||document.body).prepend(note);}
  }
  function load(user){
    if(uid===user?.uid&&ready)return ready;
    uid=user?.uid||null;configured=false;permissions={};unsubscribe?.();profileUnsubscribe?.();
    try{localStorage.removeItem('lagerUsername')}catch(_){}
    if(!user){ready=Promise.resolve();return ready;}
    const db=firebase.firestore();const currentUid=uid;
    ready=new Promise((resolve,reject)=>{
      let first=true;
      unsubscribe=db.collection('user_access').doc(uid).onSnapshot(snapshot=>{
        if(uid!==currentUid)return;
        configured=snapshot.exists;
        permissions=configured?(snapshot.data().permissions||{}):defaults(uid);
        if(first){first=false;resolve();}else{if(!checkPage())return;location.reload();}
      },error=>{permissions={};reject(error);});
    });
    const profileReady=new Promise((resolve,reject)=>{profileUnsubscribe=db.collection('users').doc(uid).onSnapshot(snapshot=>{if(uid!==currentUid)return;const name=String(snapshot.data()?.username||'').trim();try{if(name)localStorage.setItem('lagerUsername',name);else localStorage.removeItem('lagerUsername')}catch(_){};if(location.pathname.endsWith('profil.html')){const input=document.getElementById('usernameInput');if(input&&document.activeElement!==input)input.value=name;}resolve();},reject);});
    ready=Promise.all([ready,profileReady]);
    db.collection('users').doc(uid).set({email:user.email||'',lastSeenAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true}).catch(error=>console.error('Aktivität konnte nicht gespeichert werden',error));
    return ready;
  }
  function onAuthStateChanged(callback){return firebase.auth().onAuthStateChanged(async user=>{try{await load(user);if(firebase.auth().currentUser?.uid!==user?.uid)return;if(user&&!checkPage())return;await callback(user);apply();}catch(error){console.error('Berechtigungen konnten nicht geladen werden',error);document.body.style.display='block';const main=document.getElementById('appContent');if(main)main.style.display='none';let note=document.getElementById('accessError');if(!note){note=document.createElement('p');note.id='accessError';document.body.prepend(note);}note.textContent='Berechtigungen konnten nicht geladen werden. Bitte veröffentliche zuerst die neuen Firestore-Regeln und lade die Seite erneut.';}});}
  function requireWrite(area){if(write(area))return true;alert('Du hast für diesen Bereich nur Leserechte oder keinen Zugriff.');return false;}
  function manager(area,id){return write(area)&&(id===MASTER||configured||ADMINS.includes(id));}
  window.LagerAccess={MASTER,areas,defaults,read,write,manager,requireWrite,onAuthStateChanged,apply,load};
  document.addEventListener('DOMContentLoaded',()=>{apply();const root=document.getElementById('appContent')||document.body;let queued=false;new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;/* Only new controls; avoid observing our own attribute writes. */for(const node of root.querySelectorAll('[data-access-write]')){const disabled=!write(node.dataset.accessWrite);node.hidden=disabled;if('disabled'in node)node.disabled=disabled;}});}).observe(root,{childList:true,subtree:true});});
})();
