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
console.log('Emerald compatibility tests passed');
