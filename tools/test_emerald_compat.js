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

console.log('Emerald compatibility tests passed');
