(function(){
  'use strict';
  const db=firebase.firestore(),functions=firebase.app().functions('europe-west1');
  const actionCall=functions.httpsCallable('lagerVehicleAction'),createCall=functions.httpsCallable('lagerCreateVehicle');
  const list=document.getElementById('vehicleList'),status=document.getElementById('vehicleStatus'),search=document.getElementById('vehicleSearch'),onlyFavorites=document.getElementById('onlyFavorites');
  const dialog=document.getElementById('vehicleDialog'),form=document.getElementById('vehicleForm'),fields=document.getElementById('dialogFields'),save=document.getElementById('dialogSave'),cancel=document.getElementById('dialogCancel');
  const overview=Boolean(document.getElementById('myVehiclesSection'));
  let user=null,vehicles=[],favorites=new Set(),unsubVehicles=null,unsubFavorites=null,pending=null,saving=false,selectedScrolled=false;
  const selected=new URLSearchParams(location.search).get('fahrzeug'),scanRequested=!overview&&new URLSearchParams(location.search).get('scan')==='1';
  let scanHandled=false;
  const busy=new Set(),messages=new Map(),histories=new Map(),openHistory=new Set();
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
  function historyList(id){
    const target=[...list.querySelectorAll('[data-history-list]')].find(n=>n.dataset.historyList===id);if(!target)return;
    target.replaceChildren();const data=histories.get(id);
    if(!data){target.append(node('p','Verlauf wird geladen …'));return;}
    if(data.error){target.append(node('p','Verlauf konnte nicht geladen werden. Bitte schliessen und erneut öffnen.','vehicle-error'));return;}
    if(!data.entries.length){target.append(node('p','Noch keine Einträge.'));return;}
    const ordered=node('ol','','vehicle-history');
    for(const entry of data.entries){
      const row=node('li'),name=entry.actor?.name||'Unbekannte Person';
      if(entry.type==='fuel'){row.append(node('strong','Tanken · '+km(entry.km)),node('p',name+' · '+date(entry.start)));}
      else if(entry.type==='takeover'){row.append(node('strong','Fahrzeug übernommen'),node('p',(entry.from?.name||'Andere Person')+' → '+name),node('p',date(entry.start)));}
      else{row.append(node('strong',name+' · '+(entry.type==='day'?'Nutzung nachgetragen':'In Gebrauch')),node('p',date(entry.start)+' → '+(entry.end?date(entry.end):'Noch in Gebrauch')));if(entry.takenOverBy)row.append(node('p','Durch '+entry.takenOverBy.name+' übernommen.'));}
      ordered.append(row);
    }
    target.append(ordered);
    if(data.entries.length===data.limit){const more=button('Weitere Einträge laden','more',id,'secondary');target.append(more);}
  }
  function watchHistory(id,limit=30){
    histories.get(id)?.unsubscribe?.();
    const state={limit,entries:[],unsubscribe:null};histories.set(id,state);
    state.unsubscribe=db.collection('fahrzeuge').doc(id).collection('verlauf').orderBy('createdAt','desc').limit(limit).onSnapshot(snapshot=>{state.entries=snapshot.docs.map(doc=>doc.data());state.error=false;historyList(id);},()=>{state.error=true;historyList(id);});
    historyList(id);
  }
  function render(){
    const focus=document.activeElement;const restore=focus?.dataset?.action?{action:focus.dataset.action,id:focus.dataset.id}:null;
    list.replaceChildren();const ownVehicle=vehicles.find(v=>v.active?.uid===user?.uid);const query=(search?.value||'').trim().toLocaleLowerCase('de-CH');
    const visible=vehicles.filter(v=>(!(overview||onlyFavorites?.checked)||favorites.has(v.id))&&(v.name+' '+v.plate).toLocaleLowerCase('de-CH').includes(query)).sort((a,b)=>Number(favorites.has(b.id))-Number(favorites.has(a.id))||a.name.localeCompare(b.name,'de-CH'));
    if(overview)document.getElementById('vehicleCount').textContent=String(visible.length);
    if(!visible.length)list.append(node('p',overview?'Speichere Fahrzeuge im Bereich „Fahrzeuge“ mit dem Stern als Favoriten.':vehicles.length?'Keine Fahrzeuge für diese Auswahl.':'Noch keine Fahrzeuge angelegt.'));
    for(const v of visible){
      const card=node('article','','vehicle-card'+(v.id===selected?' vehicle-selected':''));card.id='vehicle-'+v.id;
      const header=node('header'),title=node('div');title.append(node('h2',v.name),node('p',v.plate,'vehicle-plate'));
      const favorite=button(favorites.has(v.id)?'★':'☆','favorite',v.id,'favorite');favorite.setAttribute('aria-label',favorites.has(v.id)?v.name+' aus Favoriten entfernen':v.name+' als Favorit speichern');favorite.setAttribute('aria-pressed',String(favorites.has(v.id)));const tools=node('div','','vehicle-card-tools');tools.append(favorite);
      const menu=node('details');menu.className='vehicle-menu';const toggle=node('summary','⋮');toggle.setAttribute('aria-label','Fahrzeugmenü für '+v.name);toggle.title='Fahrzeugmenü';const menuItems=node('div','','vehicle-menu-items');menuItems.append(button('QR-Code herunterladen','qr',v.id,'secondary'));menu.append(toggle,menuItems);tools.append(menu);header.append(title,tools);card.append(header);
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
      const details=node('details');details.dataset.history=v.id;details.open=openHistory.has(v.id);details.append(node('summary','Nutzungs- und Tankverlauf'));const history=node('div');history.dataset.historyList=v.id;history.className='vehicle-history-scroll';history.tabIndex=0;history.setAttribute('role','region');history.setAttribute('aria-label','Nutzungs- und Tankverlauf für '+v.name);details.append(history);details.addEventListener('toggle',()=>{if(!details.isConnected)return;if(details.open){openHistory.add(v.id);if(!histories.has(v.id))watchHistory(v.id);else historyList(v.id);}else{openHistory.delete(v.id);histories.get(v.id)?.unsubscribe?.();histories.delete(v.id);}});card.append(details);list.append(card);if(details.open)historyList(v.id);
    }
    if(restore){const target=[...list.querySelectorAll('button')].find(n=>n.dataset.action===restore.action&&n.dataset.id===restore.id);target?.focus({preventScroll:true});}
    if(selected&&!selectedScrolled){const card=document.getElementById('vehicle-'+selected);if(card){selectedScrolled=true;card.scrollIntoView({behavior:'smooth',block:'start'});}}
  }
  function downloadQr(v){
    const url=new URL('fahrzeuge.html',location.href);url.searchParams.set('fahrzeug',v.id);url.searchParams.set('scan','1');
    const qr=qrcode(0,'M');qr.addData(url.href);qr.make();
    const blob=new Blob([qr.createSvgTag({cellSize:8,margin:32,scalable:true})],{type:'image/svg+xml'});
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
    if(action==='more'){watchHistory(v.id,(histories.get(v.id)?.limit||30)+30);return;}
    if(!LagerAccess.write('fahrzeuge'))return;
    if(action==='start'){await act(v,action);return;}
    openDialog(action,v);
  });
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
  search?.addEventListener('input',render);onlyFavorites?.addEventListener('change',render);
  LagerAccess.onAuthStateChanged(current=>{
    user=current;unsubVehicles?.();unsubFavorites?.();for(const state of histories.values())state.unsubscribe?.();histories.clear();openHistory.clear();favorites.clear();vehicles=[];
    if(!user){location.replace('home.html'+(scanRequested?'?vehicleScan='+encodeURIComponent(selected||''):''));return;}
    if(overview){const hidden=!LagerAccess.read('fahrzeuge');document.getElementById('myVehiclesSection').hidden=hidden;document.getElementById('vehicleStat').hidden=hidden;if(hidden)return;}
    document.getElementById('appContent').style.display='block';const add=document.getElementById('addVehicle');if(add)add.hidden=!LagerAccess.write('fahrzeugeErstellen');
    unsubVehicles=db.collection('fahrzeuge').onSnapshot(snapshot=>{vehicles=snapshot.docs.map(doc=>({...doc.data(),id:doc.id}));status.textContent=overview?'Belegung wird automatisch aktualisiert.':vehicles.length+' Fahrzeuge · Belegung wird automatisch aktualisiert';render();handleScan();},error=>{status.textContent=errorText(error);status.className='vehicle-error';});
    unsubFavorites=db.collection('fahrzeug_favoriten').doc(user.uid).collection('fahrzeuge').onSnapshot(snapshot=>{favorites=new Set(snapshot.docs.map(doc=>doc.id));render();},()=>{status.textContent='Favoriten konnten nicht geladen werden. Bitte die Firestore-Regeln prüfen.';});
  });
})();
