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

exports.lagerPasswordResetLink=callable(service.resetLink);
