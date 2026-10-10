'use strict';
const {createHash}=require('node:crypto');
const DAY=86400000;
function validServiceDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'2000-01-01'||value>'2100-12-31')return false;
  const ms=Date.parse(value+'T00:00:00Z');
  return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===value;
}
function zurichDay(ms){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Zurich',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(ms).map(p=>[p.type,p.value]));
  return parts.year+'-'+parts.month+'-'+parts.day;
}
function dueDays(due,ms){return Math.round((Date.parse(due+'T00:00:00Z')-Date.parse(zurichDay(ms)+'T00:00:00Z'))/DAY);}
function serviceMessage(v,type,due,days){
  const label=type==='crane'?'Kranservice':'Fahrzeugservice',name=String(v.name||'Fahrzeug').replace(/[\r\n]/g,' '),plate=String(v.plate||'').replace(/[\r\n]/g,' ');
  const when=days<0?'seit '+Math.abs(days)+' Tagen überfällig':days===0?'heute fällig':'in '+days+' Tagen fällig';
  return {subject:label+' für '+name+' ('+plate+') '+when,textContent:label+' für '+name+' ('+plate+') ist '+when+'.\nFälligkeitsdatum: '+due.split('-').reverse().join('.')+'\nBitte einen Termin beim Mechaniker vereinbaren.\n\nFahrzeug öffnen: https://netzbau-tafers.github.io/lager/fahrzeuge.html?fahrzeug='+encodeURIComponent(v.id)};
}
function createServiceReminder({db,FieldValue,logger,apiKey,sender,recipient,fetchImpl=fetch,now=Date.now}){
  return async function(){
    if(!apiKey||!sender||!recipient)throw new Error('Service-Mail-Konfiguration fehlt.');
    const snapshot=await db.collection('fahrzeuge').get();
    for(const doc of snapshot.docs){
      const v={...doc.data(),id:doc.id};
      for(const type of ['vehicle','crane']){
        const due=v.serviceDates?.[type];if(!validServiceDate(due))continue;
        const days=dueDays(due,now());if(days>30)continue;
        const key=createHash('sha256').update(doc.id+'|'+type+'|'+due).digest('hex');
        const ref=db.collection('fahrzeug_service_mails').doc(key);
        const claimed=await db.runTransaction(async tx=>{
          // Re-read the vehicle so removed/changed dates are not queued from a stale scan.
          const [current,mail]=await Promise.all([tx.get(doc.ref),tx.get(ref)]);
          if(!current.exists||current.data().serviceDates?.[type]!==due)return false;
          if(mail.exists&&mail.data().status!=='retry')return false;
          tx.set(ref,{vehicleId:doc.id,type,due,status:'sending',attemptedAt:FieldValue.serverTimestamp()});
          return true;
        });
        if(!claimed)continue;
        let response;
        try{
          response=await fetchImpl('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':apiKey,'content-type':'application/json',accept:'application/json'},body:JSON.stringify({sender:{email:sender,name:'Lagermanager'},to:[{email:recipient}],...serviceMessage(v,type,due,days),headers:{'Idempotency-Key':key}}),signal:AbortSignal.timeout(20000)});
        }catch(error){
          await ref.update({status:'uncertain',updatedAt:FieldValue.serverTimestamp()});
          logger.error('Service-Mail: Versandstatus unklar',{vehicleId:doc.id,type,due});continue;
        }
        if(!response.ok){
          // Retry explicit rate limits and rejected client requests after configuration is corrected.
          // An ambiguous server failure is held for review to avoid duplicate notifications.
          const status=response.status<500?'retry':'uncertain';
          await ref.update({status,httpStatus:response.status,updatedAt:FieldValue.serverTimestamp()});
          logger.error('Service-Mail von Brevo nicht bestätigt',{vehicleId:doc.id,type,due,httpStatus:response.status});continue;
        }
        await ref.update({status:'sent',sentAt:FieldValue.serverTimestamp()});
      }
    }
  };
}
module.exports={validServiceDate,zurichDay,dueDays,serviceMessage,createServiceReminder};
