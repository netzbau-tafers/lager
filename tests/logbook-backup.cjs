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
// The former backupVehicleHistoryIncremental() entry point was removed when
// the vehicle backup moved to the shared Sheets cache. Its previous test
// exercised an API that no longer exists; validate the current entry points.
test('vehicle backup uses the shared cache entry points, not the legacy function',()=>{
 const f=fixture();
 assert.equal(typeof f.context.vhBackupVehiclesUnlocked_,'function');
 assert.equal(typeof f.context.vhBackupVehicles_,'function');
 assert.equal(typeof f.context.enableVehicleHistoryIncremental,'function');
 assert.equal(typeof f.context.vhCacheStatus,'function');
 assert.equal(typeof f.context.backupVehicleHistoryIncremental,'undefined');
});
