/** Gemeinsamer Fahrzeugcache im Haupt-Sheet; nach Firebase-Deployment aktivieren. */
function vhCacheMain_(){var id=PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');if(!id)throw new Error('SPREADSHEET_ID fehlt.');return SpreadsheetApp.openById(id);}
function vhCacheStatus(){var main=vhCacheMain_(),state=main.getSheetByName('fahrtenbuch_cache_status');return {mode:state?String(state.getRange('B2').getValue()||'VOLL'):'VOLL',at:state?String(state.getRange('B1').getValue()||''):'',count:main.getSheetByName('fahrtenbuch_cache')?Math.max(0,main.getSheetByName('fahrtenbuch_cache').getLastRow()-1):0};}
function vhBackupVehiclesUnlocked_(project,token,forceFull){
 var main=vhCacheMain_(),sheet=main.getSheetByName('fahrtenbuch_cache')||main.insertSheet('fahrtenbuch_cache'),state=main.getSheetByName('fahrtenbuch_cache_status')||main.insertSheet('fahrtenbuch_cache_status');
 var previous=String(state.getRange('B1').getValue()||''),mode=String(state.getRange('B2').getValue()||'VOLL'),cutoff=new Date().toISOString(),root='projects/'+project+'/databases/(default)/documents',started=Date.now();
 var rows=sheet.getLastRow()>1?sheet.getRange(2,1,sheet.getLastRow()-1,6).getValues():[],byPath=Object.create(null);
 rows.forEach(function(r){byPath[String(r[0])]={name:root+'/'+r[0],fields:JSON.parse(String(r[2])),createTime:String(r[3]||''),updateTime:String(r[4]||'')};});
 if(forceFull||mode!=='INKREMENTELL'||!previous){
   byPath=Object.create(null);fetchCollectionDocuments_(project,'fahrzeuge',token).forEach(function(d){byPath[getRelativeDocumentPath_(d.name,project)]=d;});
 }else{
   function changed(group,field){
     var cursor=null;
     do{
       if(Date.now()-started>180000)throw new Error('Zeitlimit beim Fahrzeugcache. Fortschritt wird nicht bestätigt.');
       var query={from:[{collectionId:group,allDescendants:true}],where:{compositeFilter:{op:'AND',filters:[{fieldFilter:{field:{fieldPath:field},op:'GREATER_THAN',value:{timestampValue:field==='createdAt'?new Date(Date.parse(previous)-600000).toISOString():previous}}},{fieldFilter:{field:{fieldPath:field},op:'LESS_THAN_OR_EQUAL',value:{timestampValue:cutoff}}}]}},orderBy:[{field:{fieldPath:field},direction:'ASCENDING'},{field:{fieldPath:'__name__'},direction:'ASCENDING'}],limit:200};
       if(cursor)query.startAt={values:cursor,before:false};
       var r=UrlFetchApp.fetch('https://firestore.googleapis.com/v1/'+root+':runQuery',{method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+token},payload:JSON.stringify({structuredQuery:query,readTime:cutoff}),muteHttpExceptions:true});
       if(r.getResponseCode()!==200)throw new Error('Inkrementelles Fahrzeugbackup fehlgeschlagen ('+r.getResponseCode()+'). Firebase-Funktionen und Indizes prüfen. Kein Fortschritt bestätigt.');
       var docs=JSON.parse(r.getContentText()).filter(function(r){return r.document;}).map(function(r){return r.document;});
       docs.forEach(function(d){var path=getRelativeDocumentPath_(d.name,project);if(path.split('/').length===4&&path.split('/')[0]==='fahrzeuge')byPath[path]=d;});
       if(docs.length){var last=docs[docs.length-1];cursor=[last.fields[field],{referenceValue:last.name}];}
     }while(docs.length===200);
   }
   changed('verlauf','updatedAt');changed('aktionen','createdAt');
   // Eltern werden vollständig gelesen: nur die kleine aktuelle Fahrzeugliste.
   Object.keys(byPath).forEach(function(p){if(p.split('/').length===2)delete byPath[p];});
   var page='';do{
     var r=UrlFetchApp.fetch('https://firestore.googleapis.com/v1/'+root+'/fahrzeuge?pageSize=500'+(page?'&pageToken='+encodeURIComponent(page):''),{headers:{Authorization:'Bearer '+token},muteHttpExceptions:true});
     if(r.getResponseCode()!==200)throw new Error('Fahrzeugliste konnte nicht gesichert werden.');
     var data=JSON.parse(r.getContentText());(data.documents||[]).forEach(function(d){byPath[getRelativeDocumentPath_(d.name,project)]=d;});page=data.nextPageToken||'';
   }while(page);
 }
 var docs=Object.keys(byPath).sort().map(function(p){return byPath[p];});
 var output=docs.map(function(d){var path=getRelativeDocumentPath_(d.name,project),json=JSON.stringify(d.fields||{});if(json.length>49000)throw new Error('Fahrzeugdokument zu gross für Sheets: '+path);return [path,path.split('/').pop(),json,d.createTime||'',d.updateTime||'',cutoff];});
 var oldLength=sheet.getLastRow();sheet.getRange(1,1,1,6).setValues([['documentPath','documentId','fieldsJson','createTime','updateTime','backupZeitpunkt']]);
 if(sheet.getMaxRows()<output.length+1)sheet.insertRowsAfter(sheet.getMaxRows(),output.length+1-sheet.getMaxRows());
 if(output.length)sheet.getRange(2,1,output.length,6).setNumberFormat('@').setValues(output);
 if(oldLength>output.length+1)sheet.getRange(output.length+2,1,oldLength-output.length-1,6).clearContent();
 sheet.setFrozenRows(1);SpreadsheetApp.flush();state.getRange(1,1,3,2).setNumberFormat('@').setValues([['lastSuccessfulCutoff',cutoff],['mode',mode],['documents',String(output.length)]]);SpreadsheetApp.flush();return docs;
}
function enableVehicleHistoryIncremental(){
 var config=getConfig_(),token=getServiceAccountAccessToken_(config.saClientEmail,config.saPrivateKey);
 // Vor Aktivierung immer vollständiger Stand, damit ältere Einträge ohne updatedAt enthalten sind.
 vhBackupVehicles_(config.projectId,token,true);vhCacheMain_().getSheetByName('fahrtenbuch_cache_status').getRange('B2').setValue('INKREMENTELL');SpreadsheetApp.flush();
 Logger.log('Inkrementelles Fahrzeugbackup aktiviert. Nur nach Bereitstellung der neuen Firebase-Funktionen und Indizes ausführen.');
}

// Gemeinsame Firestore-Sperre schützt den Cache über beide Apps-Script-Projekte.
function vhBackupVehicles_(project,token,forceFull){var lease=vhAcquireCacheLease_(project,token);try{return vhBackupVehiclesUnlocked_(project,token,forceFull);}finally{vhReleaseCacheLease_(project,token,lease);}}
function vhAcquireCacheLease_(project,token){
 var name='projects/'+project+'/databases/(default)/documents/backup_runtime/fahrtenbuch_cache',base='https://firestore.googleapis.com/v1/',options={headers:{Authorization:'Bearer '+token},muteHttpExceptions:true};
 var response=UrlFetchApp.fetch(base+name,options),code=response.getResponseCode(),old=null;
 if(code===200)old=JSON.parse(response.getContentText());else if(code!==404)throw new Error('Fahrtenbuch-Sperre konnte nicht gelesen werden ('+code+').');
 if(old&&Date.parse(old.fields&&old.fields.leaseUntil&&old.fields.leaseUntil.timestampValue)>Date.now())throw new Error('Ein Fahrzeugbackup läuft bereits im anderen Projekt. Bitte später erneut versuchen.');
 var write={update:{name:name,fields:{leaseUntil:{timestampValue:new Date(Date.now()+660000).toISOString()},owner:{stringValue:Utilities.getUuid()}}},currentDocument:old?{updateTime:old.updateTime}:{exists:false}};
 var r=UrlFetchApp.fetch(base+'projects/'+project+'/databases/(default)/documents:commit',{method:'post',contentType:'application/json',headers:options.headers,payload:JSON.stringify({writes:[write]}),muteHttpExceptions:true});
 if(r.getResponseCode()!==200)throw new Error('Fahrtenbuch-Sperre wurde nicht bestätigt. Es läuft möglicherweise bereits ein Backup.');return JSON.parse(r.getContentText()).writeResults[0].updateTime;
}
function vhReleaseCacheLease_(project,token,version){
 var name='projects/'+project+'/databases/(default)/documents/backup_runtime/fahrtenbuch_cache';
 try{var r=UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/'+project+'/databases/(default)/documents:commit',{method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+token},payload:JSON.stringify({writes:[{delete:name,currentDocument:{updateTime:version}}]}),muteHttpExceptions:true});if(r.getResponseCode()!==200)Logger.log('Fahrtenbuch-Sperre läuft automatisch nach elf Minuten ab.');}catch(e){Logger.log('Fahrtenbuch-Sperre läuft automatisch nach elf Minuten ab.');}
}
