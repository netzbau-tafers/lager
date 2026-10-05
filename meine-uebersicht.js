/* Only query records owned by the authenticated user. No persistent listeners. */
(function(){
  'use strict';
  const db=firebase.firestore();
  const refresh=document.getElementById('overviewRefresh');
  let currentUser=null,requestId=0;
  function time(value){
    if(!value)return 0;
    if(typeof value.toMillis==='function')return value.toMillis();
    if(typeof value.toDate==='function')return value.toDate().getTime();
    if(typeof value.seconds==='number')return value.seconds*1000;
    const n=new Date(value).getTime();return Number.isFinite(n)?n:0;
  }
  function date(value){const n=time(value);return n?new Date(n).toLocaleString('de-CH',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'Zeitpunkt nicht hinterlegt';}
  function text(tag,value,className){const node=document.createElement(tag);node.textContent=value;if(className)node.className=className;return node;}
  function link(page,param,id,label){const node=text('a',label);node.href=page+'?'+new URLSearchParams({[param]:id}).toString();return node;}
  function showCables(snapshot,uid){
    const list=document.getElementById('myCables');list.replaceChildren();
    const entries=snapshot.docs.map(doc=>({...doc.data(),id:doc.id})).filter(b=>b.inGebrauchVonUid===uid&&b.status==='In Gebrauch');
    entries.sort((a,b)=>time(a.inGebrauchAm)-time(b.inGebrauchAm));
    document.getElementById('cableCount').textContent=String(entries.length);
    if(!entries.length){list.append(text('p','Du hast aktuell keine Kabel in Gebrauch.'));return;}
    for(const b of entries){
      const start=time(b.inGebrauchAm),overdue=start>0&&Date.now()-start>=48*60*60*1000;
      const row=text('article','', 'overview-row'+(overdue?' overview-overdue':''));
      const info=document.createElement('div');info.append(text('h3','Bobine '+(b.nummer??'–')+' · '+(b.typ||'Kabeltyp nicht hinterlegt')));
      info.append(text('p',(b.laenge??'–')+' m · '+(b.baustelle||'Baustelle nicht hinterlegt')));
      info.append(text('p','In Gebrauch seit '+date(b.inGebrauchAm)));
      if(overdue)info.append(text('span','Über 48 Stunden in Gebrauch','overview-badge'));
      row.append(info,link('index.html','bobine',b.id,'Zur Bobine →'));list.append(row);
    }
  }
  function showSites(snapshot,uid){
    const list=document.getElementById('mySites');list.replaceChildren();
    const entries=snapshot.docs.map(doc=>({...doc.data(),id:doc.id})).filter(b=>b.createdByUid===uid&&b.status==='aktiv');
    entries.sort((a,b)=>time(b.createdAt)-time(a.createdAt));document.getElementById('siteCount').textContent=String(entries.length);
    if(!entries.length){list.append(text('p','Du hast aktuell keine selbst erstellten aktiven Baustellen.'));return;}
    for(const b of entries){const row=text('article','','overview-row');const info=document.createElement('div');info.append(text('h3',b.name||'Baustelle ohne Namen'),text('p','Baustelle Nr. '+(b.nummer??'–')),text('p','Verantwortlich: '+(b.verantwortlicher||'Nicht hinterlegt')),text('span','Aktiv','overview-active'));row.append(info,link('baustellen.html','baustelle',b.id,'Zur Materialliste →'));list.append(row);}
  }
  async function load(){
    const user=currentUser;if(!user)return;
    const token=++requestId,limited=LIMITED_ACCESS_UIDS.includes(user.uid);
    refresh.disabled=true;document.getElementById('overviewUpdated').textContent='Wird aktualisiert …';
    document.getElementById('siteStat').hidden=limited;document.getElementById('mySitesSection').hidden=limited;
    const requests=[db.collection('bobinen').where('inGebrauchVonUid','==',user.uid).where('status','==','In Gebrauch').get()];
    if(!limited)requests.push(db.collection('baustellen').where('createdByUid','==',user.uid).where('status','==','aktiv').get());
    const results=await Promise.allSettled(requests);
    if(token!==requestId||currentUser?.uid!==user.uid)return;
    results.forEach((result,index)=>{
      if(result.status==='fulfilled'){if(index===0)showCables(result.value,user.uid);else showSites(result.value,user.uid);}
      else{const target=document.getElementById(index===0?'myCables':'mySites');target.replaceChildren(text('p','Die Daten konnten nicht geladen werden. Bitte erneut aktualisieren.','overview-error'));document.getElementById(index===0?'cableCount':'siteCount').textContent='–';console.error('Meine Übersicht: Laden fehlgeschlagen',result.reason);}
    });
    refresh.disabled=false;
    const failed=results.some(r=>r.status==='rejected');document.getElementById('overviewUpdated').textContent=failed?'Ein Bereich konnte nicht geladen werden.':'Zuletzt aktualisiert: '+new Date().toLocaleTimeString('de-CH',{hour:'2-digit',minute:'2-digit'});
  }
  refresh.addEventListener('click',load);
  auth.onAuthStateChanged(user=>{
    currentUser=user;
    if(!user){requestId++;document.getElementById('myCables').replaceChildren();document.getElementById('mySites').replaceChildren();window.location.href='home.html';return;}
    setNavigationVisibility(user);document.body.style.display='block';load();
  });
})();
