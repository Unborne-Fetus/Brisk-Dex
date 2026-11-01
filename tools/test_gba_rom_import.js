'use strict';
const assert=require('assert');
const R=require('../gba-rom-import.js');
const enc=new TextEncoder();
function put32(b,o,n){b[o]=n&255;b[o+1]=n>>>8&255;b[o+2]=n>>>16&255;b[o+3]=n>>>24&255;}
function put16(b,o,n){b[o]=n&255;b[o+1]=n>>>8&255;}
function writeAscii(b,o,s){for(let i=0;i<s.length;i++)b[o+i]=s.charCodeAt(i);}
function writeGba(b,o,s){for(let i=0;i<s.length;i++){let v=s.charCodeAt(i);b[o+i]=v>=65&&v<=90?0xBB+v-65:v>=97&&v<=122?0xD5+v-97:0;}b[o+s.length]=0xFF;}
function baseRom(){
  let b=new Uint8Array(1024*1024);
  b.fill(255);b[0xB2]=0x96;
  writeAscii(b,0xA0,'BRISK TEST');writeAscii(b,0xAC,'BPEE');
  let gf=0x200,h=0x300,species=0x10000;
  put32(b,gf,2);put32(b,gf+4,2);writeAscii(b,gf+8,'pokemon emerald version');
  put32(b,gf+188,0x08000000+species);
  put32(b,gf+112,150);b[gf+118]=10;
  writeAscii(b,h,'RHHEXP');b[h+6]=1;b[h+7]=17;b[h+8]=0;
  put16(b,h+10,934);put16(b,h+12,300);put16(b,h+14,319);put16(b,h+20,874);
  let names=['','Bulbasaur','Ivysaur','Venusaur'];
  for(let i=1;i<29;i++){
    let p=species+i*200;
    [45,49,49,45,65,65,12,4].forEach((v,k)=>b[p+k]=v);
    writeGba(b,p+48,names[i]||('Species'+i));
  }
  return b;
}
const sample=baseRom();
const plain=R.importRom(sample);
assert.strictEqual(plain.details.title,'BRISK TEST');
assert.strictEqual(plain.rhh.species,300);
assert.strictEqual(plain.counts.species,28);
assert.strictEqual(plain.data.species['1'].name,'Bulbasaur');
assert.strictEqual(plain.data.species['2'].stats.speed,45);
assert.strictEqual(plain.counts.trainers,0);
assert.strictEqual(plain.complete,false);
assert(plain.warnings.some(s=>s.includes('Trainer teams')));

const packed={format:'briskdex-rom-v1',assets:{icons:{'1':'data:image/png;base64,aGVsbG8='},shinyIcons:{'1':'data:image/png;base64,aGVsbG8='}},data:{
  species:{'1':{name:'Custommon',types:['Water']}},
  moves:{'1':'Tackle'},items:{'1':'Poké Ball'},abilities:{'1':'Sturdy'},
  trainerTeams:[{constant:'TRAINER_1',name:'TEST',party:[{species:'Custommon',fields:{Level:'42'},moves:['Tackle']}]}],
  routeEncounters:[{id:'CustomRoute',name:'New Route',methods:[{name:'Grass',type:'land',encounterRate:20,slots:[{species:1,minLevel:4,maxLevel:8,chance:100}]}]}]
}};
let data=enc.encode(JSON.stringify(packed)),size=sample.length,full=new Uint8Array(size+data.length+16);
full.set(sample);full.set(data,size);put32(full,size+data.length,data.length);
put32(full,size+data.length+4,R.crc32(data,0,data.length));writeAscii(full,size+data.length+8,R.MAGIC);
let loaded=R.importRom(full);
assert.strictEqual(loaded.source,'embedded-manifest');
assert.strictEqual(loaded.complete,true);
assert.strictEqual(loaded.counts.species,1);
assert.strictEqual(loaded.counts.trainers,1);
assert.strictEqual(loaded.counts.routes,1);
assert.strictEqual(loaded.data.species['1'].name,'Custommon');
assert.strictEqual(loaded.iconUrls['1'],'data:image/png;base64,aGVsbG8=');
assert.strictEqual(loaded.shinyIconUrls['1'],'data:image/png;base64,aGVsbG8=');
full[size+10]^=1;
assert.throws(()=>R.importRom(full),/checksum/i);

const wrong=sample.slice();wrong[0xB2]=0;
assert.throws(()=>R.importRom(wrong),/Game Boy Advance ROM/i);
const uncompressed=R.lz77(new Uint8Array([0x10,4,0,0,0,1,2,3,4]),0);
assert.deepStrictEqual(Array.from(uncompressed),[1,2,3,4]);
const repeat=R.lz77(new Uint8Array([0x10,6,0,0,0x40,7,0x20,0]),0);
assert.deepStrictEqual(Array.from(repeat),[7,7,7,7,7,7]);
const pixels=R.tilesToRgba(new Uint8Array(512).fill(0x11),new Uint8Array(32).fill(0x7F),32,32);
assert.strictEqual(pixels.length,4096);
assert.strictEqual(pixels[3],255);
assert.strictEqual(pixels[7],255);
const compressed=require('zlib').deflateSync(Buffer.from(JSON.stringify(packed)));
const zippedRom=new Uint8Array(size+compressed.length+16);
zippedRom.set(sample);zippedRom.set(compressed,size);
put32(zippedRom,size+compressed.length,compressed.length);
put32(zippedRom,size+compressed.length+4,R.crc32(compressed,0,compressed.length));
writeAscii(zippedRom,size+compressed.length+8,'BDXROMZ!');
R.importRomAsync(zippedRom).then(result=>{
  assert.strictEqual(result.complete,true);
  assert.strictEqual(result.data.trainerTeams[0].party[0].species,'Custommon');
  assert.strictEqual(result.iconUrls['1'],'data:image/png;base64,aGVsbG8=');
  console.log('GBA ROM importer tests passed (raw + compressed indexes)');
}).catch(err=>{console.error(err);process.exitCode=1;});

