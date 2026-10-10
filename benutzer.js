(function(){
  'use strict';
  const db=firebase.firestore(),list=document.getElementById('userList'),status=document.getElementById('userStatus'),search=document.getElementById('userSearch'),refresh=document.getElementById('userRefresh');
  let rows=[],busy=false,pushStatusAvailable=false;
  const functions=firebase.app().functions("europe-west1");
  const listAccounts=functions.httpsCallable("lagerListUsers"),deleteAccount=functions.httpsCallable("lagerDeleteUser");
  const generateResetLink=functions.httpsCallable("lagerPasswordResetLink");
  const clean=value=>String(value||'').replace(/[<>]/g,'').replace(/[\u0000-\u001F\u007F]/g,' ').replace(/\s+/g,' ').trim().slice(0,120);
  function text(tag,value){const node=document.createElement(tag);node.textContent=value;return node;}
  function colorPermission(select){
    const update=()=>{select.dataset.permission=select.value;};
    select.addEventListener('change',update);
    update();
  }
  const permissionGroups=[
    {title:'Fahrzeuge',description:'Fahrzeugseite und Fahrzeugaktionen in Meine Übersicht',keys:['fahrzeuge','fahrzeugeUebernehmen','fahrzeugeErstellen']},
    {title:'Fahrtenbuch',description:'Nutzungs- und Tankverlauf sowie Export und Aufräumen auf der Fahrtenbuchseite',keys:['fahrtenbuch','fahrtenbuchExport']},
    {title:'Baustellenmaterial und Archiv',description:'Materialvorlagen und beendete Baustellen gehören zum Baustellenmaterial; das Archiv hat eine eigene Seite.',keys:['baustellen','materialvorlagen','beendete','archiv']},
    {title:'Kabellager',keys:['kabellager']},
    {title:'Berichte und Protokoll',description:'Separate Seiten für Kabel Report und Protokoll',keys:['kabelreport','logs']},
    {title:'Spiel',keys:['spiel']}
  ];
  function groupPermissions(container){
    container.className='permission-groups';
    const grids={};
    const known=new Set(permissionGroups.flatMap(group=>group.keys));
    const extra=Object.keys(LagerAccess.areas).filter(key=>!known.has(key));
    for(const group of [...permissionGroups,...(extra.length?[{title:'Weitere Berechtigungen',keys:extra}]:[])]){
      const keys=group.keys.filter(key=>key in LagerAccess.areas);
      if(!keys.length)continue;
      const fieldset=document.createElement('fieldset');fieldset.className='permission-group';
      fieldset.append(text('legend',group.title));
      if(group.description){const note=text('p',group.description);note.className='permission-group-note';fieldset.append(note);}
      const grid=document.createElement('div');grid.className='permission-grid';fieldset.append(grid);container.append(fieldset);
      for(const key of keys)grids[key]=grid;
    }
    return grids;
  }
  const titles={hauptadministrator:'Hauptadministrator',administrator:'Administrator',baustellenverantwortlicher:'Baustellenverantwortlicher',mitarbeiter:'Mitarbeiter',techniker:'Techniker',leseberechtigter:'Leseberechtigter'};
  const titleOrder=Object.keys(titles);
  function effectivePermissions(row){
    const defaults=LagerAccess.defaults(row.id),permissions={...defaults,...row.access?.permissions};
    for(const key of ['beendete','materialvorlagen']){
      if(row.access&&!(key in (row.access.permissions||{})))permissions[key]=defaults[key]==='edit'&&permissions.baustellen==='edit'?'edit':'none';
    }
    return permissions;
  }
  function titleFor(row){
    if(row.id===LagerAccess.MASTER)return 'hauptadministrator';
    if(titleOrder.includes(row.adminTitle)&&row.adminTitle!=='hauptadministrator')return row.adminTitle;
    const p=effectivePermissions(row);
    if(['kabellager','baustellen','archiv','materialvorlagen','beendete'].every(key=>p[key]==='edit'))return 'administrator';
    if(p.baustellen==='edit'&&p.beendete==='edit')return 'baustellenverantwortlicher';
    if(Object.entries(p).some(([key,value])=>key!=='spiel'&&value==='edit'))return 'mitarbeiter';
    return 'leseberechtigter';
  }
  function compareUsers(a,b){
    return titleOrder.indexOf(titleFor(a))-titleOrder.indexOf(titleFor(b))||
      String(a.username||a.email||a.id).localeCompare(String(b.username||b.email||b.id),'de-CH')||
      a.id.localeCompare(b.id);
  }
  function render(){
    list.replaceChildren();const query=search.value.toLocaleLowerCase('de-CH');
    const filtered=rows.filter(row=>[row.id,row.username,row.email,titles[titleFor(row)]].some(value=>String(value||'').toLocaleLowerCase('de-CH').includes(query))).sort(compareUsers);
    if(!filtered.length){list.append(text('p','Keine Benutzerprofile gefunden.'));return;}
    for(const row of filtered){
      const master=row.id===LagerAccess.MASTER,card=text('article','');card.className='user-card';
      card.append(text('h2',(row.username||row.email||'Benutzer ohne Namen')+' · '+titles[titleFor(row)]));
      const date=row.lastSeenAt?.toDate?.();const meta=text('p',(row.email||'Keine E-Mail hinterlegt')+' · UID: '+row.id+' · Letzte Aktivität: '+(date?date.toLocaleString('de-CH'):'Noch nicht erfasst'));meta.className='user-meta';card.append(meta);
      const preference=row.pushPreference,activeUntil=preference?.activeUntil?.toMillis?.();
      const pushState=!pushStatusAvailable?'unknown':preference?.enabled===true?(Number.isFinite(activeUntil)?(activeUntil>Date.now()?'enabled':'expired'):'unknown'):'disabled';
      const pushLabels={enabled:'Aktiviert',disabled:'Nicht aktiviert',expired:'Registrierung abgelaufen',unknown:'Status nicht verfügbar'};
      const pushStatus=text('p','Benachrichtigungen: '+pushLabels[pushState]);pushStatus.className='user-push-status';pushStatus.dataset.state=pushState;
      pushStatus.title='Gespeicherter Status für mindestens ein Gerät. Änderungen in den Browser- oder Smartphone-Einstellungen sind nicht immer erkennbar.';card.append(pushStatus);
      const label=text('label','Benutzername');const input=document.createElement('input');input.type='text';input.maxLength=120;input.value=row.username||'';label.append(input);card.append(label);
      const titleLabel=text('label','Titel'),titleSelect=document.createElement('select');
      titleSelect.style.cssText='width:100%;max-width:100%;min-width:0;padding:10px;border:1px solid #ccd5df;border-radius:8px;background:white;font:inherit;margin:6px 0 12px';
      for(const [value,name] of Object.entries(titles)){
        if(!master&&value==='hauptadministrator')continue;
        const option=text('option',name);option.value=value;titleSelect.append(option);
      }
      titleSelect.value=titleFor(row);titleSelect.disabled=master;titleLabel.append(titleSelect);card.append(titleLabel);
      const grid=document.createElement('div');grid.className='permission-grid';const selects={},groupGrids=groupPermissions(grid);
      const permissions=effectivePermissions(row);
      for(const [key,name]of Object.entries(LagerAccess.areas)){const label=text('label',name),select=document.createElement('select');for(const [value,title]of (['fahrtenbuch','fahrtenbuchExport'].includes(key)?[['none','Gesperrt'],['edit','Ansehen und bearbeiten']]:['materialvorlagen','beendete','fahrzeugeErstellen','fahrzeugeUebernehmen'].includes(key)?[['none','Nicht erlaubt'],['edit',key==='fahrzeugeUebernehmen'?'Belegte Fahrzeuge übernehmen':key==='fahrzeugeErstellen'?'Neue Fahrzeuge hinzufügen':key==='beendete'?'Archivieren, bearbeiten, wiederherstellen und löschen':'Erstellen, bearbeiten und löschen']]:[['none','Gesperrt'],['view','Nur ansehen'],['edit','Ansehen und bearbeiten']])){const option=text('option',title);option.value=value;select.append(option);}select.value=master?'edit':permissions[key]||'none';select.disabled=master;colorPermission(select);selects[key]=select;label.append(select);groupGrids[key].append(label);}
      const permissionsPanel=document.createElement('details');permissionsPanel.className='permissions-panel';permissionsPanel.append(text('summary','Berechtigungen'),grid);card.append(permissionsPanel);const save=text('button','Änderungen speichern');save.type='button';const feedback=text('p','');feedback.className='user-feedback';feedback.setAttribute('role','status');card.append(save,feedback);
      const remove=text('button','Konto löschen');remove.type='button';remove.className='delete-account';remove.disabled=master;remove.title=master?'Das Hauptadministrator-Konto ist geschützt.':'Anmeldekonto dauerhaft löschen';card.insertBefore(remove,feedback);
      if(auth.currentUser?.uid===LagerAccess.MASTER){
        const reset=text('button','Passwort zurücksetzen');reset.type='button';
        const icon=document.createElement('i');icon.className='fa-solid fa-key';icon.setAttribute('aria-hidden','true');reset.prepend(icon);
        reset.disabled=!row.email;reset.title='Link zum Zurücksetzen erzeugen';card.insertBefore(reset,feedback);
        const linkPanel=document.createElement('div');linkPanel.hidden=true;
        const linkLabel=text('label','Passwort-Link für '+(row.email||row.username||row.id));
        const linkInput=document.createElement('input');linkInput.type='text';linkInput.readOnly=true;linkInput.style.width='100%';linkInput.style.boxSizing='border-box';
        linkLabel.append(linkInput);const copy=text('button','Link kopieren');copy.type='button';
        linkPanel.append(linkLabel,copy);card.insertBefore(linkPanel,feedback);
        copy.addEventListener('click',async()=>{
          try{await navigator.clipboard.writeText(linkInput.value);feedback.textContent='Passwort-Link kopiert.';}
          catch(_){linkInput.focus();linkInput.select();feedback.textContent='Bitte den markierten Link kopieren.';}
        });
        reset.addEventListener('click',async()=>{
          if(reset.disabled||auth.currentUser?.uid!==LagerAccess.MASTER)return;
          reset.disabled=true;linkPanel.hidden=true;linkInput.value='';feedback.style.color='';feedback.textContent='Passwort-Link wird erstellt …';
          try{
            const result=await generateResetLink({uid:row.id}),data=result.data;
            if(data?.uid!==row.id||typeof data.resetLink!=='string'||!data.resetLink.startsWith('https://'))throw Error('Ungültige Serverantwort');
            linkInput.value=data.resetLink;linkPanel.hidden=false;
            feedback.style.color='#1b5e20';feedback.textContent='Link für '+data.email+' erstellt. Kopiere ihn und sende ihn der Person. Es wurde keine E-Mail versendet.';
          }catch(error){
            feedback.style.color='#b3261e';
            feedback.textContent=['functions/not-found','functions/failed-precondition','functions/permission-denied'].includes(error.code)?error.message:'Der Passwort-Link konnte nicht erstellt werden. Prüfe, ob lagerPasswordResetLink in Firebase veröffentlicht ist.';
          }finally{reset.disabled=!row.email;}
        });
      }
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
          batch.set(db.collection('users').doc(row.id),{username,adminTitle:master?'hauptadministrator':titleSelect.value,updatedAt:timestamp},{merge:true});
          const selected=Object.fromEntries(Object.entries(selects).map(([key,select])=>[key,select.value]));
          if(!master)batch.set(db.collection('user_access').doc(row.id),{permissions:selected,updatedAt:timestamp,updatedBy:auth.currentUser.uid});
          await batch.commit();row.username=username;row.adminTitle=master?'hauptadministrator':titleSelect.value;if(!master)row.access={permissions:selected};input.value=username;feedback.style.color='#1b5e20';render();status.textContent='Gespeichert. Die Liste wurde nach Titel sortiert.';
        }catch(error){console.error(error);feedback.style.color='#b3261e';feedback.textContent='Speichern fehlgeschlagen. Prüfe, ob die neuen Firestore-Regeln veröffentlicht sind.';}finally{save.disabled=false;remove.disabled=master;}
      });list.append(card);
    }
  }
  async function load(){
    if(busy)return;busy=true;refresh.disabled=true;status.textContent='Benutzer werden geladen …';
    try{
      const [profiles,access]=await Promise.all([db.collection('users').get(),db.collection('user_access').get()]);
      const profileMap=new Map(profiles.docs.map(doc=>[doc.id,doc.data()])),accessMap=new Map(access.docs.map(doc=>[doc.id,doc.data()]));
      let pushMap=new Map();pushStatusAvailable=false;
      try{const preferences=await db.collection('push_preferences').get();pushMap=new Map(preferences.docs.map(doc=>[doc.id,doc.data()]));pushStatusAvailable=true;}
      catch(error){console.error('Benachrichtigungsstatus konnte nicht geladen werden.',error);}
      let complete=true,accounts=[];
      try{let pageToken;const seen=new Set();do{const result=await listAccounts(pageToken?{pageToken}:{});if(!Array.isArray(result.data?.users))throw Error('Ungültige Benutzerliste');accounts.push(...result.data.users);pageToken=result.data.pageToken;if(pageToken){if(seen.has(pageToken))throw Error('Wiederholter Seitenschlüssel');seen.add(pageToken);}}while(pageToken);}
      catch(error){console.error(error);complete=false;accounts=profiles.docs.map(doc=>({uid:doc.id,email:doc.data().email||''}));}
      rows=accounts.map(account=>({...profileMap.get(account.uid),id:account.uid,email:account.email,username:profileMap.get(account.uid)?.username||account.displayName||'',access:accessMap.get(account.uid),pushPreference:pushMap.get(account.uid)})).sort((a,b)=>String(a.username||a.email||a.id).localeCompare(String(b.username||b.email||b.id),'de-CH'));
      status.textContent=complete?rows.length+' registrierte Konten':rows.length+' Benutzerprofile – unvollständige Liste. Bitte lagerListUsers in Firebase veröffentlichen.';render();
    }catch(error){console.error(error);list.replaceChildren();status.textContent='Benutzer konnten nicht geladen werden. Bitte zuerst die neuen Firestore-Regeln veröffentlichen.';}
    finally{busy=false;refresh.disabled=false;}
  }
  const createAccount=functions.httpsCallable('lagerCreateUser'),newForm=document.getElementById('newUserForm'),newStatus=document.getElementById('newUserStatus'),newSubmit=document.getElementById('newUserSubmit'),newResult=document.getElementById('newUserResult'),newLink=document.getElementById('newUserLink'),newSelects={};
  const newGroupGrids=groupPermissions(document.getElementById('newUserPermissions'));
  for(const [key,name]of Object.entries(LagerAccess.areas)){
    const label=text('label',name),select=document.createElement('select');
    const choices=['fahrtenbuch','fahrtenbuchExport'].includes(key)?[['none','Gesperrt'],['edit','Ansehen und bearbeiten']]:['materialvorlagen','beendete','fahrzeugeErstellen','fahrzeugeUebernehmen'].includes(key)?[['none','Nicht erlaubt'],['edit','Erlaubt']]:[['none','Gesperrt'],['view','Nur ansehen'],['edit','Ansehen und bearbeiten']];
    for(const [value,title]of choices){const option=text('option',title);option.value=value;select.append(option);}
    colorPermission(select);
    newSelects[key]=select;label.append(select);newGroupGrids[key].append(label);
  }
  let creating=false;
  newForm.addEventListener('submit',async event=>{
    event.preventDefault();if(creating||!newForm.reportValidity())return;
    creating=true;newSubmit.disabled=true;newResult.hidden=true;newLink.value='';newStatus.textContent='Konto wird erstellt …';
    const email=document.getElementById('newUserEmail').value.trim(),username=document.getElementById('newUserName').value.trim(),permissions=Object.fromEntries(Object.entries(newSelects).map(([key,select])=>[key,select.value]));
    try{
      const result=await createAccount({email,username,permissions});if(result.data?.created!==true||!result.data.uid)throw Error('Ungültige Serverantwort');
      newForm.reset();Object.values(newSelects).forEach(select=>{select.dataset.permission=select.value;});newLink.value=result.data.setupLink||'';newResult.hidden=!result.data.setupLink;
      newStatus.textContent=result.data.setupLink?'Konto erstellt. Kopiere den Passwort-Link und gib ihn dem neuen Benutzer weiter.':'Konto erstellt. Der Passwort-Link konnte nicht erzeugt werden. Der Benutzer kann auf der Anmeldeseite sein Passwort zurücksetzen.';
      await load();
    }catch(error){newStatus.textContent=error.code==='functions/already-exists'?'Diese E-Mail hat bereits ein Konto.':error.code==='functions/invalid-argument'?'Bitte E-Mail, Benutzername und Rechte prüfen.':error.code==='functions/internal'?(error.message||'Erstellen fehlgeschlagen. Bitte die Kontoliste prüfen.'):'Erstellen fehlgeschlagen. Prüfe, ob lagerCreateUser in Firebase veröffentlicht ist. Bei einem Verbindungsfehler zuerst die Kontoliste aktualisieren.';}
    finally{creating=false;newSubmit.disabled=false;}
  });
  document.getElementById('newUserCopy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(newLink.value);newStatus.textContent='Passwort-Link kopiert.';}catch(_){newLink.focus();newLink.select();newStatus.textContent='Bitte den markierten Link kopieren.';}});
  search.addEventListener('input',render);refresh.addEventListener('click',load);
  LagerAccess.onAuthStateChanged(user=>{if(!user){location.replace('home.html');return;}document.getElementById('userAdmin').hidden=false;return load();});
})();


