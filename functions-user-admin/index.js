'use strict';
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {initializeApp}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const {getFirestore,FieldValue,Timestamp}=require('firebase-admin/firestore');
const logger=require('firebase-functions/logger');
const {createService}=require('./service.cjs');
initializeApp();
const service=createService({auth:getAuth(),db:getFirestore(),timestamp:()=>FieldValue.serverTimestamp(),ErrorType:HttpsError});
function callable(handler){return onCall({region:'europe-west1',maxInstances:2},async request=>{try{return await handler(request);}catch(error){if(error instanceof HttpsError)throw error;logger.error('Benutzerverwaltung fehlgeschlagen',{code:error.code||'internal'});throw new HttpsError('internal','Aktion fehlgeschlagen. Beim Löschen kann das Konto bereits gesperrt oder gelöscht sein. Bitte erneut versuchen.');}});}
exports.lagerListUsers=callable(service.list);
exports.lagerDeleteUser=callable(service.remove);

exports.lagerCreateUser=callable(service.create);


const {onSchedule}=require('firebase-functions/v2/scheduler');
const {getMessaging}=require('firebase-admin/messaging');
const {createPush}=require('./push.cjs');
const push=createPush({db:getFirestore(),auth:getAuth(),messaging:getMessaging(),FieldValue,ErrorType:HttpsError,logger});
const pushCall=handler=>onCall({region:'europe-west1',maxInstances:2},handler);
exports.lagerRegisterPush=pushCall(push.register);
exports.lagerUnregisterPush=pushCall(push.unregister);
exports.lagerTestPush=pushCall(push.test);
exports.lagerBobinenPushReminder=onSchedule({schedule:'*/15 7-17 * * 1-5',timeZone:'Europe/Zurich',region:'europe-west1',maxInstances:1,timeoutSeconds:540,retryCount:0},push.remind);

exports.lagerPasswordResetLink=callable(service.resetLink);


const {createVehicles}=require('./vehicles.cjs');
const vehicles=createVehicles({db:getFirestore(),auth:getAuth(),Timestamp,ErrorType:HttpsError});
const vehicleCall=handler=>onCall({region:'europe-west1',maxInstances:2},async request=>{try{return await handler(request);}catch(error){if(error instanceof HttpsError)throw error;logger.error('Fahrzeugaktion fehlgeschlagen',{code:error.code||'internal'});throw new HttpsError('internal','Fahrzeugaktion konnte nicht gespeichert werden. Bitte aktualisieren und erneut versuchen.');}});
exports.lagerCreateVehicle=vehicleCall(vehicles.create);
exports.lagerDeleteVehicle=vehicleCall(vehicles.remove);
exports.lagerVehicleAction=vehicleCall(vehicles.action);

const {createVehicleReminder}=require('./vehicle-reminder.cjs');
const remindVehicles=createVehicleReminder({db:getFirestore(),auth:getAuth(),messaging:getMessaging(),FieldValue,logger});
const vehicleSchedule={timeZone:'Europe/Zurich',region:'europe-west1',maxInstances:1,timeoutSeconds:540,retryCount:0};
exports.lagerVehiclePushReminderWeekdays=onSchedule({...vehicleSchedule,schedule:'10 17 * * 1-4'},remindVehicles);
exports.lagerVehiclePushReminderFriday=onSchedule({...vehicleSchedule,schedule:'55 11 * * 5'},remindVehicles);
