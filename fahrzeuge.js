(function(){
  'use strict';
  const db=firebase.firestore(),functions=firebase.app().functions('europe-west1');
  const actionCall=functions.httpsCallable('lagerVehicleAction'),createCall=functions.httpsCallable('lagerCreateVehicle'),deleteCall=functions.httpsCallable('lagerDeleteVehicle'),editCall=functions.httpsCallable('lagerEditVehicle');
  const backfillUsersCall=functions.httpsCallable('lagerVehicleBackfillUsers'),backfillCall=functions.httpsCallable('lagerVehicleBackfill'),reviewCall=functions.httpsCallable('lagerVehicleBackfillReview');
  const list=document.getElementById('vehicleList'),status=document.getElementById('vehicleStatus'),search=document.getElementById('vehicleSearch'),onlyFavorites=document.getElementById('onlyFavorites');
  const dialog=document.getElementById('vehicleDialog'),form=document.getElementById('vehicleForm'),fields=document.getElementById('dialogFields'),save=document.getElementById('dialogSave'),cancel=document.getElementById('dialogCancel');
  const overview=Boolean(document.getElementById('myVehiclesSection'));
  let user=null,vehicles=[],favorites=new Set(),unsubVehicles=null,unsubFavorites=null,pending=null,saving=false,selectedScrolled=false;
  const selected=new URLSearchParams(location.search).get('fahrzeug'),scanRequested=!overview&&new URLSearchParams(location.search).get('scan')==='1';
  let ownScrollId=null,ownScrollFrame=null;
  let scanHandled=false,selectedScrollFrame=null,selectedSearch=!overview&&Boolean(selected);
  const busy=new Set(),messages=new Map(),histories=new Map(),openHistory=new Set();
  let unsubBackfills=null,backfills=[],recipientCache=null;
  const inbox=!overview?document.createElement('section'):null;
  if(inbox){inbox.className='vehicle-confirmations';inbox.hidden=true;inbox.setAttribute('aria-label','Fahrzeugnutzung bestätigen');list.before(inbox);}
  function node(tag,value='',className=''){const element=document.createElement(tag);element.textContent=value;if(className)element.className=className;return element;}
  function loading(element,active){element.classList.toggle('vehicle-loading',active);element.setAttribute('aria-busy',String(active));}
  let vehiclesLoading=true,favoritesLoading=true;
  loading(status,true);
  function date(value){return value?.toDate?.().toLocaleString('de-CH',{timeZone:'Europe/Zurich',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})||'–';}
  function km(value){return Number.isSafeInteger(value)?value.toLocaleString('de-CH')+' km':'Nicht hinterlegt';}
  function requestId(){const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);return Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');}
  function errorText(error){
    if(['functions/permission-denied','functions/invalid-argument','functions/failed-precondition','functions/not-found'].includes(error.code))return error.message;
    if(error.code==='permission-denied')return 'Keine Berechtigung. Bitte die Fahrzeugrechte und die veröffentlichten Firestore-Regeln prüfen.';
    return 'Speichern fehlgeschlagen. Bitte den aktuellen Stand prüfen und erneut versuchen. Die Fahrzeugfunktionen müssen in Firebase veröffentlicht sein.';
  }
  function button(label,action,id,className=''){const element=node('button',label,className);element.type='button';element.dataset.action=action;element.dataset.id=id;element.disabled=busy.has(id);return element;}
  const historyPageSize=20;
  function historyList(id){
    const target=[...list.querySelectorAll('[data-history-list]')].find(n=>n.dataset.historyList===id);if(!target)return;
    target.replaceChildren();const data=histories.get(id);loading(target,!data||data.loading);
    if(!data){target.append(node('p','Verlauf wird geladen …'));return;}
    if(data.error)target.append(node('p','Verlauf konnte nicht geladen werden. Bitte erneut versuchen.','vehicle-error'));
    if(!data.entries.length)target.append(node('p',data.loading?'Verlauf wird geladen …':data.error?'': 'Keine Einträge für diese Auswahl.'));
    const ordered=node('ol','','vehicle-history');
    for(const entry of data.entries){
      if(entry.status==='rejected')continue;
      const row=node('li'),name=entry.actor?.name||'Unbekannte Person';
      if(entry.type==='backfill'){
        row.append(node('strong',name+' · Nutzung nachgetragen'),node('p',date(entry.start)+' → '+date(entry.end)),node('p',entry.status==='pending'?'Bestätigung ausstehend':'Bestätigt'),node('small','Nachgetragen von '+(entry.requestedBy?.name||'Unbekannte Person')));
      }
      else if(entry.type==='fuel'){row.append(node('strong','Tanken · '+km(entry.km)),node('p',name+' · '+date(entry.start)));}
      else if(entry.type==='takeover'){row.append(node('strong','Fahrzeug übernommen'),node('p',(entry.from?.name||'Andere Person')+' → '+name),node('p',date(entry.start)));}
      else{row.append(node('strong',name+' · '+(entry.type==='day'?'Nutzung nachgetragen':'In Gebrauch')),node('p',date(entry.start)+' → '+(entry.end?date(entry.end):'Noch in Gebrauch')));if(entry.takenOverBy)row.append(node('p','Durch '+entry.takenOverBy.name+' übernommen.'));}
      ordered.append(row);
    }
    target.append(ordered);
    if(data.hasMore){const more=button(data.loading?'Wird geladen …':data.error?'Erneut versuchen':'Weitere 20 Einträge laden','more',id,'secondary');more.disabled=data.loading;target.append(more);}
  }
  async function loadHistory(id){
    const key=id;let state=histories.get(key);
    if(state?.loading)return;
    if(!state){state={entries:[],cursor:null,hasMore:true,loading:false,error:false};histories.set(key,state);}
    if(!state.hasMore)return;
    state.loading=true;state.error=false;historyList(id);
    try{
      let query=db.collection('fahrzeuge').doc(id).collection('verlauf').orderBy('createdAt','desc');
      if(state.cursor)query=query.startAfter(state.cursor);
      const snapshot=await query.limit(historyPageSize).get();
      if(histories.get(key)!==state)return;
      state.entries.push(...snapshot.docs.map(doc=>doc.data()));
      state.cursor=snapshot.docs[snapshot.docs.length-1]||state.cursor;
      state.hasMore=snapshot.docs.length===historyPageSize;
    }catch(error){if(histories.get(key)===state)state.error=true;}
    finally{state.loading=false;if(histories.get(key)===state)historyList(id);}
  }
  function invalidateHistory(id){histories.delete(id);}
  function render(){
    const focus=document.activeElement;const restore=focus?.dataset?.action?{action:focus.dataset.action,id:focus.dataset.id}:null;
    if(selectedSearch&&search){const vehicle=vehicles.find(v=>v.id===selected);if(vehicle)search.value=vehicle.plate;}
    list.replaceChildren();list.setAttribute('aria-busy',String(vehiclesLoading||favoritesLoading));if(vehiclesLoading||favoritesLoading){const notice=node('p','Fahrzeuge werden geladen …','vehicle-loading');notice.setAttribute('role','status');list.append(notice);return;}const ownVehicle=vehicles.find(v=>v.active?.uid===user?.uid);const query=(search?.value||'').trim().toLocaleLowerCase('de-CH');
    const visible=vehicles.filter(v=>selectedSearch?v.id===selected:(overview?(favorites.has(v.id)||Boolean(user)&&v.active?.uid===user.uid):(!onlyFavorites?.checked||favorites.has(v.id)))&&(v.name+' '+v.plate).toLocaleLowerCase('de-CH').includes(query)).sort((a,b)=>Number(Boolean(user)&&b.active?.uid===user.uid)-Number(Boolean(user)&&a.active?.uid===user.uid)||Number(!overview&&b.id===selected)-Number(!overview&&a.id===selected)||Number(favorites.has(b.id))-Number(favorites.has(a.id))||a.name.localeCompare(b.name,'de-CH'));
    if(overview)document.getElementById('vehicleCount').textContent=String(visible.length);
    if(!visible.length)list.append(node('p',overview?'Hier erscheinen deine Fahrzeugfavoriten und dein aktuell genutztes Fahrzeug.':vehicles.length?'Keine Fahrzeuge für diese Auswahl.':'Noch keine Fahrzeuge angelegt.'));
    for(const v of visible){
      const card=node('article','','vehicle-card'+(v.id===selected||Boolean(user)&&v.active?.uid===user.uid?' vehicle-selected':''));card.id='vehicle-'+v.id;
      const header=node('header'),title=node('div');title.append(node('h2',v.name),node('p',v.plate,'vehicle-plate'));
      const favorite=button(favorites.has(v.id)?'★':'☆','favorite',v.id,'favorite');favorite.setAttribute('aria-label',favorites.has(v.id)?v.name+' aus Favoriten entfernen':v.name+' als Favorit speichern');favorite.setAttribute('aria-pressed',String(favorites.has(v.id)));const tools=node('div','','vehicle-card-tools');tools.append(favorite);
      const menu=node('details');menu.className='vehicle-menu';const toggle=node('summary','⋮');toggle.setAttribute('aria-label','Fahrzeugmenü für '+v.name);toggle.title='Fahrzeugmenü';const menuItems=node('div','','vehicle-menu-items');menuItems.append(button('Informationen','info',v.id,'secondary'));if(LagerAccess.write('fahrzeugeErstellen'))menuItems.append(button('Bearbeiten','edit',v.id,'secondary'));menuItems.append(button('QR-Code herunterladen','qr',v.id,'secondary'));if(LagerAccess.write('fahrzeugeErstellen'))menuItems.append(button('Fahrzeug löschen','delete',v.id,'secondary'));menu.append(toggle,menuItems);tools.append(menu);header.append(title,tools);card.append(header);
      card.append(node('p',v.active?'In Gebrauch von '+v.active.name:'Fahrzeug frei','vehicle-state'+(v.active?' busy':'')));
      if(v.active)card.append(node('p','Seit '+date(v.active.start),'vehicle-time'));
      const mileage=node('div','','vehicle-km');mileage.append(node('span','Kilometerstand für das Tankterminal'),node('strong',km(v.km)),node('small','Stand: '+date(v.kmAt)+(v.kmBy?.name?' · '+v.kmBy.name:'')));card.append(mileage);
      if(LagerAccess.write('fahrzeuge')){
        const actions=node('div','','vehicle-actions');
        if(!v.active)actions.append(button('In Gebrauch','start',v.id));
        else if(v.active.uid===user.uid)actions.append(button('Fahrzeug frei','free',v.id));
        else if(LagerAccess.write('fahrzeugeUebernehmen'))actions.append(button('Für mich übernehmen','takeover',v.id,'takeover'));
        actions.append(button('Tanken','fuel',v.id,'secondary'));
        actions.append(button('Nutzung für eine Person nachtragen','backfill',v.id,'secondary'));
        if(!v.active)actions.append(button('Fahrzeug den ganzen Tag gebraucht','day',v.id,'secondary day-button'));
        if(ownVehicle){for(const control of actions.querySelectorAll('button')){if(['start','takeover','day'].includes(control.dataset.action)){control.disabled=true;control.title='Zuerst '+ownVehicle.name+' freigeben.';}}}
        card.append(actions);
      }
      const feedback=node('p',busy.has(v.id)?(messages.get(v.id)||'Wird verarbeitet …'):messages.get(v.id)||'','vehicle-feedback');loading(feedback,busy.has(v.id));card.setAttribute('aria-busy',String(busy.has(v.id)));feedback.setAttribute('role','status');card.append(feedback);
      const details=node('details');details.dataset.history=v.id;details.open=openHistory.has(v.id);details.append(node('summary','Nutzungs- und Tankverlauf'));const history=node('div');history.dataset.historyList=v.id;history.className='vehicle-history-scroll';history.tabIndex=0;history.setAttribute('role','region');history.setAttribute('aria-label','Nutzungs- und Tankverlauf für '+v.name);details.append(history);details.addEventListener('toggle',()=>{if(!details.isConnected)return;if(details.open){openHistory.add(v.id);if(!histories.has(v.id))void loadHistory(v.id);else historyList(v.id);}else{openHistory.delete(v.id);}});card.append(details);list.append(card);if(details.open){if(!histories.has(v.id))void loadHistory(v.id);else historyList(v.id);}
    }
    if(restore){const target=[...list.querySelectorAll('button')].find(n=>n.dataset.action===restore.action&&n.dataset.id===restore.id);target?.focus({preventScroll:true});}
    if(ownScrollId&&vehicles.some(v=>v.id===ownScrollId&&v.active?.uid===user?.uid)){
      if(ownScrollFrame!==null)cancelAnimationFrame(ownScrollFrame);
      ownScrollFrame=requestAnimationFrame(()=>{
        ownScrollFrame=null;
        const card=document.getElementById('vehicle-'+ownScrollId);
        if(card){card.scrollIntoView({behavior:'instant',block:'start'});ownScrollId=null;}
      });
    }
    if(!overview&&selected&&!selectedScrolled){
      // Live snapshots can replace the cards before the browser paints them.
      // Resolve the current card after rendering and avoid a stale smooth scroll.
      if(selectedScrollFrame!==null)cancelAnimationFrame(selectedScrollFrame);
      selectedScrollFrame=requestAnimationFrame(()=>{
        selectedScrollFrame=null;
        const card=document.getElementById('vehicle-'+selected);
        if(card){card.scrollIntoView({behavior:'instant',block:'start'});selectedScrolled=true;}
      });
    }
  }
  function downloadQr(v){
    const url=new URL('fahrzeuge.html',location.href);url.searchParams.set('fahrzeug',v.id);url.searchParams.set('scan','1');
    const qr=qrcode(0,'M');qr.addData(url.href);qr.make();
    const size=qr.getModuleCount()*8+64,namespace='http://www.w3.org/2000/svg';
    const svg=document.createElementNS(namespace,'svg');
    // Keep the QR code and its quiet zone intact below the printed vehicle label.
    const nameLines=String(v.name).match(/.{1,28}(?:\s|$)|\S{1,28}/g)||['Fahrzeug'];
    const headerHeight=32+nameLines.length*34+42;
    svg.setAttribute('xmlns',namespace);svg.setAttribute('width',String(size));svg.setAttribute('height',String(size+headerHeight));
    svg.setAttribute('viewBox','0 0 '+size+' '+(size+headerHeight));
    const background=document.createElementNS(namespace,'rect');
    background.setAttribute('width','100%');background.setAttribute('height','100%');background.setAttribute('fill','#fff');svg.append(background);
    function label(value,y,fontSize,bold){
      const text=document.createElementNS(namespace,'text');text.textContent=value.trim();
      text.setAttribute('x',String(size/2));text.setAttribute('y',String(y));text.setAttribute('text-anchor','middle');
      text.setAttribute('font-family','Arial, sans-serif');text.setAttribute('font-size',String(fontSize));text.setAttribute('fill','#000');
      if(bold)text.setAttribute('font-weight','700');
      if(value.length*fontSize*0.7>size-64){text.setAttribute('textLength',String(size-64));text.setAttribute('lengthAdjust','spacingAndGlyphs');}
      svg.append(text);
    }
    nameLines.forEach((line,index)=>label(line,40+index*34,28,true));
    label(String(v.plate||''),40+nameLines.length*34,24,false);
    const qrSvg=new DOMParser().parseFromString(qr.createSvgTag({cellSize:8,margin:32,scalable:true}),'image/svg+xml').documentElement;
    qrSvg.setAttribute('x','0');qrSvg.setAttribute('y',String(headerHeight));qrSvg.setAttribute('width',String(size));qrSvg.setAttribute('height',String(size));svg.append(qrSvg);
    const blob=new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml'});
    const objectUrl=URL.createObjectURL(blob),link=document.createElement('a');link.href=objectUrl;
    link.download='QR-'+v.name.replace(/[^a-zA-Z0-9_-]/g,'_')+'.svg';document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(objectUrl),60000);
    messages.set(v.id,'QR-Code heruntergeladen. Zum Ausdrucken die Bilddatei öffnen.');render();
  }
  function handleScan(){
    if(!scanRequested||scanHandled)return;scanHandled=true;
    // Consume the intent before writing: snapshots and reloads must never toggle again.
    const clean=new URL(location.href);clean.searchParams.delete('scan');history.replaceState(null,'',clean.href);
    const v=vehicles.find(entry=>entry.id===selected);
    if(!v){status.textContent='Das gescannte Fahrzeug wurde nicht gefunden.';return;}
    if(!LagerAccess.write('fahrzeuge')){messages.set(v.id,'Du darfst Fahrzeuge nur ansehen.');render();return;}
    if(v.active?.uid===user.uid){openDialog('free',v);return;}
    if(v.active&&!LagerAccess.write('fahrzeugeUebernehmen')){messages.set(v.id,'Dieses Fahrzeug ist von '+v.active.name+' in Gebrauch. Du darfst es nicht übernehmen.');render();return;}
    const own=vehicles.find(entry=>entry.active?.uid===user.uid);
    if(own){openDialog('switch',v,own);return;}
    if(v.active){openDialog('takeover',v);return;}
    void act(v,'start');
  }
  function input(name,label,type,value,max){const wrapper=node('label',label),field=node('input');field.name=name;field.type=type;field.value=value;field.required=true;if(type==='number'){field.min='0';field.max='9999999';field.step='1';field.inputMode='numeric';}else field.maxLength=max;wrapper.append(field);fields.append(wrapper);return field;}
  function todayZurich(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Zurich',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
  async function backfillFields(operation){
    save.disabled=true;
    const recipientStatus=document.getElementById('dialogStatus');recipientStatus.textContent='Personen werden geladen …';loading(recipientStatus,true);
    const personLabel=node('label','Person'),person=node('select');person.name='targetUid';person.required=true;
    const placeholder=node('option','Person auswählen');placeholder.value='';person.append(placeholder);personLabel.append(person);fields.append(personLabel);
    person.addEventListener('change',()=>{save.textContent=person.value===user?.uid?'Nutzung speichern':'Zur Bestätigung senden';});
    const checkLabel=node('label','','vehicle-check'),wholeDay=node('input');wholeDay.type='checkbox';wholeDay.name='wholeDay';checkLabel.append(wholeDay,node('span','Ganzer Tag (07:00–17:15 Uhr)'));fields.append(checkLabel);
    const day=input('date','Datum','date',todayZurich()),start=input('start','Von (Schweizer Zeit)','datetime-local',todayZurich()+'T07:00'),end=input('end','Bis (Schweizer Zeit)','datetime-local',todayZurich()+'T17:15');
    function mode(){day.disabled=!wholeDay.checked;day.required=wholeDay.checked;day.parentElement.hidden=!wholeDay.checked;for(const control of [start,end]){control.disabled=wholeDay.checked;control.required=!wholeDay.checked;control.parentElement.hidden=wholeDay.checked;}}
    wholeDay.addEventListener('change',mode);mode();
    try{
      if(!recipientCache)recipientCache=(await backfillUsersCall({})).data.users;
      if(pending!==operation||!dialog.open)return;
      for(const recipient of recipientCache){const option=node('option',recipient.name);option.value=recipient.uid;person.append(option);}
      if(!recipientCache.length){document.getElementById('dialogStatus').textContent='Keine aktiven Personen mit Fahrzeugzugriff gefunden.';return;}
      recipientStatus.textContent='';save.disabled=false;
    }catch(error){if(pending===operation)document.getElementById('dialogStatus').textContent=errorText(error);}
    finally{if(pending===operation)loading(recipientStatus,false);}
  }
  function renderInbox(){
    if(!inbox)return;inbox.replaceChildren();inbox.hidden=!backfills.length;if(!backfills.length)return;
    inbox.append(node('h2','Fahrzeugnutzung bestätigen'),node('p','Diese Nutzungen wurden für dich nachgetragen. Prüfe Fahrzeug und Zeitraum.'));
    for(const request of backfills){
      const card=node('article','','vehicle-card');card.append(node('h3',request.vehicleName+' · '+request.plate),node('p',date(request.start)+' → '+date(request.end)),node('p','Nachgetragen von '+request.requestedBy.name),node('p','Bestätigung ausstehend'));
      const controls=node('div','','vehicle-actions'),feedback=node('p');feedback.setAttribute('role','status');
      for(const [decision,label] of [['confirmed','Bestätigen'],['rejected','Ablehnen']]){
        const control=node('button',label,decision==='rejected'?'secondary':'');control.type='button';
        control.addEventListener('click',async()=>{
          for(const button of controls.children)button.disabled=true;feedback.textContent='Wird gespeichert …';loading(feedback,true);
          try{await reviewCall({id:request.id,decision});status.textContent=decision==='confirmed'?'Nutzung bestätigt.':'Nachtrag abgelehnt und aus dem Verlauf entfernt.';}
          catch(error){feedback.textContent=errorText(error);for(const button of controls.children)button.disabled=false;}finally{loading(feedback,false);}
        });controls.append(control);
      }
      card.append(controls,feedback);inbox.append(card);
    }
  }
  function openDialog(action,vehicle,previousVehicle){
    loading(document.getElementById('dialogStatus'),false);
    pending={action,vehicle,requestId:requestId()};
    if(action==='switch')Object.assign(pending,{previousVehicle,releaseRequestId:requestId(),released:false,targetAction:vehicle.active?'takeover':'start'});fields.replaceChildren();save.hidden=false;cancel.textContent='Abbrechen';document.getElementById('dialogStatus').textContent='';save.disabled=false;cancel.disabled=false;
    const titles={info:'Fahrzeuginformationen',edit:'Fahrzeug bearbeiten',create:'Fahrzeug hinzufügen',fuel:'Tanken',takeover:'Fahrzeug für mich übernehmen',day:'Nutzung für heute nachtragen',free:'Fahrzeug zurückgeben',switch:'Fahrzeug wechseln',backfill:'Nutzung für eine Person nachtragen'};
    document.getElementById('dialogTitle').textContent=titles[action]+(vehicle?' · '+vehicle.name:'');
    const note=document.getElementById('dialogNote');note.textContent='';save.textContent='Speichern';
    if(action==='create'||action==='edit'){
      input('name','Fahrzeugname','text',vehicle?.name||'',100);input('plate','Kennzeichen','text',vehicle?.plate||'',30);
      if(action==='create')input('km','Aktueller Kilometerstand','number','');
      const responsible=input('responsible','Fahrzeugverantwortlicher','text',vehicle?.responsible||'',100);responsible.required=false;
      const label=node('label','Details'),details=node('textarea');details.name='details';details.value=vehicle?.details||'';details.maxLength=5000;details.rows=6;details.placeholder='Zum Beispiel: Traglast des Krans, Ausrüstung oder besondere Hinweise';label.append(details);fields.append(label);
    }
    if(action==='info'){
      fields.append(node('h3','Fahrzeugverantwortlicher'),node('p',vehicle.responsible||'Nicht hinterlegt'),node('h3','Details'),node('p',vehicle.details||'Keine weiteren Informationen hinterlegt.','vehicle-information'));
      save.hidden=true;cancel.textContent='Schliessen';
    }
    if(action==='switch'){
      note.textContent='Du hast '+previousVehicle.name+' ('+previousVehicle.plate+') in Gebrauch. Möchtest du dieses Fahrzeug freigeben und '+vehicle.name+' ('+vehicle.plate+') '+(vehicle.active?'von '+vehicle.active.name+' übernehmen?':'in Gebrauch nehmen?');
      save.textContent='Fahrzeug wechseln';
    }
    if(action==='free'){note.textContent='Möchtest du das Fahrzeug wieder freigeben?';save.textContent='Fahrzeug zurückgeben';}
    if(action==='fuel'){note.textContent='Lies den aktuellen Kilometerstand am Fahrzeug ab. Nach dem Speichern steht er gross auf der Karte für das Bezahlen am Tankterminal.';const field=input('km','Aktueller Kilometerstand','number','');field.min=String(vehicle.km||0);}
    if(action==='takeover'){note.textContent='Die Nutzung von '+vehicle.active.name+' wird jetzt beendet und im Verlauf als Übernahme dokumentiert. Danach ist das Fahrzeug auf dich eingetragen.';save.textContent='Für mich übernehmen';}
    if(action==='day'){note.textContent='Deine Nutzung wird für heute von frühestens 07:00 oder vom Ende der letzten protokollierten Nutzung bis zum Speichern nachgetragen. Das Fahrzeug bleibt frei.';save.textContent='Nutzung nachtragen';}
    dialog.showModal();
    if(action==='backfill'){
      note.textContent='Eigene Nachträge werden direkt bestätigt gespeichert, ohne Benachrichtigung. Eine andere ausgewählte Person muss den Nachtrag bestätigen. Bis dahin steht im Verlauf „Bestätigung ausstehend“. Bei Ablehnung wird er entfernt. Nur abgeschlossene Zeiträume können nachgetragen werden. Die aktuelle Belegung bleibt unverändert.';
      save.textContent='Zur Bestätigung senden';void backfillFields(pending);
    }
  }
  async function act(v,action){
    if(busy.has(v.id))return;busy.add(v.id);messages.set(v.id,'Wird gespeichert …');render();
    try{await actionCall({id:v.id,revision:v.revision,action,requestId:requestId()});if(!overview&&action==='start')ownScrollId=v.id;messages.set(v.id,action==='start'?'Auf dich eingetragen.':'Fahrzeug freigegeben.');}
    catch(error){messages.set(v.id,errorText(error));}finally{busy.delete(v.id);render();}
  }
  list.addEventListener('click',async event=>{
    const control=event.target.closest('button[data-action]');if(!control||control.disabled)return;
    const v=vehicles.find(entry=>entry.id===control.dataset.id);if(!v)return;
    const action=control.dataset.action;
    if(action==='favorite'){
      busy.add(v.id);messages.set(v.id,'Favorit wird gespeichert …');render();const ref=db.collection('fahrzeug_favoriten').doc(user.uid).collection('fahrzeuge').doc(v.id);
      try{if(favorites.has(v.id))await ref.delete();else await ref.set({updatedAt:firebase.firestore.FieldValue.serverTimestamp()});messages.delete(v.id);}
      catch(error){messages.set(v.id,errorText(error));}finally{busy.delete(v.id);render();}return;
    }
    if(action==='info'){openDialog('info',v);return;}
    if(action==='edit'){if(LagerAccess.write('fahrzeugeErstellen'))openDialog('edit',v);return;}
    if(action==='qr'){downloadQr(v);return;}
    if(action==='delete'){
      if(!LagerAccess.write('fahrzeugeErstellen'))return;
      if(v.active){messages.set(v.id,'Das Fahrzeug ist noch in Gebrauch. Zuerst freigeben.');render();return;}
      if(!confirm(v.name+' ('+v.plate+') aus der Fahrzeugliste löschen? Der gesamte Nutzungs- und Tankverlauf bleibt in Firebase erhalten.'))return;
      busy.add(v.id);messages.set(v.id,'Fahrzeug wird gelöscht …');render();
      try{await deleteCall({id:v.id,revision:v.revision});invalidateHistory(v.id);openHistory.delete(v.id);status.textContent='Fahrzeug gelöscht.';}
      catch(error){messages.set(v.id,errorText(error));}finally{busy.delete(v.id);render();}return;
    }
    if(action==='more'){void loadHistory(v.id);return;}
    if(!LagerAccess.write('fahrzeuge'))return;
    if(action==='start'){await act(v,action);return;}
    openDialog(action,v);
  });
  document.addEventListener('click',event=>{for(const menu of list.querySelectorAll('.vehicle-menu[open]'))if(!menu.contains(event.target))menu.open=false;});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')for(const menu of list.querySelectorAll('.vehicle-menu[open]')){menu.open=false;menu.querySelector('summary').focus();}});
  document.getElementById('addVehicle')?.addEventListener('click',()=>openDialog('create'));
  cancel.addEventListener('click',()=>{if(!saving){dialog.close();pending=null;}});dialog.addEventListener('cancel',event=>{if(saving)event.preventDefault();else pending=null;});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(saving||!pending||pending.action==='info'||!form.reportValidity())return;
    const operation=pending,values=new FormData(form);saving=true;save.disabled=true;cancel.disabled=true;loading(save,true);loading(document.getElementById('dialogStatus'),true);document.getElementById('dialogStatus').textContent='Wird gespeichert …';
    try{
      if(operation.action==='create')await createCall({name:values.get('name').trim(),plate:values.get('plate').trim(),km:Number(values.get('km')),responsible:values.get('responsible').trim(),details:values.get('details').trim()});
      else if(operation.action==='edit')await editCall({id:operation.vehicle.id,revision:operation.vehicle.revision,name:values.get('name').trim(),plate:values.get('plate').trim(),responsible:values.get('responsible').trim(),details:values.get('details').trim()});
      else if(operation.action==='backfill'){
        const result=await backfillCall({vehicleId:operation.vehicle.id,targetUid:values.get('targetUid'),requestId:operation.requestId,wholeDay:values.has('wholeDay'),date:values.get('date'),start:values.get('start'),end:values.get('end')});
        operation.backfillStatus=result.data.status;
        invalidateHistory(operation.vehicle.id);messages.set(operation.vehicle.id,operation.backfillStatus==='confirmed'?'Eigene Nutzung gespeichert · Bestätigt.':'Nachtrag gesendet · Bestätigung ausstehend.');
      }
      else if(operation.action==='switch'){
        const previous=operation.previousVehicle,v=operation.vehicle;
        if(!operation.released){
          await actionCall({id:previous.id,revision:previous.revision,action:'free',requestId:operation.releaseRequestId});
          operation.released=true;messages.set(previous.id,'Fahrzeug freigegeben.');
          document.getElementById('dialogStatus').textContent=previous.name+' ist freigegeben. '+v.name+' wird auf dich eingetragen …';
        }
        await actionCall({id:v.id,revision:v.revision,action:operation.targetAction,requestId:operation.requestId});
        messages.set(v.id,'Auf dich eingetragen.');
      }
      else{const v=operation.vehicle;const data={id:v.id,revision:v.revision,action:operation.action,requestId:operation.requestId};if(operation.action==='fuel')data.km=Number(values.get('km'));await actionCall(data);messages.set(v.id,'Gespeichert.');}
      if(!overview&&['start','takeover','switch'].includes(operation.action))ownScrollId=operation.vehicle.id;
      dialog.close();pending=null;render();status.textContent=operation.action==='create'?'Fahrzeug hinzugefügt.':operation.action==='backfill'?(operation.backfillStatus==='confirmed'?'Eigene Nutzung gespeichert. Keine Bestätigung und keine Benachrichtigung nötig.':'Nachtrag gesendet. Die Person kann ihn im Bereich Fahrzeuge bestätigen; eine Smartphone-Benachrichtigung wird an ihre aktivierten Geräte gesendet.'):'Änderung gespeichert.';
    }catch(error){document.getElementById('dialogStatus').textContent=(operation.action==='switch'&&operation.released?operation.previousVehicle.name+' wurde freigegeben. Das gescannte Fahrzeug konnte noch nicht auf dich eingetragen werden. ':'')+errorText(error);if(error.code==='functions/failed-precondition'){save.disabled=true;document.getElementById('dialogStatus').textContent+=' Schliesse dieses Fenster und öffne die Aktion nochmals.';}}
    finally{loading(save,false);loading(document.getElementById('dialogStatus'),false);saving=false;cancel.disabled=false;if(document.getElementById('dialogStatus').textContent.indexOf('Schliesse dieses Fenster')===-1)save.disabled=false;}
  });
  search?.addEventListener('input',()=>{selectedSearch=false;render();});onlyFavorites?.addEventListener('change',()=>{selectedSearch=false;render();});
  LagerAccess.onAuthStateChanged(current=>{
    ownScrollId=null;if(ownScrollFrame!==null){cancelAnimationFrame(ownScrollFrame);ownScrollFrame=null;}
    vehiclesLoading=true;favoritesLoading=true;loading(status,true);status.classList.remove('vehicle-error');
    user=current;unsubVehicles?.();unsubFavorites?.();unsubBackfills?.();backfills=[];recipientCache=null;renderInbox();histories.clear();openHistory.clear();favorites.clear();vehicles=[];
    if(!user){const backfillId=new URLSearchParams(location.search).get('nachtrag');location.replace('home.html'+(scanRequested?'?vehicleScan='+encodeURIComponent(selected||''):backfillId?'?vehicleBackfill='+encodeURIComponent(backfillId):''));return;}
    if(overview){const hidden=!LagerAccess.read('fahrzeuge');document.getElementById('myVehiclesSection').hidden=hidden;document.getElementById('vehicleStat').hidden=hidden;if(hidden)return;}
    document.getElementById('appContent').style.display='block';const add=document.getElementById('addVehicle');if(add)add.hidden=!LagerAccess.write('fahrzeugeErstellen');
    if(inbox)unsubBackfills=db.collection('fahrzeug_nachtraege').where('targetUid','==',user.uid).where('status','==','pending').onSnapshot(snapshot=>{
      backfills=snapshot.docs.map(doc=>({...doc.data(),id:doc.id})).sort((a,b)=>b.createdAt.toMillis()-a.createdAt.toMillis());renderInbox();
    },error=>{status.textContent='Bestätigungsanfragen konnten nicht geladen werden. '+errorText(error);});
    unsubVehicles=db.collection('fahrzeuge').onSnapshot(snapshot=>{const next=snapshot.docs.map(doc=>({...doc.data(),id:doc.id}));for(const previous of vehicles){if(next.find(v=>v.id===previous.id)?.revision!==previous.revision)invalidateHistory(previous.id);}vehicles=next;vehiclesLoading=false;loading(status,false);status.textContent=overview?'Belegung wird automatisch aktualisiert.':vehicles.length+' Fahrzeuge · Belegung wird automatisch aktualisiert';render();handleScan();},error=>{vehiclesLoading=false;loading(status,false);status.textContent=errorText(error);status.className='vehicle-error';render();});
    unsubFavorites=db.collection('fahrzeug_favoriten').doc(user.uid).collection('fahrzeuge').onSnapshot(snapshot=>{favorites=new Set(snapshot.docs.map(doc=>doc.id));favoritesLoading=false;render();},()=>{favoritesLoading=false;render();status.textContent='Favoriten konnten nicht geladen werden. Bitte die Firestore-Regeln prüfen.';});
  });
})();


