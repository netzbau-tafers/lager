(function(){
  'use strict';
  const $=id=>document.getElementById(id),form=$('logbookSearch'),submit=$('logbookSubmit'),more=$('logbookMore'),status=$('logbookStatus'),results=$('logbookResults'),select=$('logbookVehicle');
  const functions=firebase.app().functions('europe-west1'),search=functions.httpsCallable('lagerVehicleLogbook'),catalog=functions.httpsCallable('lagerVehicleLogbookVehicles');
  let query=null,cursor=null,busy=false,generation=0,entries=new Map(),vehicles=[],session=null;
  const pretty=ms=>new Intl.DateTimeFormat('de-CH',{timeZone:'Europe/Zurich',dateStyle:'short',timeStyle:'short'}).format(new Date(ms));
  $('logbookDate').value=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Zurich',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  function node(tag,text,cls){const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;}
  function render(){
    results.replaceChildren();
    const selectedVehicle=vehicles.find(v=>v.id===query?.vehicleId);
    const ordered=[...entries.values()].sort((a,b)=>a.start-b.start);
    if(!ordered.length)return;

    const table=node('table','','logbook-table');
    const head=document.createElement('thead'),headerRow=document.createElement('tr');
    for(const label of ['Zeitpunkt','Art','Fahrzeug','Person','Hinweise']){
      const th=node('th',label);th.scope='col';headerRow.append(th);
    }
    head.append(headerRow);table.append(head);
    const body=document.createElement('tbody');
    for(const e of ordered){
      const isFuel=e.type==='fuel',isBackfill=e.type==='backfill';
      const kind=isFuel?'fuel':isBackfill?'backfill':'usage';
      const kindLabel=isFuel?'Tanken':isBackfill?'Nachtrag':'Nutzung';
      const tr=node('tr','','logbook-row '+kind);
      const vehicleName=e.vehicleName||selectedVehicle?.name||'Fahrzeug';
      const plate=e.plate||selectedVehicle?.plate||'';
      const period=isFuel?pretty(e.start):pretty(e.start)+' → '+(e.end==null?'Offen':pretty(e.end));
      const type=node('span',kindLabel,'logbook-type '+kind);
      const vehicleCell=node('span',vehicleName,'logbook-vehicle-name');
      if(plate)vehicleCell.append(node('small',plate,'logbook-plate'));
      let details='';
      if(isFuel)details=Number(e.km).toLocaleString('de-CH')+' km';
      else if(isBackfill){
        details=e.status==='pending'?'Bestätigung ausstehend':'Bestätigter Nachtrag';
        if(e.requestedBy?.name)details+=' · nachgetragen von '+e.requestedBy.name;
      }else if(e.end==null)details='Rückgabe nicht erfasst';
      else if(e.reason==='übernommen')details='Nutzung durch Übernahme beendet.';
      const cells=[
        ['Zeitpunkt',node('span',period)],
        ['Art',type],
        ['Fahrzeug',vehicleCell],
        ['Person',node('span',e.actor?.name||'Unbekannte Person')],
        ['Hinweise',node('span',details||'–',details?'logbook-detail':'logbook-empty')]
      ];
      for(const [label,content] of cells){
        const td=document.createElement('td');td.dataset.label=label;td.append(content);tr.append(td);
      }
      body.append(tr);
    }
    table.append(body);results.append(table);
  }
  function controls(){submit.disabled=busy||!session||!vehicles.length;more.disabled=busy;more.hidden=!cursor;}
  async function load(reset){
    if(busy||!session)return;
    if(reset){query={vehicleId:select.value,date:$('logbookDate').value,time:$('logbookTime').value,kind:$('logbookKind').value};cursor=null;entries.clear();render();}
    const token=generation;busy=true;controls();status.textContent='Einträge werden gesucht …';
    try{const response=await search({...query,cursor});if(token!==generation)return;const data=response.data;for(const e of data.entries)entries.set(e.id,e);cursor=data.cursor;render();status.textContent=entries.size+' Einträge angezeigt.'+(cursor?' Weitere Ergebnisse können nachgeladen werden.':' Suche abgeschlossen.')+(data.openWarning?' Mehrere offene Nutzungen gefunden; bitte Belegung prüfen.':'');}
    catch(error){if(token===generation)status.textContent=error.code==='functions/failed-precondition'?'Die Suche ist noch nicht bereit oder die Ergebnisse haben sich geändert. Bitte erneut suchen; gegebenenfalls müssen die Firestore-Indizes bereitgestellt werden.':error.message||'Suche fehlgeschlagen.';}
    finally{if(token===generation){busy=false;controls();}}
  }
  form.addEventListener('submit',event=>{event.preventDefault();void load(true);});more.addEventListener('click',()=>void load(false));
  window.LagerAccess.onAuthStateChanged(async user=>{
    const token=++generation;session=user;busy=false;cursor=null;query=null;entries.clear();results.replaceChildren();controls();
    if(!user){location.replace('home.html');return;}
    $('appContent').style.display='block';status.textContent='Fahrzeugauswahl wird geladen …';
    try{const response=await catalog({});if(token!==generation)return;vehicles=response.data.vehicles;window.dispatchEvent(new CustomEvent('logbook:vehicles',{detail:vehicles}));select.replaceChildren(node('option','Fahrzeug auswählen'));select.firstChild.value='';select.append(Object.assign(node('option','Alle'),{value:'all'}));for(const v of vehicles){const option=node('option',v.name+' · '+v.plate+(v.deleted?' (gelöscht)':''));option.value=v.id;select.append(option);}status.textContent=vehicles.length?'Fahrzeug und Datum auswählen, dann suchen.':'Keine Fahrzeuge vorhanden.';}
    catch(error){if(token===generation)status.textContent=error.message||'Fahrzeuge konnten nicht geladen werden.';}
    finally{if(token===generation)controls();}
  });
})();
