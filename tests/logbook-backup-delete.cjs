'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture({status=404,queryStatus=200,commitStatus=200}={}){
 const path='fahrzeuge/bus/verlauf/old',root='projects/demo/databases/(default)/documents',calls=[];
 const context={Date,JSON,Error,Logger:{log(){}},UrlFetchApp:{fetch(url,options){calls.push({url,options});let code=200,body;
  if(url.endsWith(':runQuery')){code=queryStatus;body=[{document:{name:root+'/fahrtenbuch_loeschungen/export_0',updateTime:'2026-10-10T00:00Z',fields:{paths:{arrayValue:{values:[{stringValue:path}]}},backupAppliedAt:{nullValue:null}}}}];}
  else if(url.endsWith(':batchGet')){code=status===404||status===200?200:status;body=status===200?[{found:{name:root+'/'+path,fields:{type:{stringValue:'use'}}}}]:[{missing:root+'/'+path}];}
  else if(url.endsWith(':commit')){code=commitStatus;body={};}else{code=status;body={name:root+'/'+path,fields:{type:{stringValue:'use'}}};}
  return {getResponseCode:()=>code,getContentText:()=>JSON.stringify(body)};
 }} };
 vm.createContext(context);vm.runInContext(fs.readFileSync('../apps-script/FahrtenbuchBackup.gs','utf8'),context);return {context,path,calls};
}
test('pending deletion removes exact cache entry; acknowledgement is separate',()=>{
 const f=fixture(),cache={[f.path]:{old:true},'fahrzeuge/bus/verlauf/keep':{keep:true}};
 const pending=f.context.vhApplyHistoryDeletions_('demo','token',cache);assert(!cache[f.path]);assert(cache['fahrzeuge/bus/verlauf/keep']);assert.equal(f.calls.length,2);
 f.context.vhConfirmHistoryDeletions_('demo','token',pending);const write=JSON.parse(f.calls.at(-1).options.payload).writes[0];assert.deepEqual(write.updateMask.fieldPaths,['backupAppliedAt']);assert.equal(write.currentDocument.updateTime,'2026-10-10T00:00Z');
});
test('restored live document is preserved in cache',()=>{const f=fixture({status:200}),cache={[f.path]:{old:true}};f.context.vhApplyHistoryDeletions_('demo','token',cache);assert.equal(cache[f.path].fields.type.stringValue,'use');});
test('failed reads or acknowledgement do not silently report success',()=>{
 for(const options of [{status:403},{queryStatus:403}]){const f=fixture(options);assert.throws(()=>f.context.vhApplyHistoryDeletions_('demo','token',{}),/unbestätigt/);assert(!f.calls.some(c=>c.url.endsWith(':commit')));}
 const f=fixture({commitStatus:409});assert.throws(()=>f.context.vhConfirmHistoryDeletions_('demo','token',[{name:'test',updateTime:'time'}]),/fehlgeschlagen/);
});
