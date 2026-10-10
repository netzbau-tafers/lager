'use strict';
const {JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict');
const master='pmyu29TlC3QM7JIysmy2EmiHSWW2',tick=()=>new Promise(r=>setTimeout(r,20));
async function scenario(uid){
 const dom=new JSDOM(fs.readFileSync('../fahrtenbuch.html','utf8'),{url:'https://example.test/fahrtenbuch.html',runScripts:'outside-only'}),w=dom.window,calls=[],downloads=[];
 const job={id:'export1',from:'2025-01-01',to:'2025-12-31',vehicleLabel:'Unimog',count:2,visibleCount:2,deletable:1,parts:1,status:'ready',digest:'hash',createdAt:Date.now(),nextDeletePart:0,nextRestorePart:0,deleted:0,skipped:0,restored:0};
 const record=(type,name)=>({path:'fahrzeuge/bus/verlauf/'+type,version:'1:0',fields:{type:{stringValue:type},actor:{mapValue:{fields:{name:{stringValue:name}}}},start:{timestampValue:'2025-01-01T12:00Z'},end:{timestampValue:'2025-01-01T13:00Z'},km:{integerValue:'123'}},visible:true,eligible:type==='fuel',vehicleName:'Unimog',plate:'FR 1'});
 w.firebase={app:()=>({functions:()=>({httpsCallable:name=>async data=>{calls.push({name,data});if(name.endsWith('List'))return {data:{exports:[job]}};if(name.endsWith('Prepare'))return {data:{...job}};if(name.endsWith('Read'))return {data:{records:[record('fuel','=FORMULA'),record('use','<img src=x>')],hash:'hash'}};if(name.endsWith('Delete'))return {data:{...job,status:'deleted',nextDeletePart:1,deleted:1}};if(name.endsWith('Restore'))return {data:{...job,status:'restored',nextRestorePart:1,deleted:1,restored:1}};throw Error(name);}})})};
 w.LagerAccess={onAuthStateChanged:cb=>cb({uid})};w.confirm=()=>true;w.URL.createObjectURL=blob=>{downloads.push(blob);return 'blob:test';};w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){};
 w.eval(fs.readFileSync('../fahrtenbuch-export.js','utf8'));await tick();assert.equal(calls.length,1,'no history read on opening page');
 w.dispatchEvent(new w.CustomEvent('logbook:vehicles',{detail:[{id:'bus',name:'Unimog',plate:'FR 1'}]}));assert.equal(w.document.querySelectorAll('#exportVehicle option').length,2);
 w.document.getElementById('exportForm').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();assert(!w.document.getElementById('exportCsv').disabled);assert.equal(w.document.querySelector('#exportPreview img'),null);
 w.document.getElementById('exportCsv').click();w.document.getElementById('exportJson').click();assert.equal(downloads.length,2);
 assert.equal(w.document.getElementById('exportDelete').hidden,uid!==master);
 if(uid===master){w.document.getElementById('exportDelete').click();await tick();assert(!calls.some(c=>c.name.endsWith('Delete')));w.document.getElementById('exportVerified').checked=true;w.document.getElementById('exportDelete').click();await tick();assert.equal(calls.filter(c=>c.name.endsWith('Delete')).length,1);assert(!w.document.getElementById('exportRestore').disabled);w.document.getElementById('exportRestore').click();await tick();assert.equal(calls.filter(c=>c.name.endsWith('Restore')).length,1);}
 w.close();
}
(async()=>{await scenario('worker');await scenario(master);console.log('Export UI: lazy reads, safe text, CSV/JSON, permissions, explicit delete and restore passed.');})().catch(error=>{console.error(error);process.exitCode=1;});
