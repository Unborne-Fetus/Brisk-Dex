'use strict';
const assert=require('assert');
const Audit=require('../rom-compat-audit.js');
function rom(indexed){
  return {
    source:indexed?'embedded-manifest':'rom-tables',
    details:{title:'Custom Emerald',gameCode:'BPEE'},
    data:{
      species:{'1':{name:'Bulbasaur'},'1200':{name:'Copperhawk'}},
      moves:{'1':'Pound','50':'Custom Move'},
      abilities:{'1':'Stench'},
      items:{'1':'Poké Ball','300':'Meteor Lens'},
      routeEncounters:[{id:'MAP_CUSTOM',methods:[]}],
      mapCatalog:indexed?[{id:'MAP_CUSTOM',name:'Custom Island'}]:undefined,
      trainerTeams:indexed?[{name:'Test'}]:undefined
    },
    counts:{species:2,moves:2,abilities:1,items:2,routes:1,maps:indexed?1:0,trainers:indexed?1:0},
    icons:{},iconUrls:{'1':'data:image/png;base64,aaaa'},shinyIconUrls:{},
    warnings:indexed?[]:['Some ROM tables are not available']
  };
}
function save(species,details){
  const mon=Object.assign({empty:false,species:species,moves:[1],heldItem:1,checksumValid:true},details||{});
  return {profile:{id:'brisk-emerald',name:'Brisk',writeSafe:true},party:[mon],boxes:[]};
}
const full=rom(true),partial=rom(false);
const cover=Audit.coverage(full);
assert.strictEqual(cover.byType.maps.state,'indexed');
assert.strictEqual(cover.byType.species.state,'indexed');
assert.strictEqual(cover.byType.icons.count,1);
assert.strictEqual(cover.byType.shiny.state,'unavailable');
assert.strictEqual(Audit.coverage(partial).byType.maps.state,'unavailable');
assert.strictEqual(Audit.coverage(partial).byType.species.state,'partial');
assert.strictEqual(Audit.inspectSave(full,save(1200)).status,'plausible');
assert.strictEqual(Audit.inspectSave(full,save(1200)).writeSafe,true);
assert.strictEqual(Audit.inspectSave(full,save(999)).status,'incompatible');
assert.strictEqual(Audit.inspectSave(full,save(1200,{heldItem:999})).status,'incompatible');
assert.strictEqual(Audit.inspectSave(full,save(1200,{moves:[999]})).status,'incompatible');
assert.strictEqual(Audit.inspectSave(full,save(1200,{checksumValid:false})).status,'incompatible');
assert.strictEqual(Audit.inspectSave(partial,save(999)).status,'unverified');
assert.strictEqual(Audit.inspectSave(partial,save(999)).writeSafe,true);
assert.strictEqual(Audit.inspectSave(full,null).status,'no-save');
console.log('ROM coverage and conservative save mismatch tests passed');
