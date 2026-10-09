const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const code=html.slice(html.indexOf('let overviewBobineId ='),html.indexOf('function startDatabaseListener()'));
function run(id,rows){
  const nodes={searchInput:{value:''},statusFilter:{value:'Lager'},noResults:{style:{}},resultInfo:{}};
  let rendered;
  const c={window:{location:{search:'?bobine='+id}},URLSearchParams,document:{getElementById:id=>nodes[id]},alleBobinen:rows,openDetailsRows:new Set(),compareBobinenByNummer:()=>0,renderDesktopTable:data=>{rendered=data;},renderMobileCards(){},requestAnimationFrame(){},renderPrintReport(){}};
  vm.createContext(c);vm.runInContext(code+';renderFilteredTable();',c);return {c,nodes,rendered:()=>rendered};
}
test('notification shows exactly the linked bobine and opens details',()=>{
  const row=id=>({id,data:()=>({nummer:'123',status:'In Gebrauch'})});
  const r=run('exact',[row('exact'),row('other')]);assert.equal(r.rendered().length,1);assert.equal(r.rendered()[0].id,'exact');assert.equal(r.c.openDetailsRows.has('exact'),true);
  vm.runInContext('resetSearch()',r.c);assert.equal(r.rendered().length,2);
});
test('deleted bobine gives a clear message',()=>{const r=run('deleted',[]);assert.match(r.nodes.noResults.textContent,/nicht mehr vorhanden/);});
test('in-app reminder is suppressed by active push and returns after expiry',()=>{
  const source=fs.readFileSync(__dirname+'/bobinen-erinnerung.js','utf8');
  const check=source.slice(source.indexOf('  function check()'),source.indexOf('  function show('));
  let shown=0,removed=0;
  const c={timer:null,user:{uid:'alice'},pushReady:true,pushUntil:Date.now()+100000,active:null,records:[{id:'1',data:()=>({})}],document:{visibilityState:'visible'},clearTimeout(){},setTimeout(){return 1;},remove(){removed++;},show(){shown++;},eligible:()=>true};
  vm.createContext(c);vm.runInContext(check+';check();',c);assert.equal(shown,0);assert.equal(removed,1);
  c.pushUntil=0;vm.runInContext('check()',c);assert.equal(shown,1);
  c.pushReady=false;vm.runInContext('check()',c);assert.equal(shown,1);
});
