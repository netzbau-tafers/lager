(function(){
  'use strict';
  const db=firebase.firestore(),list=document.getElementById('userList'),status=document.getElementById('userStatus'),search=document.getElementById('userSearch'),refresh=document.getElementById('userRefresh');
  let rows=[],busy=false;
  const functions=firebase.app().functions("europe-west1");
  const listAccounts=functions.httpsCallable("lagerListUsers"),deleteAccount=functions.httpsCallable("lagerDeleteUser");
  const clean=value=>String(value||'').replace(/[<>]/g,'').replace(/[\u0000-\u001F\u007F]/g,' ').replace(/\s+/g,' ').trim().slice(0,120);
  function text(tag,value){const node=document.createElement(tag);node.textContent=value;return node;}
  function render(){
    list.replaceChildren();const query=search.value.toLocaleLowerCase('de-CH');
    const filtered=rows.filter(row=>[row.id,row.username,row.email].some(value=>String(value||'').toLocaleLowerCase('de-CH').includes(query)));
    if(!filtered.length){list.append(text('p','Keine Benutzerprofile gefunden.'));return;}
    for(const row of filtered){
      const master=row.id===LagerAccess.MASTER,card=text('article','');card.className='user-card';
      card.append(text('h2',(row.username||row.email||'Benutzer ohne Namen')+(master?' · Master-Admin':'')));
      const date=row.lastSeenAt?.toDate?.();const meta=text('p',(row.email||'Keine E-Mail hinterlegt')+' · UID: '+row.id+' · Letzte Aktivität: '+(date?date.toLocaleString('de-CH'):'Noch nicht erfasst'));meta.className='user-meta';card.append(meta);
      const label=text('label','Benutzername');const input=document.createElement('input');input.type='text';input.maxLength=120;input.value=row.username||'';label.append(input);card.append(label);
      const grid=document.createElement('div');grid.className='permission-grid';const selects={};
      const permissions={...LagerAccess.defaults(row.id),...row.access?.permissions};if(row.access&&!('beendete' in row.access.permissions))permissions.beendete=LagerAccess.defaults(row.id).beendete==='edit'&&permissions.baustellen==='edit'?'edit':'none';if(row.access&&!('materialvorlagen' in row.access.permissions))permissions.materialvorlagen=LagerAccess.defaults(row.id).materialvorlagen==='edit'&&permissions.baustellen==='edit'?'edit':'none';
      for(const [key,name]of Object.entries(LagerAccess.areas)){const label=text('label',name),select=document.createElement('select');for(const [value,title]of (['materialvorlagen','beendete'].includes(key)?[['none','Nicht erlaubt'],['edit',key==='beendete'?'Archivieren, bearbeiten, wiederherstellen und löschen':'Erstellen, bearbeiten und löschen']]:[['none','Gesperrt'],['view','Nur ansehen'],['edit','Ansehen und bearbeiten']])){const option=text('option',title);option.value=value;select.append(option);}select.value=master?'edit':permissions[key]||'none';select.disabled=master;selects[key]=select;label.append(select);grid.append(label);}
      card.append(grid);const save=text('button','Änderungen speichern');save.type='button';const feedback=text('p','');feedback.className='user-feedback';feedback.setAttribute('role','status');card.append(save,feedback);
      const remove=text('button','Konto löschen');remove.type='button';remove.className='delete-account';remove.disabled=master;remove.title=master?'Das Master-Admin-Konto ist geschützt.':'Anmeldekonto dauerhaft löschen';card.insertBefore(remove,feedback);
      remove.addEventListener('click',async()=>{
        if(master)return;
        const answer=prompt('Konto dauerhaft löschen?\n\n'+(row.email||row.username||row.id)+'\nUID: '+row.id+'\n\nDas Anmeldekonto, Profil und die Rechte werden gelöscht. Baustellen und Protokolle bleiben erhalten.\n\nZum Bestätigen bitte LÖSCHEN eingeben.');
        if(answer?.trim().toLocaleUpperCase('de-CH')!=='LÖSCHEN')return;
        save.disabled=true;remove.disabled=true;refresh.disabled=true;feedback.textContent='Konto wird gelöscht …';
        try{const result=await deleteAccount({uid:row.id,confirmUid:row.id});if(result.data?.deleted!==true||result.data.uid!==row.id)throw Error('Ungültige Serverantwort');rows=rows.filter(entry=>entry.id!==row.id);render();status.textContent='Konto gelöscht.';}catch(error){console.error(error);feedback.style.color='#b3261e';feedback.textContent='Löschen fehlgeschlagen. Prüfe, ob lagerDeleteUser in Firebase veröffentlicht ist. Bei einem Serverfehler kann das Konto bereits gesperrt oder gelöscht sein; bitte erneut versuchen.';}finally{save.disabled=false;remove.disabled=false;refresh.disabled=false;}
      });
      save.addEventListener('click',async()=>{
        save.disabled=true;remove.disabled=true;feedback.textContent='Wird gespeichert …';
        try{
          // Profile names and access rights change atomically; metadata stays intact.
          const batch=db.batch(),timestamp=firebase.firestore.FieldValue.serverTimestamp(),username=clean(input.value);
          batch.set(db.collection('users').doc(row.id),{username,updatedAt:timestamp},{merge:true});
          const selected=Object.fromEntries(Object.entries(selects).map(([key,select])=>[key,select.value]));
          if(!master)batch.set(db.collection('user_access').doc(row.id),{permissions:selected,updatedAt:timestamp,updatedBy:auth.currentUser.uid});
          await batch.commit();row.username=username;if(!master)row.access={permissions:selected};input.value=username;feedback.style.color='#1b5e20';feedback.textContent='Gespeichert. Zugriffsänderungen werden auf geöffneten Seiten übernommen.';
        }catch(error){console.error(error);feedback.style.color='#b3261e';feedback.textContent='Speichern fehlgeschlagen. Prüfe, ob die neuen Firestore-Regeln veröffentlicht sind.';}finally{save.disabled=false;remove.disabled=master;}
      });list.append(card);
    }
  }
  async function load(){
    if(busy)return;busy=true;refresh.disabled=true;status.textContent='Benutzer werden geladen …';
    try{
      const [profiles,access]=await Promise.all([db.collection('users').get(),db.collection('user_access').get()]);
      const profileMap=new Map(profiles.docs.map(doc=>[doc.id,doc.data()])),accessMap=new Map(access.docs.map(doc=>[doc.id,doc.data()]));
      let complete=true,accounts=[];
      try{let pageToken;const seen=new Set();do{const result=await listAccounts(pageToken?{pageToken}:{});if(!Array.isArray(result.data?.users))throw Error('Ungültige Benutzerliste');accounts.push(...result.data.users);pageToken=result.data.pageToken;if(pageToken){if(seen.has(pageToken))throw Error('Wiederholter Seitenschlüssel');seen.add(pageToken);}}while(pageToken);}
      catch(error){console.error(error);complete=false;accounts=profiles.docs.map(doc=>({uid:doc.id,email:doc.data().email||''}));}
      rows=accounts.map(account=>({...profileMap.get(account.uid),id:account.uid,email:account.email,username:profileMap.get(account.uid)?.username||account.displayName||'',access:accessMap.get(account.uid)})).sort((a,b)=>String(a.username||a.email||a.id).localeCompare(String(b.username||b.email||b.id),'de-CH'));
      status.textContent=complete?rows.length+' registrierte Konten':rows.length+' Benutzerprofile – unvollständige Liste. Bitte lagerListUsers in Firebase veröffentlichen.';render();
    }catch(error){console.error(error);list.replaceChildren();status.textContent='Benutzer konnten nicht geladen werden. Bitte zuerst die neuen Firestore-Regeln veröffentlichen.';}
    finally{busy=false;refresh.disabled=false;}
  }
  search.addEventListener('input',render);refresh.addEventListener('click',load);
  LagerAccess.onAuthStateChanged(user=>{if(!user){location.replace('home.html');return;}document.getElementById('userAdmin').hidden=false;return load();});
})();
