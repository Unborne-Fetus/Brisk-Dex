'use strict';
const assert=require('assert');
const R=require('../gba-rom-import.js');
const enc=new TextEncoder();
function put32(b,o,n){b[o]=n&255;b[o+1]=n>>>8&255;b[o+2]=n>>>16&255;b[o+3]=n>>>24&255;}
function put16(b,o,n){b[o]=n&255;b[o+1]=n>>>8&255;}
function writeAscii(b,o,s){for(let i=0;i<s.length;i++)b[o+i]=s.charCodeAt(i);}
function writeGba(b,o,s){for(let i=0;i<s.length;i++){let v=s.charCodeAt(i);b[o+i]=v>=65&&v<=90?0xBB+v-65:v>=97&&v<=122?0xD5+v-97:v>=48&&v<=57?0xA1+v-48:0;}b[o+s.length]=0xFF;}
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
  const moveBase=0x20000,itemBase=0x30000,abilityBase=0x40000,nameBase=0x60000;
  // Actual current GF ROM header offsets from pokeemerald-expansion.
  put32(b,gf+136,3500);put32(b,gf+140,3900);
  put32(b,gf+144,0x234);put32(b,gf+148,0x238);
  put32(b,gf+200,0x08000000+itemBase);
  put32(b,gf+204,0x08000000+moveBase);
  put32(b,h+16,0x08000000+abilityBase);
  const moveNames=['','Pound','Karate Chop','Double Slap'];
  const itemNames=['','Master Ball','Ultra Ball','Great Ball'];
  const abilityNames=['','Stench','Drizzle','Speed Boost'];
  for(let i=1;i<26;i++){
    let mo=nameBase+i*128,io=mo+40,ao=abilityBase+i*28;
    writeGba(b,mo,moveNames[i]||'Custom Move '+i);
    writeGba(b,io,itemNames[i]||'Custom Item '+i);
    writeGba(b,ao,abilityNames[i]||'Ability '+i);
    put32(b,moveBase+i*32,0x08000000+mo);
    put32(b,itemBase+i*64+20,0x08000000+io);
  }
  return b;
}

// Verify that a ROM which replaces the first three Kanto starters can
// still reveal its Fakémon without depending on Bulbasaur name anchors.
const replaced=baseRom();
writeGba(replaced,0x10000+1*200+48,'Copperhawk');
writeGba(replaced,0x10000+2*200+48,'Mistwing');
writeGba(replaced,0x10000+3*200+48,'Ironfang');
const replacedScan=R.importRom(replaced);
assert.strictEqual(replacedScan.data.species['1'].name,'Copperhawk');
assert.strictEqual(replacedScan.data.species['2'].name,'Mistwing');
assert.strictEqual(replacedScan.counts.species,28);
assert(replacedScan.warnings.some(w=>w.includes('nonstandard SpeciesInfo')));

// A non-indexed Emerald-family ROM must recover additional species, alternate
// expansion item IDs, and validated compiled wild encounters when available.
const custom=baseRom();
const speciesBase=0x10000,customSpecies=29,customSpeciesAt=speciesBase+customSpecies*200;
[90,104,70,92,100,86,10,10].forEach((v,k)=>custom[customSpeciesAt+k]=v);
writeGba(custom,customSpeciesAt+48,'Copperhawk');
['Poke Ball','Great Ball','Ultra Ball','Master Ball'].forEach((name,i)=>{
  const id=i+1,ptr=0x60000+id*128+40;
  writeGba(custom,ptr,name);
});
const customItemId=40,customItemPtr=0x60000+customItemId*128+40;
writeGba(custom,customItemPtr,'Meteor Lens');
put32(custom,0x30000+customItemId*64+20,0x08000000+customItemPtr);
const wildTable=0x68000,wildInfo=0x70000,wildSlots=0x70100;
custom[wildInfo]=25;custom[wildInfo+1]=0;custom[wildInfo+2]=0;custom[wildInfo+3]=0;
put32(custom,wildInfo+4,0x08000000+wildSlots);
for(let i=0;i<12;i++){
  const slot=wildSlots+i*4;custom[slot]=4;custom[slot+1]=8;put16(custom,slot+2,i===11?29:i+1);
}
for(let map=0;map<9;map++){
  const row=wildTable+map*20;
  custom[row]=2;custom[row+1]=map+1;custom[row+2]=0;custom[row+3]=0;
  put32(custom,row+4,0x08000000+wildInfo);
  for(let f=8;f<20;f++)custom[row+f]=0;
}
const customScan=R.importRom(custom);
assert.strictEqual(customScan.data.species[String(customSpecies)].name,'Copperhawk');
assert.strictEqual(customScan.data.items[String(customItemId)],'Meteor Lens');
assert.strictEqual(customScan.counts.routes,9);
assert.strictEqual(customScan.data.routeEncounters[0].mapGroup,2);
assert(customScan.data.routeEncounters.some(a=>a.methods.some(m=>m.slots.some(slot=>slot.species===customSpecies))));
assert(!customScan.complete,'Unindexed custom ROM must not claim complete coverage');
// Distinct, non-contiguous compiled encounter tables can represent new regions.
const secondTable=0x78000;
for(let map=0;map<7;map++){
  const row=secondTable+map*20;
  custom[row]=4;custom[row+1]=map+1;custom[row+2]=custom[row+3]=0;
  put32(custom,row+4,0x08000000+wildInfo);
  for(let f=8;f<20;f++)custom[row+f]=0;
}
const expandedScan=R.importRom(custom);
assert.strictEqual(expandedScan.counts.routes,16,'Separated custom region encounter headers must be included');
assert(expandedScan.data.routeEncounters.some(a=>a.mapGroup===4&&a.mapNumber===7));

// Some expansion forks (including time-of-day variants) encode four sets of
// land/water/rock/fishing/hidden pointers per map, with up to 24 land slots.
const timed=baseRom();
const timedInfo=0x70000,timedSlots=0x70100,timedHeaders=0x68000;
timed[timedInfo]=40;
for(let p=1;p<4;p++)timed[timedInfo+p]=0;
put32(timed,timedInfo+4,0x08000000+timedSlots);
for(let i=0;i<24;i++){
  const slot=timedSlots+i*4;timed[slot]=5;timed[slot+1]=12;put16(timed,slot+2,i+1);
}
for(let m=0;m<9;m++){
  const row=timedHeaders+m*84;
  timed[row]=3;timed[row+1]=m+1;timed[row+2]=timed[row+3]=0;
  for(let day=0;day<4;day++){
    put32(timed,row+4+day*20,0x08000000+timedInfo);
    for(let kind=1;kind<5;kind++)put32(timed,row+4+day*20+kind*4,0);
  }
}
const timedScan=R.importRom(timed);
assert.strictEqual(timedScan.counts.routes,9,'Four-period encounter headers should be detected');
assert.strictEqual(timedScan.data.routeEncounters[0].methods.length,4);
assert.strictEqual(timedScan.data.routeEncounters[0].methods[0].slots.length,24);
assert.strictEqual(timedScan.data.routeEncounters[0].methods[0].name,'Morning · Walking');

const noWild=R.importRom(baseRom());
assert.strictEqual(noWild.counts.routes,0,'Unverified encounters must not be fabricated');

const sample=baseRom();
const frlg=baseRom();
writeAscii(frlg,0xAC,'BPRE');
const banner='pokemon firered version';
writeAscii(frlg,0x208,banner);
frlg.fill(255,0x208+banner.length,0x208+'pokemon emerald version'.length);
const frlgScan=R.importRom(frlg);
assert.strictEqual(frlgScan.details.gameFamily,'firered');
assert.strictEqual(frlgScan.details.generation,3);
assert(frlgScan.header&&frlgScan.header.saveLayout,'FireRed GFRomHeader should be detected');
const rs=baseRom();writeAscii(rs,0xAC,'AXVE');
writeAscii(rs,0x208,'pokemon ruby version');
const rubyScan=R.importRom(rs);
assert.strictEqual(rubyScan.details.gameFamily,'ruby');
assert(rubyScan.header,'Ruby GFRomHeader should be detected');
const plain=R.importRom(sample);
assert.strictEqual(plain.details.title,'BRISK TEST');
assert.strictEqual(plain.header.itemsInfo,0x30000);
assert.strictEqual(plain.header.movesInfo,0x20000);
assert.strictEqual(plain.header.saveLayout.partyCountOffset,0x234);
assert.strictEqual(plain.header.saveLayout.partyOffset,0x238);
assert.strictEqual(plain.rhh.species,300);
assert.strictEqual(plain.counts.species,28);
assert.strictEqual(plain.data.moves['2'],'Karate Chop');
assert.strictEqual(plain.data.items['1'],'Master Ball');
assert.strictEqual(plain.data.abilities['3'],'Speed Boost');
assert.strictEqual(plain.data.species['1'].name,'Bulbasaur');
assert.strictEqual(plain.data.species['2'].baseStats[3],45);
assert.strictEqual(plain.counts.trainers,0);
assert.strictEqual(plain.complete,false);
assert(plain.warnings.some(s=>s.includes('Trainer teams')));

const packed={format:'briskdex-rom-v1',compatibility:{profile:{id:'rom-custom',name:'ROM custom save',writePolicy:'readonly'}},assets:{icons:{'1':'data:image/png;base64,aGVsbG8='},shinyIcons:{'1':'data:image/png;base64,aGVsbG8='}},data:{
  species:{'1':{name:'Custommon',types:['Water']}},
  moves:{'1':'Tackle'},items:{'1':'Poké Ball'},abilities:{'1':'Sturdy'},
  itemDetails:{'1':{name:'Poké Ball'}},moveDetails:{'1':{name:'Tackle'}},abilityDetails:{'1':{name:'Sturdy'}},
  trainerTeams:[{constant:'TRAINER_1',name:'TEST',party:[{species:'Custommon',fields:{Level:'42'},moves:['Tackle']}]}],
  routeEncounters:[{id:'CustomRoute',name:'New Route',methods:[{name:'Grass',type:'land',encounterRate:20,slots:[{species:1,minLevel:4,maxLevel:8,chance:100}]}]}],
  mapCatalog:[{id:'MAP_CUSTOM_ISLAND',name:'Custom Island',type:'MAP_TYPE_ROUTE',connections:[],warps:[]}]
}};
let data=enc.encode(JSON.stringify(packed)),size=sample.length,full=new Uint8Array(size+data.length+16);
full.set(sample);full.set(data,size);put32(full,size+data.length,data.length);
put32(full,size+data.length+4,R.crc32(data,0,data.length));writeAscii(full,size+data.length+8,R.MAGIC);
let loaded=R.importRom(full);
assert.strictEqual(loaded.source,'embedded-manifest');
assert.strictEqual(loaded.complete,true);
const incomplete=R.importRom(sample,{manifest:{format:'briskdex-rom-v1',data:{species:{'1':{name:'Test'}},moves:{},routeEncounters:[]}}});
assert.strictEqual(incomplete.complete,false);
assert(incomplete.warnings.some(msg=>msg.includes('incomplete reference index')));
assert.strictEqual(loaded.counts.species,1);
assert.strictEqual(loaded.counts.trainers,1);
assert.strictEqual(loaded.counts.routes,1);
assert.strictEqual(loaded.counts.maps,1);
assert.strictEqual(loaded.data.mapCatalog[0].name,'Custom Island');
assert.strictEqual(loaded.saveProfile.id,'rom-custom','Source-indexed ROM profile should survive import');
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

