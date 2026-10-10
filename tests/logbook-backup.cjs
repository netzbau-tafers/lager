'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture(){
 const sheets=new Map(),props=new Map([['FIREBASE_PROJECT_ID','demo']]),calls=[];let docs=[],code=200;
 function sheet(){const rows=[];return {rows,getLastRow:()=>rows.length,getMaxRows:()=>1000,insertRowsAfter(){},setFrozenRows(){},getRange(a,b,h=1,w=1){if(a==='B1'){a=1;b=2;}return {getDisplayValue:()=>rows[a-1]?.[b-1]||'',getValues:()=>Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>rows[a+i-1]?.[b+j-1]||'')),setNumberFormat(){return this;},setValues(values){values.forEach((r,i)=>{rows[a+i-1]??=[];r.forEach((v,j)=>rows[a+i-1][b+j-1]=v);});return this;}};}};}
 const book={getId:()=> 'book',getUrl:()=> 'https://example.test/book',getSheetByName:n=>sheets.get(n),insertSheet:n=>{const s=sheet();sheets.set(n,s);return s;}};
 const context={console:{log(){}},getConfig_:()=>({}),getServiceAccountAccessToken_:()=> 'test-token',PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k),setProperty:(k,v)=>props.set(k,v)})},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},SpreadsheetApp:{create:()=>book,openById:()=>book,flush(){}},UrlFetchApp:{fetch:(url,options)=>{calls.push(JSON.parse(options.payload));return {getResponseCode:()=>code,getContentText:()=>JSON.stringify(docs.map(document=>({document})))};}}};
 vm.createContext(context);vm.runInContext(fs.readFileSync('../apps-script/FahrtenbuchBackup.gs','utf8'),context);
 return {context,sheets,calls,set:(d,http=200)=>{docs=d;code=http;}};
}
const doc=(id,fields)=>({name:'projects/demo/databases/(default)/documents/fahrzeuge/deleted/verlauf/'+id,fields,createTime:'2026-01-01T00:00:00Z',updateTime:'2026-10-10T00:00:00Z'});
test('bootstrap legacy history, incremental rejection upsert and failed checkpoint',()=>{
 const f=fixture();f.set([doc('a',{type:{stringValue:'use'}})]);f.context.backupVehicleHistoryIncremental();
 const sheet=f.sheets.get('fahrzeug_verlauf');assert.equal(sheet.rows.length,2);assert.equal(f.calls[0].structuredQuery.where,undefined);assert.ok(f.calls[0].readTime);
 const watermark=f.sheets.get('fahrtenbuch_backup_status').rows[0][1];
 f.set([doc('a',{updatedAt:{timestampValue:'2026-10-10T00:00:00Z'},status:{stringValue:'rejected'}})]);f.context.backupVehicleHistoryIncremental();assert.equal(sheet.rows.length,2);assert.match(sheet.rows[1][2],/rejected/);assert.equal(f.calls[1].structuredQuery.where.compositeFilter.filters[0].fieldFilter.value.timestampValue,watermark);
 const checkpoint=f.sheets.get('fahrtenbuch_backup_status').rows[0][1];f.set([],403);assert.throws(()=>f.context.backupVehicleHistoryIncremental(),/HTTP 403/);assert.equal(f.sheets.get('fahrtenbuch_backup_status').rows[0][1],checkpoint);
});
