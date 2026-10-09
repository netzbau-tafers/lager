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
