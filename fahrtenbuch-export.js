(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const functions=firebase.app().functions('europe-west1'),call=name=>functions.httpsCallable('lagerVehicleExport'+name);
  const prepare=call('Prepare'),read=call('Read'),list=call('List'),remove=call('Delete'),restore=call('Restore');
  let session=null,busy=false,job=null,records=[],generation=0,loaded=false,archives=[];
  const statusNames={ready:'bereit',deleting:'Löschung begonnen',deleted:'gelöscht',restoring:'Wiederherstellung begonnen',restored:'wiederhergestellt'};
  const pretty=ms=>ms===null?'Rückgabe nicht erfasst':new Intl.DateTimeFormat('de-CH',{timeZone:'Europe/Zurich',dateStyle:'short',timeStyle:'short'}).format(new Date(ms));
  function node(tag,text){const n=document.createElement(tag);n.textContent=text;return n;}
  function ms(v){return v?.timestampValue?Date.parse(v.timestampValue):null;}
  function text(v){return v?.stringValue||'';}
  function map(v){return v?.mapValue?.fields||{};}
  function values(r){const f=r.fields,actor=map(f.actor),requester=map(f.requestedBy);return [r.vehicleName,r.plate,text(f.type)==='fuel'?'Tankung':'Nutzung',text(actor.name),text(actor.uid),pretty(ms(f.start)),pretty(ms(f.end)),f.km?.integerValue??f.km?.doubleValue??'',({pending:'Bestätigung ausstehend',confirmed:'Bestätigt',rejected:'Abgelehnt'}[text(f.status)]||text(f.status)),text(requester.name),r.eligible?'Ja':'Nein'];}
  const headings=['Fahrzeug','Kennzeichen','Eintrag','Person','Benutzer-ID','Beginn','Ende','Kilometerstand','Bestätigung','Nachgetragen von','Zum Löschen geeignet'];
  function controls(){
    const admin=!!session&&LagerAccess.write('fahrtenbuchExport');
    $('exportSection').hidden=!admin;
    $('exportPrepare').disabled=busy||!session||!LagerAccess.write('fahrtenbuchExport');
    for(const id of ['exportCsv','exportJson','exportPrint'])$(id).disabled=busy||!loaded;
    $('exportDelete').hidden=!admin;$('exportRestore').hidden=!admin;
    $('exportDelete').disabled=busy||!loaded||!job?.deletable||!['ready','deleting'].includes(job?.status);
    $('exportRestore').disabled=busy||!job||!['deleted','restoring'].includes(job.status);
    $('exportExisting').disabled=busy;$('exportLoad').disabled=busy||!$('exportExisting').value;
    $('exportVerified').disabled=busy;
  }
  function preview(){
    const target=$('exportPreview');target.replaceChildren();if(!job)return;
    target.append(node('p',job.vehicleLabel+' · '+job.from+' bis '+job.to),node('p',job.visibleCount+' Nutzungen und Tankungen · '+job.deletable+' Einträge einschliesslich Übernahmevermerken können höchstens gelöscht werden. Offene, ausstehende und grenzüberschreitende Nutzungen bleiben erhalten.'));
    const counts=new Map();for(const r of records){if(!r.visible)continue;const key=r.vehicleName+' · '+r.plate;const c=counts.get(key)||{use:0,fuel:0};c[text(r.fields.type)==='fuel'?'fuel':'use']++;counts.set(key,c);}
    const ul=node('ul','');for(const [name,c]of counts)ul.append(node('li',name+': '+c.use+' Nutzungen, '+c.fuel+' Tankungen'));target.append(ul);
    if(['deleted','restoring','restored','deleting'].includes(job.status))target.append(node('p',job.deleted+' gelöscht · '+job.skipped+' übersprungen · '+job.restored+' wiederhergestellt.'));
  }
  async function allParts(token){
    records=[];loaded=false;$('exportVerified').checked=false;
    for(let part=0;part<job.parts;part++){const response=await read({id:job.id,part});if(token!==generation)return;records.push(...response.data.records);$('exportStatus').textContent='Sicherung laden: '+(part+1)+' / '+job.parts;}
    if(token!==generation)return;
    if(records.length!==job.count)throw Error('Der Export ist unvollständig. Es wird nichts gelöscht.');loaded=true;preview();
  }
  async function refreshList(token){const response=await list({});if(token!==generation)return;archives=response.data.exports;$('exportExisting').replaceChildren(node('option','Gespeicherte Sicherung auswählen'));$('exportExisting').firstChild.value='';for(const e of archives){const option=node('option',e.from+'–'+e.to+' · '+e.vehicleLabel+' · '+e.visibleCount+' Einträge · '+(statusNames[e.status]||e.status));option.value=e.id;$('exportExisting').append(option);}}
  async function run(action){if(busy||!session||!LagerAccess.write('fahrtenbuchExport'))return;const token=generation;busy=true;controls();try{await action(token);}catch(error){if(token===generation)$('exportStatus').textContent=error.message||'Aktion fehlgeschlagen. Die Sicherung bleibt erhalten; der Vorgang kann fortgesetzt werden.';}finally{if(token===generation){busy=false;controls();}}}
  $('exportForm').addEventListener('submit',event=>{event.preventDefault();void run(async token=>{
    loaded=false;job=null;records=[];preview();$('exportStatus').textContent='Einträge werden geprüft und separat gesichert …';
    const response=await prepare({vehicleId:$('exportVehicle').value,from:$('exportFrom').value,to:$('exportTo').value});if(token!==generation)return;job=response.data;await allParts(token);if(token!==generation)return;await refreshList(token);$('exportStatus').textContent='Export bereit. CSV und Wiederherstellungsdatei speichern; PDF über „PDF / Drucken“ speichern oder ausdrucken.';
  });});
  function download(content,type,suffix){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=node('a','');a.href=url;a.download='Fahrtenbuch-'+job.from+'_'+job.to+'-'+job.id+'.'+suffix;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  $('exportCsv').addEventListener('click',()=>{if(!loaded||busy)return;const cell=value=>{let s=String(value??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};const rows=[headings,...records.filter(r=>r.visible).sort((a,b)=>ms(a.fields.start)-ms(b.fields.start)).map(values)];download('\ufeff'+rows.map(row=>row.map(cell).join(';')).join('\r\n'),'text/csv;charset=utf-8','csv');});
  $('exportJson').addEventListener('click',()=>{if(!loaded||busy)return;download(JSON.stringify({format:'lager-fahrtenbuch-v1',export:job,records},null,2),'application/json','json');});
  $('exportPrint').addEventListener('click',()=>{
    if(!loaded||busy)return;const popup=window.open('','_blank');if(!popup){$('exportStatus').textContent='Bitte Pop-ups für die Druckansicht erlauben.';return;}
    const doc=popup.document;doc.title='Fahrtenbuch '+job.from+' bis '+job.to;doc.documentElement.lang='de';
    const style=doc.createElement('style');style.textContent='body{font:11px Arial;color:#111;margin:16mm}h1{font-size:20px}table{width:100%;border-collapse:collapse}th,td{padding:5px;border:1px solid #ccc;text-align:left;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}button{padding:10px}@page{size:A4 landscape;margin:12mm}@media print{button{display:none}}';doc.head.append(style);
    const add=(tag,s)=>{const n=doc.createElement(tag);n.textContent=s;return n;};
    const print=add('button','Drucken / Als PDF speichern');print.type='button';print.addEventListener('click',()=>popup.print());doc.body.append(print,add('h1','Fahrtenbuch'),add('p',job.vehicleLabel+' · '+job.from+' bis '+job.to+' · Schweizer Ortszeit'),add('p','Export-ID: '+job.id+' · Erstellt: '+pretty(job.createdAt)));
    const table=doc.createElement('table'),head=doc.createElement('thead'),row=doc.createElement('tr');const cols=[0,1,2,3,5,6,7,8];for(const i of cols)row.append(add('th',headings[i]));head.append(row);table.append(head);const body=doc.createElement('tbody');for(const r of records.filter(r=>r.visible).sort((a,b)=>ms(a.fields.start)-ms(b.fields.start))){const tr=doc.createElement('tr'),v=values(r);for(const i of cols)tr.append(add('td',v[i]));body.append(tr);}table.append(body);doc.body.append(table);
  });
  $('exportExisting').addEventListener('change',controls);
  $('exportLoad').addEventListener('click',()=>void run(async token=>{job=archives.find(e=>e.id===$('exportExisting').value);if(!job)return;await allParts(token);if(token===generation)$('exportStatus').textContent='Sicherung geladen. Export erneut speichern oder einen begonnenen Vorgang fortsetzen.';}));
  $('exportDelete').addEventListener('click',()=>{
    if(!loaded||!job||!LagerAccess.write('fahrtenbuchExport')||busy)return;
    if(!$('exportVerified').checked){$('exportStatus').textContent='Bitte zuerst Dateien speichern, öffnen und die Prüfung bestätigen.';return;}
    if(!window.confirm(job.vehicleLabel+'\n'+job.from+' bis '+job.to+'\nHöchstens '+job.deletable+' gesicherte Einträge löschen?\nGeänderte, offene und neue Einträge bleiben erhalten. Das laufende Sheets-Backup wird beim nächsten Backup bereinigt.'))return;
    void run(async token=>{
      while(job.nextDeletePart<job.parts){const response=await remove({id:job.id,part:job.nextDeletePart,digest:job.digest,confirmed:true});if(token!==generation)return;job=response.data;preview();$('exportStatus').textContent='Löschen: '+job.nextDeletePart+' / '+job.parts;}
      await refreshList(token);if(token===generation)$('exportStatus').textContent=job.deleted+' Einträge gelöscht; '+job.skipped+' übersprungen. Sicherung bleibt erhalten. Sheets wird beim nächsten erfolgreichen Backup bereinigt.';
    });
  });
  $('exportRestore').addEventListener('click',()=>{
    if(!LagerAccess.write('fahrtenbuchExport')||busy||!job)return;if(!window.confirm('Die tatsächlich gelöschten Einträge aus dieser Sicherung wiederherstellen? Bereits vorhandene Einträge werden nicht überschrieben.'))return;
    void run(async token=>{while(job.nextRestorePart<job.parts){const response=await restore({id:job.id,part:job.nextRestorePart,confirmed:true});if(token!==generation)return;job=response.data;preview();$('exportStatus').textContent='Wiederherstellen: '+job.nextRestorePart+' / '+job.parts;}await refreshList(token);if(token===generation)$('exportStatus').textContent=job.restored+' Einträge wiederhergestellt. Das nächste Backup ergänzt diese wieder.';});
  });
  window.addEventListener('logbook:vehicles',event=>{$('exportVehicle').replaceChildren(node('option','Alle Fahrzeuge'));$('exportVehicle').firstChild.value='all';for(const v of event.detail){const option=node('option',v.name+' · '+v.plate+(v.deleted?' (gelöscht)':''));option.value=v.id;$('exportVehicle').append(option);}});
  window.LagerAccess.onAuthStateChanged(user=>{generation++;session=user;busy=false;loaded=false;job=null;records=[];archives=[];preview();$('exportVerified').checked=false;controls();if(user&&LagerAccess.write('fahrtenbuchExport'))void run(async token=>{await refreshList(token);if(token===generation)$('exportStatus').textContent='Zeitraum auswählen und Export erstellen. Beim Öffnen werden keine historischen Fahrten geladen.';});});
  const year=Number(new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Zurich',year:'numeric'}).format(new Date()))-1;$('exportFrom').value=year+'-01-01';$('exportTo').value=year+'-12-31';controls();
})();

