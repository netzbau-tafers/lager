'use strict';
const {GoogleAuth}=require('google-auth-library');
const {HttpsError}=require('firebase-functions/v2/https');
const {getAuth}=require('firebase-admin/auth');
const MASTER='pmyu29TlC3QM7JIysmy2EmiHSWW2';
const GROUPS={
 bobinen:['lagerBobinenPushReminder'],
 fahrzeuge:['lagerVehiclePushReminderWeekdays','lagerVehiclePushReminderFriday'],
 service:['lagerVehicleServiceReminder'],
 bereinigung:['lagerVehicleActionCleanup']
};
const authClient=new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']});
async function master(request){
 if(request.auth?.uid!==MASTER)throw new HttpsError('permission-denied','Nur der Master-Administrator.');
 const user=await getAuth().getUser(MASTER);
 if(user.disabled)throw new HttpsError('permission-denied','Konto gesperrt.');
}
async function scheduler(path,method='GET'){
 const client=await authClient.getClient();
 const token=await client.getAccessToken();
 const response=await fetch('https://cloudscheduler.googleapis.com/v1/'+path,{method,headers:{Authorization:'Bearer '+token.token}});
 const data=await response.json().catch(()=>({}));
 if(!response.ok){console.error('Scheduler API',response.status,data.error?.message);throw new HttpsError('internal','Cloud Scheduler Fehler ('+response.status+'). IAM-Berechtigungen und aktivierte API prüfen.');}
 return data;
}
function project(){const id=process.env.GCLOUD_PROJECT||process.env.GCP_PROJECT;if(!id)throw new HttpsError('internal','Projekt-ID fehlt.');return id;}
async function jobs(){
 const parent='projects/'+project()+'/locations/europe-west1';
 let pageToken='',all=[];
 do{
  const query=pageToken?'?pageToken='+encodeURIComponent(pageToken):'';
  const data=await scheduler(parent+'/jobs'+query);
  all=all.concat(data.jobs||[]);pageToken=data.nextPageToken||'';
 }while(pageToken);
 return all;
}
function identify(job,fn){
 const name=job.name.split('/').pop();
 return name==='firebase-schedule-'+fn+'-europe-west1';
}
async function status(request){
 await master(request);
 const all=await jobs();
 return {groups:Object.fromEntries(Object.entries(GROUPS).map(([key,functions])=>[key,functions.map(fn=>{
  const job=all.find(j=>identify(j,fn));
  return {functionName:fn,found:!!job,state:job?.state||'NOT_FOUND'};
 })]))};
}
async function set(request){
 await master(request);
 const group=request.data?.group,enabled=request.data?.enabled;
 if(!Object.hasOwn(GROUPS,group)||typeof enabled!=='boolean')throw new HttpsError('invalid-argument','Ungültige Einstellung.');
 const all=await jobs();
 const targets=GROUPS[group].map(fn=>all.find(j=>identify(j,fn)));
 if(targets.some(j=>!j))throw new HttpsError('failed-precondition','Scheduler-Job nicht gefunden. Funktionen zuerst deployen.');
 const result=[];
 for(const job of targets){
  if(!['ENABLED','PAUSED'].includes(job.state))throw new HttpsError('failed-precondition','Job hat einen unerwarteten Zustand: '+job.state);
  if((job.state==='ENABLED')===enabled){result.push({name:job.name,state:job.state});continue;}
  const action=enabled?'resume':'pause';
  const updated=await scheduler(job.name+':'+action,'POST');
  result.push({name:job.name,state:updated.state});
 }
 console.info('Scheduler geändert',{uid:request.auth.uid,group,enabled,result});
 return {result};
}
module.exports={status,set};
