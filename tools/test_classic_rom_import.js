'use strict';
const assert=require('assert');
const C=require('../classic-rom-import.js');
const LOGO=[
  0xCE,0xED,0x66,0x66,0xCC,0x0D,0x00,0x0B,0x03,0x73,0x00,0x83,
  0x00,0x0C,0x00,0x0D,0x00,0x08,0x11,0x1F,0x88,0x89,0x00,0x0E,
  0xDC,0xCC,0x6E,0xE6,0xDD,0xDD,0xD9,0x99,0xBB,0xBB,0x67,0x63,
  0x6E,0x0E,0xEC,0xCC,0xDD,0xDC,0x99,0x9F,0xBB,0xB9,0x33,0x3E];
function base(title,cgb){
  const b=new Uint8Array(0x30000);
  b.fill(0xFF);b.set(LOGO,0x104);
  Buffer.from(title,'ascii').copy(b,0x134,0,Math.min(15,title.length));
  b[0x143]=cgb;b[0x147]=0x1B;b[0x148]=0x03;b[0x149]=0x03;
  let sum=0;for(let i=0x134;i<=0x14C;i++)sum=(sum-b[i]-1)&255;
  b[0x14D]=sum;
  return b;
}
function name(s,stride){
  const a=new Uint8Array(stride).fill(0x50);
  const value=String(s).toUpperCase().slice(0,stride);
  for(let i=0;i<value.length;i++){
    const c=value.charCodeAt(i);
    a[i]=c>=65&&c<=90?c-65+0x80:c>=48&&c<=57?c-48+0xF6:0x50;
  }
  return a;
}
function writeTable(b,at,stride,entries){
  entries.forEach((n,i)=>b.set(name(n,stride),at+stride*i));
}
const g2=base('POKEMON CRYSTAL',0x80);
writeTable(g2,0x8000,11,['BULBASAUR','IVYSAUR','VENUSAUR','CHARMANDER',
  ...Array.from({length:247},(_,i)=>'MON'+String(i).padStart(3,'0'))]);
const crystal=C.importRom(g2,{filename:'test.gbc'});
assert.strictEqual(crystal.details.generation,2);
assert.strictEqual(crystal.data.species[1].name,'BULBASAUR');
assert.strictEqual(crystal.counts.species,251);
assert.strictEqual(crystal.source,'classic-rom-tables');
assert.strictEqual(crystal.complete,false);
assert.strictEqual(crystal.saveSupport,'readonly-unidentified');
assert.strictEqual(C.inspectSave(new Uint8Array(32*1024),crystal).writeSafe,false);
const g1=base('POKEMON RED',0);
writeTable(g1,0x6000,10,['RHYDON','KANGASKHAN',
  ...Array.from({length:188},(_,i)=>'MON'+String(i).padStart(3,'0'))]);
const red=C.importRom(g1,{filename:'test.gb'});
assert.strictEqual(red.details.generation,1);
assert.strictEqual(red.data.species[1].name,'RHYDON');
assert.strictEqual(red.data.species[1].idScheme,'gen1-internal');
assert.strictEqual(red.counts.species,190);
const hacked=base('CUSTOM HACK',0x80);
writeTable(hacked,0xA000,11,Array.from({length:251},(_,i)=>'BEAST'+String(i).padStart(3,'0')));
const scanned=C.importRom(hacked,{filename:'fakemon.gbc'});
assert.strictEqual(scanned.counts.species,251,'Structural scan should recover fully renamed Gen II species');
assert.strictEqual(scanned.detectedTable.method,'structural');
assert.strictEqual(scanned.complete,false,'Structural name tables are not a full data index');
const blank=base('UNKNOWN',0x80);
const empty=C.importRom(blank,{filename:'unknown.gbc'});
assert.strictEqual(empty.counts.species,0,'Unverified species tables must not be invented');
assert.strictEqual(empty.details.generation,2);
assert.strictEqual(C.inspectSave(new Uint8Array(5),empty).status,'unrecognized');
const invalid=new Uint8Array(0x8000);
assert.throws(()=>C.importRom(invalid),/not a recognizable/i);
console.log('Gen 1–2 GB/GBC cartridge, custom species table, and conservative SRAM tests passed');
