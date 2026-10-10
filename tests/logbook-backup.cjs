'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture(){
 const sheets=new Map(),props=new Map([['SPREADSHEET_ID','book']]),calls=[];let docs=[],code=200;
 function sheet(){const rows=[];return {rows,getLastRow:()=>rows.length,getMaxRows:()=>1000,insertRowsAfter(){},setFrozenRows(){},getRange(a,b,h=1,w=1){if(typeof a==='string'){b=2;a=Number(a.slice(1));}return {getValue:()=>rows[a-1]?.[b-1]||'',setValue(v){rows[a-1]??=[];rows[a-1][b-1]=v;},clearContent(){rows.splice(a-1,h);},getValues:()=>Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>rows[a+i-1]?.[b+j-1]||'')),setNumberFormat(){return this;},setValues(values){values.forEach((r,i)=>{rows[a+i-1]??=[];r.forEach((v,j)=>rows[a+i-1][b+j-1]=v);});return this;}};}};}
 const book={getId:()=> 'book',getUrl:()=> 'https://example.test/book',getSheetByName:n=>sheets.get(n),insertSheet:n=>{const s=sheet();sheets.set(n,s);return s;}};
 const context={Logger:{log(){}},fetchCollectionDocuments_:()=>docs,getRelativeDocumentPath_:n=>n.split('/documents/')[1],console:{log(){}},getConfig_:()=>({projectId:'demo'}),getServiceAccountAccessToken_:()=> 'test-token',PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k),setProperty:(k,v)=>props.set(k,v)})},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},SpreadsheetApp:{create:()=>book,openById:()=>book,flush(){}},UrlFetchApp:{fetch:(url,options)=>{if(!options.payload)return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({documents:[]})};calls.push(JSON.parse(options.payload));return {getResponseCode:()=>code,getContentText:()=>JSON.stringify(docs.map(document=>({document})))};}}};
 vm.createContext(context);vm.runInContext(fs.readFileSync('../apps-script/FahrtenbuchBackup.gs','utf8'),context);
 return {context,sheets,calls,set:(d,http=200)=>{docs=d;code=http;}};
}
const doc=(id,fields)=>({name:'projects/demo/databases/(default)/documents/fahrzeuge/deleted/verlauf/'+id,fields,createTime:'2026-01-01T00:00:00Z',updateTime:'2026-10-10T00:00:00Z'});
test('legacy bootstrap, incremental upsert, actions and failed checkpoint',()=>{
 const f=fixture();f.set([doc('a',{type:{stringValue:'use'}})]);f.context.vhBackupVehiclesUnlocked_('demo','token',false);
 const sheet=f.sheets.get('fahrtenbuch_cache'),state=f.sheets.get('fahrtenbuch_cache_status');assert.equal(sheet.rows.length,2);state.rows[1][1]='INKREMENTELL';
 const watermark=state.rows[0][1];
 f.set([doc('a',{updatedAt:{timestampValue:'2026-10-10T00:00:00Z'},createdAt:{timestampValue:'2026-10-10T00:00:00Z'},status:{stringValue:'rejected'}})]);
 f.context.vhBackupVehiclesUnlocked_('demo','token',false);assert.equal(sheet.rows.length,2);assert.match(sheet.rows[1][2],/rejected/);assert.equal(f.calls[0].structuredQuery.where.compositeFilter.filters[0].fieldFilter.value.timestampValue,watermark);assert.equal(f.calls[1].structuredQuery.from[0].collectionId,'aktionen');
 const checkpoint=state.rows[0][1];f.set([],403);assert.throws(()=>f.context.vhBackupVehiclesUnlocked_('demo','token',false),/fehlgeschlagen/);assert.equal(state.rows[0][1],checkpoint);
 f.set([]);f.context.vhBackupVehiclesUnlocked_('demo','token',true);assert.equal(state.rows[1][1],'VOLL');assert.equal(sheet.rows.length,1);
});
