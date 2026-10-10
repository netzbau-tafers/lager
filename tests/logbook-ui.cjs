'use strict';
const {JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const html=fs.readFileSync('../fahrtenbuch.html','utf8'),calls=[];
 const dom=new JSDOM(html,{url:'https://example.test/fahrtenbuch.html',runScripts:'outside-only'}),w=dom.window;
 const errors=[];w.addEventListener('error',e=>errors.push(e.message));
 w.firebase={app:()=>({functions:()=>({httpsCallable:name=>async data=>{
   calls.push({name,data});
   return {data:name==='lagerVehicleLogbookVehicles'?{vehicles:[{id:'deleted',name:'Alter Unimog',plate:'FR 123',deleted:true}]}:data.cursor?{entries:[{id:'2',type:'fuel',actor:{name:'Alice'},start:Date.now(),end:Date.now(),km:123}],cursor:null}:{entries:[{id:'1',type:'backfill',actor:{name:'<img src=x onerror=alert(1)>'},requestedBy:{name:'Bob'},start:Date.now(),end:null,status:'pending'}],cursor:'1'}};
 }})})};
 w.LagerAccess={onAuthStateChanged:async cb=>cb({uid:'alice'})};
 w.eval(fs.readFileSync('../fahrtenbuch.js','utf8'));const tick=()=>new Promise(r=>setTimeout(r,20));await tick();
 assert.equal(calls.length,1,'loading page must not read history');assert.match(w.document.querySelector('#logbookVehicle').textContent,/gelöscht/);
 w.document.querySelector('#logbookVehicle').value='deleted';w.document.querySelector('#logbookSearch').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();
 assert.equal(calls.length,2);assert.match(w.document.querySelector('#logbookResults').textContent,/Bestätigung ausstehend/);assert.match(w.document.querySelector('#logbookResults').textContent,/Rückgabe nicht erfasst/);assert.equal(w.document.querySelector('#logbookResults img'),null);
 w.document.querySelector('#logbookMore').click();await tick();assert.equal(calls[2].data.cursor,'1');assert.equal(w.document.querySelectorAll('#logbookResults article').length,2);assert.equal(w.document.querySelector('#logbookMore').hidden,true);assert.deepEqual(errors,[]);dom.window.close();console.log('Fahrtenbuch UI: lazy history, deleted vehicles, confirmation/open labels, pagination and safe text passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
