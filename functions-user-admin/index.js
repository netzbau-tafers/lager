'use strict';
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {initializeApp}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const {getFirestore,FieldValue}=require('firebase-admin/firestore');
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
