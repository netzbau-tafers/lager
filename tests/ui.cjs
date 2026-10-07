const {JSDOM,VirtualConsole}=require('jsdom');const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.join(__dirname,'..'),mock=require('./mock-firebase.cjs');
async function open(file,scenario){
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!/Not implemented/.test(e.message))errors.push(e.message);});
 const dom=new JSDOM(fs.readFileSync(path.join(root,file),'utf8'),{url:'http://localhost/'+file,runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});const w=dom.window;
 w.addEventListener('error',e=>errors.push(e.message));w.matchMedia=()=>({matches:false,addEventListener:()=>{}});w.alert=()=>{};w.confirm=()=>true;w.fetch=async()=>({ok:true,json:async()=>({infos:[]})});w.requestAnimationFrame=()=>0;w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({createLinearGradient:()=>({addColorStop:()=>{}})},{get:(target,key)=>target[key]||(()=>{})});
 w.eval('('+mock.toString()+')('+JSON.stringify(scenario)+')');
 let scripts='';for(const node of w.document.querySelectorAll('script')){const src=node.getAttribute('src');if(src&&!src.startsWith('https://'))scripts+=fs.readFileSync(path.join(root,src.split('?')[0]),'utf8')+'\n';else if(!src)scripts+=node.textContent+'\n';}w.eval(scripts);
 await new Promise(resolve=>setTimeout(resolve,40));return {w,dom,errors};
}
(async()=>{
 let checked=0;
 let {w,dom,errors}=await open('benutzer.html',{user:{uid:'pmyu29TlC3QM7JIysmy2EmiHSWW2',email:'martin@example.com'}});
 assert.equal(w.document.querySelectorAll('.user-card').length,2);assert.equal(w.document.querySelectorAll('select:disabled').length,7);
 const worker=[...w.document.querySelectorAll('.user-card')].find(card=>card.textContent.includes('Max Muster'));worker.querySelector('input').value='Neuer Name';worker.querySelector('select').value='view';worker.querySelector('button').click();await new Promise(r=>setTimeout(r,10));assert(w.saved.some(x=>x.username==='Neuer Name'));assert(w.saved.some(x=>x.permissions?.kabellager==='view'));assert.deepEqual(errors,[]);dom.window.close();checked++;
 const user={uid:'worker',email:'max@example.com'},permissions={kabellager:'view',baustellen:'none',archiv:'none',kabelreport:'none',logs:'none',spiel:'none',gespart:'none'};
 ({w,dom,errors}=await open('benutzer.html',{user}));assert(!w.calls.some(x=>x[0]==='get'&&x[1]==='users'));assert(w.document.getElementById('userAdmin').hidden);assert.deepEqual(errors,[]);w.close();checked++;
 ({w,dom,errors}=await open('index.html',{user,permissions,records:{bobinen:{test:{nummer:'123',typ:'Kabel',laenge:10,status:'Lager'}}}}));assert(w.document.getElementById('accessReadOnly'));assert([...w.document.querySelectorAll('[data-access-write]')].every(node=>node.hidden));assert.equal(w.localStorage.getItem('lagerUsername'),'Max Muster');assert(w.document.querySelector('.js-edit-bobine')?.hidden);const before=w.saved.length;w.eval('openAdd()');assert.equal(w.saved.length,before);assert.deepEqual(errors,[]);w.close();checked++;
 ({w,dom,errors}=await open('baustellen.html',{user,permissions}));assert(!w.calls.some(x=>x[1]==='baustellen'));assert.deepEqual(errors,[]);w.close();checked++;
 ({w,dom,errors}=await open('meine-uebersicht.html',{user,permissions}));assert(!w.calls.some(x=>x[1]==='baustellen'));assert(w.document.getElementById('mySitesSection').hidden);assert.deepEqual(errors,[]);w.close();checked++;
 const allView=Object.fromEntries(['kabellager','baustellen','archiv','kabelreport','logs','spiel','gespart'].map(k=>[k,'view']));
 for(const file of ['baustellen.html','archiv.html','logs.html','kabel-report.html','profil.html','home.html','hilfe.html','datenschutz.html','strommast-game.html']){({w,dom,errors}=await open(file,{user,permissions:allView}));assert.deepEqual(errors,[],file);if(['baustellen.html','archiv.html','logs.html','kabel-report.html','strommast-game.html'].includes(file))assert(w.document.getElementById('accessReadOnly'),file);w.close();checked++;}
 console.log('Passed '+checked+' DOM integration scenarios with mock Firebase.');
})().catch(error=>{console.error(error);process.exitCode=1;});
