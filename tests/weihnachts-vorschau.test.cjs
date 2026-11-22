const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'weihnachts-vorschau.js'), 'utf8');
const MASTER = 'master-test';
const master = {uid:MASTER};
const colleague = {uid:'colleague'};

function setup(month, store = new Map()){
  const sessionStorage = {
    getItem:key => store.has(key) ? store.get(key) : null,
    setItem:(key,value) => store.set(key,value),
    removeItem:key => store.delete(key)
  };
  const window = {LagerAccess:{MASTER},sessionStorage};
  const IntlMock = {
    DateTimeFormat:function(){return {format:() => String(month)}}
  };
  vm.runInNewContext(source, {window,Intl:IntlMock,Date});
  return {preview:window.LagerChristmasPreview,store};
}

test('Vorschau ist ausserhalb des Dezembers standardmässig aus',()=>{
  const {preview}=setup(11);
  assert.equal(preview.isActive(master),false);
  assert.equal(preview.isActive(colleague),false);
});

test('Nur Hauptadministrator kann Vorschau im eigenen Tab einschalten',()=>{
  const {preview,store}=setup(11);
  assert.equal(preview.setPreviewEnabled(colleague,true),false);
  assert.equal(preview.setPreviewEnabled(master,true),true);
  assert.equal(preview.previewEnabled(master),true);
  assert.equal(preview.isActive(master),true);
  assert.equal(preview.isActive(colleague),false);
  assert.equal(setup(11,new Map()).preview.isActive(master),false);
  assert.equal(setup(11,store).preview.isActive(master),true);
  assert.equal(preview.setPreviewEnabled(master,false),true);
  assert.equal(preview.isActive(master),false);
});

test('Im Dezember bleibt das Layout für alle automatisch eingeschaltet',()=>{
  const {preview}=setup(12);
  assert.equal(preview.isActive(master),true);
  assert.equal(preview.isActive(colleague),true);
  assert.equal(preview.isActive(null),true);
});

test('Blockierter Tab-Speicher schaltet keine unerlaubte Vorschau frei',()=>{
  const window={
    LagerAccess:{MASTER},
    sessionStorage:{getItem(){throw Error('blocked')},setItem(){throw Error('blocked')},removeItem(){throw Error('blocked')}}
  };
  vm.runInNewContext(source,{window,Intl:{DateTimeFormat:function(){return {format:()=> '11'}}},Date});
  assert.equal(window.LagerChristmasPreview.isActive(master),false);
  assert.equal(window.LagerChristmasPreview.setPreviewEnabled(master,true),false);
});
