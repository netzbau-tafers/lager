'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

const VERSION='13.4.0';
const SDK_BASE='https://www.gstatic.com/firebasejs/'+VERSION+'/';
const MODULES=['app','auth','firestore','functions','storage','messaging'];

test('all application CDN imports use one Firebase compat version',()=>{
  const root=path.join(__dirname,'..');
  const files=fs.readdirSync(root).filter(x=>x.endsWith('.html')||x.endsWith('.js'));
  let count=0;
  for(const name of files){
    const source=fs.readFileSync(path.join(root,name),'utf8');
    const versions=[...source.matchAll(/firebasejs\/(\d+\.\d+\.\d+)\/firebase-[a-z-]+\.js/g)];
    for(const match of versions){assert.equal(match[1],VERSION,'outdated Firebase SDK in '+name);count++;}
  }
  assert.ok(count>=25,'expected CDN scripts across the application');
});

test('real Firebase CDN compat bundles provide existing browser APIs',async()=>{
  // Isolated demo app: no production Firebase auth, database reads, writes or messaging sends.
  const server=http.createServer((_req,res)=>{
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
    res.end('<!doctype html><html><head><title>Firebase SDK smoke</title></head><body>Test</body></html>');
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  let browser;
  try{
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage();
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:'+server.address().port+'/');
    for(const part of MODULES)await page.addScriptTag({url:SDK_BASE+'firebase-'+part+'-compat.js'});
    const actual=await page.evaluate(async()=>{
      if(typeof firebase==='undefined')throw Error('Firebase global object absent');
      const app=firebase.initializeApp({
        apiKey:'demo-api-key-not-for-production',
        authDomain:'demo-lager-access.firebaseapp.com',
        projectId:'demo-lager-access',
        appId:'1:111111111:web:demo123',
        messagingSenderId:'111111111',
        storageBucket:'demo-lager-access.appspot.com'
      });
      const db=firebase.firestore();
      const auth=firebase.auth();
      const funcs=app.functions('europe-west1');
      const storage=firebase.storage();
      const callable=funcs.httpsCallable('lagerTest');
      return {
        version:firebase.SDK_VERSION,
        auth:typeof auth.signInWithEmailAndPassword,
        authState:typeof auth.onAuthStateChanged,
        firestore:typeof db.collection,
        query:typeof db.collection('bobinen').onSnapshot,
        callable:typeof callable,
        storage:typeof storage.ref,
        messaging:typeof firebase.messaging.isSupported
      };
    });
    assert.equal(actual.version,VERSION);
    for(const [key,value] of Object.entries(actual))if(key!=='version')assert.equal(value,'function',key+' compat method absent');
    assert.deepEqual(errors,[],'browser JavaScript errors');
  }finally{
    if(browser)await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
});
