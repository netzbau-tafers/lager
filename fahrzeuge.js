(function(){
  'use strict';
  const db=firebase.firestore(),functions=firebase.app().functions('europe-west1');
  const actionCall=functions.httpsCallable('lagerVehicleAction'),createCall=functions.httpsCallable('lagerCreateVehicle'),deleteCall=functions.httpsCallable('lagerDeleteVehicle');
  const list=document.getElementById('vehicleList'),status=document.getElementById('vehicleStatus'),search=document.getElementById('vehicleSearch'),onlyFavorites=document.getElementById('onlyFavorites');
  const dialog=document.getElementById('vehicleDialog'),form=document.getElementById('vehicleForm'),fields=document.getElementById('dialogFields'),save=document.getElementById('dialogSave'),cancel=document.getElementById('dialogCancel');
  const overview=Boolean(document.getElementById('myVehiclesSection'));
  let user=null,vehicles=[],favorites=new Set(),unsubVehicles=null,unsubFavorites=null,pending=null,saving=false,selectedScrolled=false;
  const selected=new URLSearchParams(location.search).get('fahrzeug'),scanRequested=!overview&&new URLSearchParams(location.search).get('scan')==='1';
  let scanHandled=false,selectedScrollFrame=null,selectedSearch=!overview&&Boolean(selected);
  const busy=new Set(),messages=new Map(),histories=new Map(),historyMonths=new Map(),openHistory=new Set();
  function node(tag,value='',className=''){const element=document.createElement(tag);element.textContent=value;if(className)element.className=className;return element;}
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
  function historyKey(id){return id+'|'+(historyMonths.get(id)||'');}
  function monthStart(year,month){
    const utc=Date.UTC(year,month,1),parts=new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Zurich',timeZoneName:'shortOffset'}).formatToParts(new Date(utc));
    const offset=Number(parts.find(part=>part.type==='timeZoneName').value.replace('GMT',''));
    return firebase.firestore.Timestamp.fromMillis(utc-offset*3600000);
  }
  function historyList(id){
    const target=[...list.querySelectorAll('[data-history-list]')].find(n=>n.dataset.historyList===id);if(!target)return;
    target.replaceChildren();const data=histories.get(historyKey(id));
    const controls=node('div','','vehicle-history-controls'),label=node('label','Monat (leer = alle): '),month=node('input');
    month.type='month';month.value=historyMonths.get(id)||'';month.dataset.historyMonth=id;month.disabled=Boolean(data?.loading);label.append(month);controls.append(label);
    const refresh=button('Aktualisieren','history-refresh',id,'secondary');refresh.disabled=Boolean(data?.loading);controls.append(refresh);target.append(controls);
    if(!data){target.append(node('p','Verlauf wird geladen …'));return;}
    if(data.error)target.append(node('p','Verlauf konnte nicht geladen werden. Bitte erneut versuchen.','vehicle-error'));
    if(!data.entries.length)target.append(node('p',data.loading?'Verlauf wird geladen …':data.error?'': 'Keine Einträge für diese Auswahl.'));
    const ordered=node('ol','','vehicle-history');
    for(const entry of data.entries){
      const row=node('li'),name=entry.actor?.name||'Unbekannte Person';
      if(entry.type==='fuel'){row.append(node('strong','Tanken · '+km(entry.km)),node('p',name+' · '+date(entry.start)));}
      else if(entry.type==='takeover'){row.append(node('strong','Fahrzeug übernommen'),node('p',(entry.from?.name||'Andere Person')+' → '+name),node('p',date(entry.start)));}
      else{row.append(node('strong',name+' · '+(entry.type==='day'?'Nutzung nachgetragen':'In Gebrauch')),node('p',date(entry.start)+' → '+(entry.end?date(entry.end):'Noch in Gebrauch')));if(entry.takenOverBy)row.append(node('p','Durch '+entry.takenOverBy.name+' übernommen.'));}
      ordered.append(row);
    }
    target.append(ordered);
    if(data.hasMore){const more=button(data.loading?'Wird geladen …':data.error?'Erneut versuchen':'Weitere 20 Einträge laden','more',id,'secondary');more.disabled=data.loading;target.append(more);}
  }
  async function loadHistory(id,refresh=false){
    const key=historyKey(id);let state=histories.get(key);
    if(state?.loading)return;
    if(refresh||!state){state={entries:[],cursor:null,hasMore:true,loading:false,error:false};histories.set(key,state);}
    if(!state.hasMore)return;
    state.loading=true;state.error=false;historyList(id);
    try{
      let query=db.collection('fahrzeuge').doc(id).collection('verlauf').orderBy('createdAt','desc');
      const month=historyMonths.get(id);
      if(month){const [year,value]=month.split('-').map(Number);query=query.where('createdAt','>=',monthStart(year,value-1)).where('createdAt','<',monthStart(year,value));}
      if(state.cursor)query=query.startAfter(state.cursor);
      const snapshot=await query.limit(historyPageSize).get();
      if(histories.get(key)!==state)return;
      state.entries.push(...snapshot.docs.map(doc=>doc.data()));
      state.cursor=snapshot.docs[snapshot.docs.length-1]||state.cursor;
      state.hasMore=snapshot.docs.length===historyPageSize;
    }catch(error){if(histories.get(key)===state)state.error=true;}
    finally{state.loading=false;if(histories.get(key)===state&&historyKey(id)===key)historyList(id);}
  }
  function invalidateHistory(id){for(const key of histories.keys())if(key.startsWith(id+'|'))histories.delete(key);}
  function render(){
    const focus=document.activeElement;const restore=focus?.dataset?.action?{action:focus.dataset.action,id:focus.dataset.id}:null;
    if(selectedSearch&&search){const vehicle=vehicles.find(v=>v.id===selected);if(vehicle)search.value=vehicle.plate;}
    list.replaceChildren();const ownVehicle=vehicles.find(v=>v.active?.uid===user?.uid);const query=(search?.value||'').trim().toLocaleLowerCase('de-CH');
    const visible=vehicles.filter(v=>selectedSearch?v.id===selected:(!(overview||onlyFavorites?.checked)||favorites.has(v.id))&&(v.name+' '+v.plate).toLocaleLowerCase('de-CH').includes(query)).sort((a,b)=>Number(!overview&&b.id===selected)-Number(!overview&&a.id===selected)||Number(favorites.has(b.id))-Number(favorites.has(a.id))||a.name.localeCompare(b.name,'de-CH'));
    if(overview)document.getElementById('vehicleCount').textContent=String(visible.length);
    if(!visible.length)list.append(node('p',overview?'Speichere Fahrzeuge im Bereich „Fahrzeuge“ mit dem Stern als Favoriten.':vehicles.length?'Keine Fahrzeuge für diese Auswahl.':'Noch keine Fahrzeuge angelegt.'));
    for(const v of visible){
      const card=node('article','','vehicle-card'+(v.id===selected?' vehicle-selected':''));card.id='vehicle-'+v.id;
      const header=node('header'),title=node('div');title.append(node('h2',v.name),node('p',v.plate,'vehicle-plate'));
      const favorite=button(favorites.has(v.id)?'★':'☆','favorite',v.id,'favorite');favorite.setAttribute('aria-label',favorites.has(v.id)?v.name+' aus Favoriten entfernen':v.name+' als Favorit speichern');favorite.setAttribute('aria-pressed',String(favorites.has(v.id)));const tools=node('div','','vehicle-card-tools');tools.append(favorite);
      const menu=node('details');menu.className='vehicle-menu';const toggle=node('summary','⋮');toggle.setAttribute('aria-label','Fahrzeugmenü für '+v.name);toggle.title='Fahrzeugmenü';const menuItems=node('div','','vehicle-menu-items');menuItems.append(button('QR-Code herunterladen','qr',v.id,'secondary'));if(LagerAccess.write('fahrzeugeErstellen'))menuItems.append(button('Fahrzeug löschen','delete',v.id,'secondary'));menu.append(toggle,menuItems);tools.append(menu);header.append(title,tools);card.append(header);
      card.append(node('p',v.active?'In Gebrauch von '+v.active.name:'Fahrzeug frei','vehicle-state'+(v.active?' busy':'')));
      if(v.active)card.append(node('p','Seit '+date(v.active.start),'vehicle-time'));
      const mileage=node('div','','vehicle-km');mileage.append(node('span','Kilometerstand für das Tankterminal'),node('strong',km(v.km)),node('small','Stand: '+date(v.kmAt)+(v.kmBy?.name?' · '+v.kmBy.name:'')));card.append(mileage);
      if(LagerAccess.write('fahrzeuge')){
        const actions=node('div','','vehicle-actions');
        if(!v.active)actions.append(button('In Gebrauch','start',v.id));
        else if(v.active.uid===user.uid)actions.append(button('Fahrzeug frei','free',v.id));
        else if(LagerAccess.write('fahrzeugeUebernehmen'))actions.append(button('Für mich übernehmen','takeover',v.id,'takeover'));
        actions.append(button('Tanken','fuel',v.id,'secondary'));
        if(!v.active)actions.append(button('Fahrzeug den ganzen Tag gebraucht','day',v.id,'secondary day-button'));
        if(ownVehicle){for(const control of actions.querySelectorAll('button')){if(['start','takeover','day'].includes(control.dataset.action)){control.disabled=true;control.title='Zuerst '+ownVehicle.name+' freigeben.';}}}
        card.append(actions);
        if(ownVehicle&&ownVehicle.id!==v.id)card.append(node('p','Zuerst '+ownVehicle.name+' freigeben, um dieses Fahrzeug zu benutzen.','vehicle-help'));
        if(!v.active)card.append(node('p','Nachtragen: heute ab 07:00 oder ab dem Ende der letzten Nutzung bis jetzt.','vehicle-help'));
      }
      const feedback=node('p',messages.get(v.id)||'','vehicle-feedback');feedback.setAttribute('role','status');card.append(feedback);
      const details=node('details');details.dataset.history=v.id;details.open=openHistory.has(v.id);details.append(node('summary','Nutzungs- und Tankverlauf'));const history=node('div');history.dataset.historyList=v.id;history.className='vehicle-history-scroll';history.tabIndex=0;history.setAttribute('role','region');history.setAttribute('aria-label','Nutzungs- und Tankverlauf für '+v.name);details.append(history);details.addEventListener('toggle',()=>{if(!details.isConnected)return;if(details.open){openHistory.add(v.id);if(!histories.has(historyKey(v.id)))void loadHistory(v.id);else historyList(v.id);}else{openHistory.delete(v.id);}});card.append(details);list.append(card);if(details.open){if(!histories.has(historyKey(v.id)))void loadHistory(v.id);else historyList(v.id);}
    }
    if(restore){const target=[...list.querySelectorAll('button')].find(n=>n.dataset.action===restore.action&&n.dataset.id===restore.id);target?.focus({preventScroll:true});}
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
    if(v.active&&v.active.uid!==user.uid){messages.set(v.id,'Dieses Fahrzeug ist von '+v.active.name+' in Gebrauch.');render();return;}
    if(v.active){openDialog('free',v);return;}
    const own=vehicles.find(entry=>entry.active?.uid===user.uid);
    if(own){messages.set(v.id,'Zuerst '+own.name+' freigeben.');render();return;}
    void act(v,'start');
  }
  function input(name,label,type,value,max){const wrapper=node('label',label),field=node('input');field.name=name;field.type=type;field.value=value;field.required=true;if(type==='number'){field.min='0';field.max='9999999';field.step='1';field.inputMode='numeric';}else field.maxLength=max;wrapper.append(field);fields.append(wrapper);return field;}
  function openDialog(action,vehicle){
    pending={action,vehicle,requestId:requestId()};fields.replaceChildren();document.getElementById('dialogStatus').textContent='';save.disabled=false;cancel.disabled=false;
    const titles={create:'Fahrzeug hinzufügen',fuel:'Tanken',takeover:'Fahrzeug für mich übernehmen',day:'Nutzung für heute nachtragen',free:'Fahrzeug zurückgeben'};
    document.getElementById('dialogTitle').textContent=titles[action]+(vehicle?' · '+vehicle.name:'');
    const note=document.getElementById('dialogNote');note.textContent='';save.textContent='Speichern';
    if(action==='create'){input('name','Fahrzeugname','text','',100);input('plate','Kennzeichen','text','',30);input('km','Aktueller Kilometerstand','number','');}
    if(action==='free'){note.textContent='Möchtest du das Fahrzeug wieder freigeben?';save.textContent='Fahrzeug zurückgeben';}
    if(action==='fuel'){note.textContent='Lies den aktuellen Kilometerstand am Fahrzeug ab. Nach dem Speichern steht er gross auf der Karte für das Bezahlen am Tankterminal.';const field=input('km','Aktueller Kilometerstand','number','');field.min=String(vehicle.km||0);}
    if(action==='takeover'){note.textContent='Die Nutzung von '+vehicle.active.name+' wird jetzt beendet und im Verlauf als Übernahme dokumentiert. Danach ist das Fahrzeug auf dich eingetragen.';save.textContent='Für mich übernehmen';}
    if(action==='day'){note.textContent='Deine Nutzung wird für heute von frühestens 07:00 oder vom Ende der letzten protokollierten Nutzung bis zum Speichern nachgetragen. Das Fahrzeug bleibt frei.';save.textContent='Nutzung nachtragen';}
    dialog.showModal();
  }
  async function act(v,action){
    if(busy.has(v.id))return;busy.add(v.id);messages.set(v.id,'Wird gespeichert …');render();
    try{await actionCall({id:v.id,revision:v.revision,action,requestId:requestId()});messages.set(v.id,action==='start'?'Auf dich eingetragen.':'Fahrzeug freigegeben.');}
    catch(error){messages.set(v.id,errorText(error));}finally{busy.delete(v.id);render();}
  }
  list.addEventListener('click',async event=>{
    const control=event.target.closest('button[data-action]');if(!control||control.disabled)return;
    const v=vehicles.find(entry=>entry.id===control.dataset.id);if(!v)return;
    const action=control.dataset.action;
    if(action==='favorite'){
      busy.add(v.id);render();const ref=db.collection('fahrzeug_favoriten').doc(user.uid).collection('fahrzeuge').doc(v.id);
      try{if(favorites.has(v.id))await ref.delete();else await ref.set({updatedAt:firebase.firestore.FieldValue.serverTimestamp()});messages.set(v.id,'Favorit gespeichert.');}
      catch(error){messages.set(v.id,errorText(error));}finally{busy.delete(v.id);render();}return;
    }
    if(action==='qr'){downloadQr(v);return;}
    if(action==='delete'){
      if(!LagerAccess.write('fahrzeugeErstellen'))return;
      if(v.active){messages.set(v.id,'Das Fahrzeug ist noch in Gebrauch. Zuerst freigeben.');render();return;}
      if(!confirm(v.name+' ('+v.plate+') aus der Fahrzeugliste löschen? Der gesamte Nutzungs- und Tankverlauf bleibt in Firebase erhalten.'))return;
      busy.add(v.id);render();
      try{await deleteCall({id:v.id,revision:v.revision});invalidateHistory(v.id);openHistory.delete(v.id);status.textContent='Fahrzeug gelöscht.';}
      catch(error){messages.set(v.id,errorText(error));}finally{busy.delete(v.id);render();}return;
    }
    if(action==='more'){void loadHistory(v.id);return;}
    if(action==='history-refresh'){void loadHistory(v.id,true);return;}
    if(!LagerAccess.write('fahrzeuge'))return;
    if(action==='start'){await act(v,action);return;}
    openDialog(action,v);
  });
  list.addEventListener('change',event=>{const id=event.target.dataset.historyMonth;if(!id)return;historyMonths.set(id,event.target.value);if(histories.has(historyKey(id)))historyList(id);else void loadHistory(id);});
  document.addEventListener('click',event=>{for(const menu of list.querySelectorAll('.vehicle-menu[open]'))if(!menu.contains(event.target))menu.open=false;});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')for(const menu of list.querySelectorAll('.vehicle-menu[open]')){menu.open=false;menu.querySelector('summary').focus();}});
  document.getElementById('addVehicle')?.addEventListener('click',()=>openDialog('create'));
  cancel.addEventListener('click',()=>{if(!saving)dialog.close();});dialog.addEventListener('cancel',event=>{if(saving)event.preventDefault();});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(saving||!pending||!form.reportValidity())return;
    const operation=pending,values=new FormData(form);saving=true;save.disabled=true;cancel.disabled=true;document.getElementById('dialogStatus').textContent='Wird gespeichert …';
    try{
      if(operation.action==='create')await createCall({name:values.get('name').trim(),plate:values.get('plate').trim(),km:Number(values.get('km'))});
      else{const v=operation.vehicle;const data={id:v.id,revision:v.revision,action:operation.action,requestId:operation.requestId};if(operation.action==='fuel')data.km=Number(values.get('km'));await actionCall(data);messages.set(v.id,'Gespeichert.');}
      dialog.close();pending=null;render();status.textContent=operation.action==='create'?'Fahrzeug hinzugefügt.':'Änderung gespeichert.';
    }catch(error){document.getElementById('dialogStatus').textContent=errorText(error);if(error.code==='functions/failed-precondition'){save.disabled=true;document.getElementById('dialogStatus').textContent+=' Schliesse dieses Fenster und öffne die Aktion nochmals.';}}
    finally{saving=false;cancel.disabled=false;if(document.getElementById('dialogStatus').textContent.indexOf('Schliesse dieses Fenster')===-1)save.disabled=false;}
  });
  search?.addEventListener('input',()=>{selectedSearch=false;render();});onlyFavorites?.addEventListener('change',()=>{selectedSearch=false;render();});
  LagerAccess.onAuthStateChanged(current=>{
    user=current;unsubVehicles?.();unsubFavorites?.();histories.clear();historyMonths.clear();openHistory.clear();favorites.clear();vehicles=[];
    if(!user){location.replace('home.html'+(scanRequested?'?vehicleScan='+encodeURIComponent(selected||''):''));return;}
    if(overview){const hidden=!LagerAccess.read('fahrzeuge');document.getElementById('myVehiclesSection').hidden=hidden;document.getElementById('vehicleStat').hidden=hidden;if(hidden)return;}
    document.getElementById('appContent').style.display='block';const add=document.getElementById('addVehicle');if(add)add.hidden=!LagerAccess.write('fahrzeugeErstellen');
    unsubVehicles=db.collection('fahrzeuge').onSnapshot(snapshot=>{const next=snapshot.docs.map(doc=>({...doc.data(),id:doc.id}));for(const previous of vehicles){if(next.find(v=>v.id===previous.id)?.revision!==previous.revision)invalidateHistory(previous.id);}vehicles=next;status.textContent=overview?'Belegung wird automatisch aktualisiert.':vehicles.length+' Fahrzeuge · Belegung wird automatisch aktualisiert';render();handleScan();},error=>{status.textContent=errorText(error);status.className='vehicle-error';});
    unsubFavorites=db.collection('fahrzeug_favoriten').doc(user.uid).collection('fahrzeuge').onSnapshot(snapshot=>{favorites=new Set(snapshot.docs.map(doc=>doc.id));render();},()=>{status.textContent='Favoriten konnten nicht geladen werden. Bitte die Firestore-Regeln prüfen.';});
  });
})();
