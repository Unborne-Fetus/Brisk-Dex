const fs = require('fs');
const vm = require('vm');
global.window = global;
global.localStorage = {
  _v: new Map(),
  getItem(k){ return this._v.has(k) ? this._v.get(k) : null; },
  setItem(k,v){ this._v.set(k,String(v)); },
  removeItem(k){ this._v.delete(k); }
};
vm.runInThisContext(fs.readFileSync('emerald-compat.js','utf8'), {filename:'emerald-compat.js'});

function assert(value,message){ if(!value) throw new Error(message); }
const vanilla=EmeraldCompat.profileForId('emerald');
const brisk=EmeraldCompat.profileForId('brisk-emerald');
assert(vanilla && brisk,'Built-in profiles missing');
assert(EmeraldCompat.emeraldInternalSpeciesToNational(277)===252,'Emerald species mapping failed');
assert(EmeraldCompat.nationalSpeciesToEmeraldInternal(386)===411,'Reverse Emerald species mapping failed');
assert(EmeraldCompat.checksumSize(vanilla,13)===2000,'Checksum profile failed');

const imported=EmeraldCompat.importPack({profile:{id:'test-profile',name:'Test Profile',family:'emerald',writePolicy:'readonly'}});
assert(imported.profileIds[0]==='test-profile','Profile import failed');
assert(EmeraldCompat.profileForId('test-profile').writePolicy==='readonly','Imported profile not registered');

let raw=new Uint8Array(80),dv=new DataView(raw.buffer);
dv.setUint32(0,1,true);dv.setUint32(4,2,true);
// zero secure payload is encrypted with PID^OTID
const key=3;for(let i=0;i<12;i++)dv.setUint32(0x20+i*4,key,true);
const converted=EmeraldCompat.convertPokemonRecord(raw,vanilla,brisk);
assert(converted.length===80,'Cross-profile conversion changed record size');

// ID namespace safety: a nonzero held item cannot silently cross from an
// expansion namespace into vanilla Emerald without a verified mapping.
const expansion=EmeraldCompat.profileForId('pokeemerald-expansion-generic');
const itemRaw=raw.slice(),itemDv=new DataView(itemRaw.buffer);
const itemKey=(itemDv.getUint32(0,true)^itemDv.getUint32(4,true))>>>0;
const itemPlain=new Uint8Array(48),itemPlainDv=new DataView(itemPlain.buffer);
for(let w=0;w<12;w++)itemPlainDv.setUint32(w*4,(itemDv.getUint32(0x20+w*4,true)^itemKey)>>>0,true);
const order=['GAEM','GAME','GEAM','GEMA','GMAE','GMEA','AGEM','AGME','AEGM','AEMG','AMGE','AMEG','EGAM','EGMA','EAGM','EAMG','EMGA','EMAG','MGAE','MGEA','MAGE','MAEG','MEGA','MEAG'][itemDv.getUint32(0,true)%24],offsets={};
for(let i=0;i<4;i++)offsets[order[i]]=i*12;
itemPlainDv.setUint16(offsets.G+2,1,true);
let sum=0;for(let i=0;i<24;i++)sum=(sum+itemPlainDv.getUint16(i*2,true))&0xffff;
itemDv.setUint16(0x1c,sum,true);
for(let w=0;w<12;w++)itemDv.setUint32(0x20+w*4,(itemPlainDv.getUint32(w*4,true)^itemKey)>>>0,true);
let blocked=false;
try{EmeraldCompat.convertPokemonRecord(itemRaw,expansion,vanilla);}catch(e){blocked=/mapping|namespace/i.test(e.message);}
assert(blocked,'ID namespace safety did not block an unmapped cross-profile held item');


const rom={
  details:{title:'Custom Emerald',gameCode:'BPEE'},
  rhh:{species:1205,moves:980,items:800,abilities:350},
  header:{pokedexCount:1205,saveLayout:{
    partyCountOffset:0x300,partyOffset:0x304,
    saveBlock1Size:3900,saveBlock2Size:3500
  }}
};
const inferred=EmeraldCompat.inferProfileFromRom(rom);
assert(inferred&&inferred.inferredFromRom,'ROM-derived profile must be created');
assert(inferred.writePolicy==='readonly','Auto-inferred profiles must never grant write permissions');
assert(inferred.save.partyOffset===0x304,'ROM-provided party offset was not honored');
assert(inferred.idLimits.species>=1205,'Custom species limit was truncated');
const profile=EmeraldCompat.detectProfile({bytes:new Uint8Array(128*1024),rom:rom,override:'auto'});
assert(profile.confidence==='inferred-rom','Unknown save should use ROM-inferred read-only profile');
assert(profile.writeSafe===false,'Unknown save should not automatically become writable');

// An indexed ROM can authorize a fully declared, strongly fingerprinted
// game-specific save format without a manual dropdown selection.
const indexedBytes=new Uint8Array(128*1024);
indexedBytes[0x40]=0x25;indexedBytes[0x41]=0x12;
indexedBytes[0x44]=0x98;indexedBytes[0x45]=0x76;
const indexedProfile=Object.assign({},vanilla,{
  id:'indexed-custom',name:'Indexed Custom Emerald',
  fingerprints:[{type:'u16',offset:0x40,value:0x1225},{type:'u16',offset:0x44,value:0x7698}],
  save:Object.assign({},vanilla.save),
  pokemon:Object.assign({},vanilla.pokemon),
  pc:Object.assign({},vanilla.pc),
  bag:Object.assign({},vanilla.bag),
  dex:Object.assign({},vanilla.dex),
  idLimits:Object.assign({},vanilla.idLimits),
  idNamespaces:Object.assign({},vanilla.idNamespaces)
});
const linkedRom=Object.assign({},rom,{source:'embedded-manifest',
  integrity:{status:'verified'},saveProfile:indexedProfile});
const matched=EmeraldCompat.detectProfile({bytes:indexedBytes,rom:linkedRom});
assert(matched.confidence==='indexed-rom'&&matched.writeSafe,'A verified ROM with strong unique save markers and complete layout should auto-select writable profile');
const changedBytes=indexedBytes.slice();changedBytes[0x44]^=1;
assert(EmeraldCompat.detectProfile({bytes:changedBytes,rom:linkedRom}).writeSafe===false,
  'Mismatched save markers must not enable editing');
const unsignedRom=Object.assign({},linkedRom,{integrity:{status:'legacy'}});
assert(EmeraldCompat.detectProfile({bytes:indexedBytes,rom:unsignedRom}).writeSafe===false,
  'A ROM index without a verified SHA-256 must not auto-enable editing');
const weakRom=Object.assign({},linkedRom,{saveProfile:Object.assign({},indexedProfile,{
  fingerprints:[{type:'file-size',value:indexedBytes.length}]})});
assert(EmeraldCompat.detectProfile({bytes:indexedBytes,rom:weakRom}).writeSafe===false,
  'File size alone must not make an unfamiliar save writable');
const frlgRom={details:{title:'FireRed hack',gameCode:'BPRE',gameFamily:'firered'},
  header:{saveLayout:{partyCountOffset:0x34,partyOffset:0x38}}};
const frlgInferred=EmeraldCompat.inferProfileFromRom(frlgRom);
assert(frlgInferred.gameFamily==='firered','FRLG family not recognized');
assert(frlgInferred.save.partyCountOffset===0x34&&frlgInferred.save.partyOffset===0x38,'FRLG party offsets incorrect');
assert(frlgInferred.save.checksumSizes[0]===0xF24&&frlgInferred.save.checksumSizes[4]===0xEE8,'FRLG section sizes incorrect');
assert(frlgInferred.writePolicy==='readonly','FRLG save inference must not enable writes');
assert(frlgInferred.bag.pockets.length===0,'FRLG should not inherit Emerald bag layout');
const rubyRom={details:{title:'Ruby hack',gameCode:'AXVE',gameFamily:'ruby'},header:{}};
const rubyInferred=EmeraldCompat.inferProfileFromRom(rubyRom);
assert(rubyInferred.save.checksumSizes[0]===0x890&&rubyInferred.save.checksumSizes[4]===0xC40,'Ruby section sizes incorrect');
assert(rubyInferred.writePolicy==='readonly','Ruby layout must stay read-only');
console.log('Emerald/RS/FRLG compatibility tests passed');
