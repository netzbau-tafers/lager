'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

test('scheduler administration displays all configured groups as valid rows',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../scheduler-admin.js'),'utf8');
  const match=source.match(/const groups=\s*(\[[\s\S]*?\]);\s*function message/);
  assert.ok(match,'scheduler groups array must exist');
  const groups=vm.runInNewContext(match[1]);
  // Removed vehicle scheduler functions must stay absent: they have been deactivated to avoid charges.
  const expected=['bobinen','kabelreport'];
  assert.equal(groups.length,expected.length);
  for(const [index,group] of groups.entries()){
    assert.ok(Array.isArray(group),'group '+index+' must be an array (check commas between rows)');
    assert.equal(group.length,3,'group '+index+' must contain key, title and description');
    assert.equal(group[0],expected[index]);
    assert.ok(group.slice(1).every(v=>typeof v==='string'&&v.length>0));
  }
});
