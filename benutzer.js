(function(){
  'use strict';
  const db=firebase.firestore(),list=document.getElementById('userList'),status=document.getElementById('userStatus'),search=document.getElementById('userSearch'),refresh=document.getElementById('userRefresh');
  let rows=[],busy=false;
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
      const permissions=row.access?.permissions||LagerAccess.defaults(row.id);
      for(const [key,name]of Object.entries(LagerAccess.areas)){const label=text('label',name),select=document.createElement('select');for(const [value,title]of [['none','Gesperrt'],['view','Nur ansehen'],['edit','Ansehen und bearbeiten']]){const option=text('option',title);option.value=value;select.append(option);}select.value=master?'edit':permissions[key]||'none';select.disabled=master;selects[key]=select;label.append(select);grid.append(label);}
      card.append(grid);const save=text('button','Änderungen speichern');save.type='button';const feedback=text('p','');feedback.className='user-feedback';feedback.setAttribute('role','status');card.append(save,feedback);
      save.addEventListener('click',async()=>{
        save.disabled=true;feedback.textContent='Wird gespeichert …';
        try{
          // Profile names and access rights change atomically; metadata stays intact.
          const batch=db.batch(),timestamp=firebase.firestore.FieldValue.serverTimestamp(),username=clean(input.value);
          batch.set(db.collection('users').doc(row.id),{username,updatedAt:timestamp},{merge:true});
          const selected=Object.fromEntries(Object.entries(selects).map(([key,select])=>[key,select.value]));
          if(!master)batch.set(db.collection('user_access').doc(row.id),{permissions:selected,updatedAt:timestamp,updatedBy:auth.currentUser.uid});
          await batch.commit();row.username=username;if(!master)row.access={permissions:selected};input.value=username;feedback.style.color='#1b5e20';feedback.textContent='Gespeichert. Zugriffsänderungen werden auf geöffneten Seiten übernommen.';
        }catch(error){console.error(error);feedback.style.color='#b3261e';feedback.textContent='Speichern fehlgeschlagen. Prüfe, ob die neuen Firestore-Regeln veröffentlicht sind.';}finally{save.disabled=false;}
      });list.append(card);
    }
  }
  async function load(){if(busy)return;busy=true;refresh.disabled=true;status.textContent='Benutzer werden geladen …';try{const [profiles,access]=await Promise.all([db.collection('users').get(),db.collection('user_access').get()]);const map=new Map(access.docs.map(doc=>[doc.id,doc.data()]));rows=profiles.docs.map(doc=>({...doc.data(),id:doc.id,access:map.get(doc.id)})).sort((a,b)=>String(a.username||a.email||a.id).localeCompare(String(b.username||b.email||b.id),'de-CH'));status.textContent=rows.length+' Benutzerprofile';render();}catch(error){console.error(error);list.replaceChildren();status.textContent='Benutzer konnten nicht geladen werden. Bitte zuerst die neuen Firestore-Regeln veröffentlichen.';}finally{busy=false;refresh.disabled=false;}}
  search.addEventListener('input',render);refresh.addEventListener('click',load);
  LagerAccess.onAuthStateChanged(user=>{if(!user){location.replace('home.html');return;}document.getElementById('userAdmin').hidden=false;return load();});
})();
