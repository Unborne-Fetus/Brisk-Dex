import {assert,clone,experience} from './model.mjs';
import {Campaign} from './world.mjs';
import {createGbaReader} from './gba-reader.mjs';
import {sha256} from './storage.mjs';
const SECTOR=4096,DATA=3968,SIGNATURE=0x08012025;
const SIZES=[3884,3968,3968,3968,3848,3968,3968,3968,3968,3968,3968,3968,3968,3968];
export function sectionChecksum(bytes,size){let sum=0;const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);for(let i=0;i<size;i+=4)sum=(sum+view.getUint32(i,true))>>>0;return ((sum>>>16)+(sum&65535))&65535;}
function concat(parts){const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;}
export function toBase64(bytes){let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);}
export function fromBase64(text){return Uint8Array.from(atob(text),c=>c.charCodeAt(0));}
function bank(bytes,start,modern){
  const sections=new Map();let counter=null,legacy=false;
  for(let i=0;i<14;i++){
    const offset=start+i*SECTOR;if(offset+SECTOR>bytes.length)return null;const raw=bytes.subarray(offset,offset+SECTOR),v=new DataView(raw.buffer,raw.byteOffset,raw.byteLength),id=v.getUint16(0xff4,true),index=v.getUint32(0xffc,true);
    if(v.getUint32(0xff8,true)!==SIGNATURE||id>13||sections.has(id)||counter!==null&&index!==counter)return null;
    const sizes=id===13?(modern?[3968]:[2400,2000,3968]):[SIZES[id]],size=sizes.find(s=>sectionChecksum(raw,s)===v.getUint16(0xff6,true));if(!size)return null;
    counter=index;sections.set(id,raw.subarray(0,DATA));if(id===13&&size<3968)legacy=true;
  }
  return {sections,counter,legacy};
}
export function readGbaSave(input,catalog){
  const bytes=new Uint8Array(input instanceof Uint8Array?input:new Uint8Array(input));assert([0x1c000,0x20000].includes(bytes.length),'Use a raw 112 KiB or 128 KiB Brisk .sav/.srm file, not a ROM or emulator save state');
  const modern=bytes.length===0x20000&&Array.from({length:4},(_,i)=>new DataView(bytes.buffer,bytes.byteOffset+(28+i)*SECTOR,SECTOR).getUint16(0xff4,true)).some(id=>id>=0x100&&id<=0x103);
  const a=bank(bytes,0,modern),b=bank(bytes,0xe000,modern);assert(a||b,'No complete checksum-valid Brisk save bank was found');
  const selected=a&&b?(((a.counter-b.counter)>>>0)<0x80000000?a:b):a||b;
  const sections=selected.sections,v0=new DataView(sections.get(0).buffer,sections.get(0).byteOffset,DATA),v1=new DataView(sections.get(1).buffer,sections.get(1).byteOffset,DATA),key=v0.getUint32(0xac,true),reader=createGbaReader(catalog.data),partyCount=v1.getUint32(0x234,true);assert(partyCount<=6,'Invalid party count: unsupported save layout');
  let pc=concat(Array.from({length:9},(_,i)=>sections.get(i+5)));let boxCount=14;
  const extPresent=modern;
  if(extPresent){
    assert(!selected.legacy,'Expanded PC and legacy bank disagree; recover/save in the GBA game first');const parts=[];
    for(let i=0;i<4;i++){
      const off=(28+i)*SECTOR,raw=bytes.subarray(off,off+SECTOR),v=new DataView(raw.buffer,raw.byteOffset,SECTOR),size=[3968,3968,3968,988][i];
      assert(v.getUint16(0xff4,true)===0x100+i&&v.getUint32(0xff8,true)===SIGNATURE&&v.getUint32(0xffc,true)===selected.counter&&v.getUint16(0xff6,true)===sectionChecksum(raw,size),'Expanded PC is damaged or belongs to another save generation; recover/save in the GBA game first');parts.push(raw.subarray(0,size));
    }pc=concat([pc,...parts]);boxCount=20;
  }else assert(selected.legacy,'Expanded PC sectors are missing; use the complete 128 KiB battery save');
  const records=[];
  function record(raw,slot,party){if(raw.every(b=>b===0)||raw.every(b=>b===255))return;records.push({raw:new Uint8Array(raw),slot,party,decoded:reader.decodePokemon(raw,party)});}
  for(let i=0;i<partyCount;i++)record(sections.get(1).subarray(0x238+i*100,0x238+(i+1)*100),{party:i},true);
  for(let box=0;box<boxCount;box++)for(let slot=0;slot<30;slot++){const off=4+(box*30+slot)*80;record(pc.subarray(off,off+80),{box,slot},false);}
  const bag={};for(const [offset,count]of [[0x560,30],[0x5d8,30],[0x650,16],[0x690,64],[0x790,46]])for(let i=0;i<count;i++){const at=offset+i*4,id=v1.getUint16(at,true),quantity=v1.getUint16(at+2,true)^(key&65535);if(id&&quantity)bag[id]=(bag[id]||0)+quantity;}
  const block1=concat([1,2,3,4].map(id=>sections.get(id))),trainer=reader.parseTrainer(v0,sections.get(0));
  const money=(v1.getUint32(0x490,true)^key)>>>0;assert(money<=999999999,'Invalid money: unsupported save layout');
  return {bytes,records,bag,trainer,money,counter:selected.counter,boxCount,boxNames:Array.from({length:boxCount},(_,i)=>decodeName(reader,pc.subarray(4+boxCount*30*80+i*9,4+boxCount*30*80+(i+1)*9))),location:{group:v1.getUint8(4),number:v1.getUint8(5),x:v1.getInt16(0,true),y:v1.getInt16(2,true)},block1,fallbackBank:!(a&&b)};
}
function decodeName(reader,bytes){return reader.decodeString?reader.decodeString(bytes):toBase64(bytes);}
function status(bits){if(bits&7)return 'sleep';if(bits&128)return 'toxic';if(bits&8)return 'poison';if(bits&16)return 'burn';if(bits&32)return 'freeze';if(bits&64)return 'paralysis';return null;}
export function restoreGbaStory(save,state,catalog){
 const layout=catalog.storyData?.saveLayouts?.[save.boxCount]||catalog.storyData?.saveLayout;if(!layout)return {applied:false};
 assert(layout.flagsOffset+layout.flagBytes<=save.block1.length&&layout.varsOffset+layout.varsCount*2<=save.block1.length,'Story layout exceeds save block');
 const view=new DataView(save.block1.buffer,save.block1.byteOffset,save.block1.byteLength),flags={},vars={};
 for(const [key,id]of Object.entries(layout.flags)){if(key.startsWith('FLAG_TEMP_'))continue;flags[key]=!!(save.block1[layout.flagsOffset+(id>>3)]&(1<<(id&7)));}
 for(const [key,id]of Object.entries(layout.trainers)){const bit=layout.trainerFlagsStart+id;flags[key]=!!(save.block1[layout.flagsOffset+(bit>>3)]&(1<<(bit&7)));}
 for(const [key,id]of Object.entries(layout.vars)){if(key.startsWith('VAR_TEMP_'))continue;vars[key]=view.getUint16(layout.varsOffset+(id-layout.varsStart)*2,true);}
 state.flags=flags;state.vars=vars;state.flashLevel=save.block1[0x30];state.options.overworldEncounters=true;
 state.options.difficulty=['normal','easy','hard','extreme'][vars.VAR_BRISK_DIFFICULTY]||'normal';state.options.battleBag=!vars.VAR_BRISK_BATTLE_BAG_DISABLED;state.options.orangeShinies=!vars.VAR_BRISK_ISLAND_SHINIES_DISABLED;
 const shiny=[8192,4096,2048,1024,512,256,128,100,50];state.options.shinyOdds=shiny[vars.VAR_BRISK_SHINY_ODDS-1]||512;state.options.expShareMode=Math.min(2,vars.VAR_BRISK_EXP_SHARE||0);state.options.expShare=vars.VAR_BRISK_EXP_SHARE===1&&Object.entries(catalog.data.itemDetails).some(([id,item])=>item.constant==='ITEM_MODERN_EXP_SHARE'&&(state.inventory[id]||0)>0);
 return {applied:true,flags:Object.keys(flags).length,variables:Object.keys(vars).length};
}
export async function importGbaSave(input,catalog,pack,layout){
  const save=readGbaSave(input,catalog),campaign=Campaign.start(catalog,pack,'TREECKO',save.counter||1),s=campaign.state;
  s.party=[];s.boxes=[];s.inventory={};s.trainer={...save.trainer};s.money=save.money;s.nextId=1;s.seen=[];s.caught=[];
  const report={format:'brisk-gba-import-report',saveCounter:save.counter,boxCount:save.boxCount,party:0,stored:0,archived:[],adjustments:[],warnings:['This import is one-way. Native progress cannot currently be written back to the GBA save.','Eggs, fusion storage, ribbons, markings and other unimplemented metadata remain in the original-save archive; unsupported Pokémon are listed separately.']};
  for(const entry of save.records){const raw=entry.raw,m=entry.decoded;
    try{
      assert(m&&!m.empty&&m.checksumValid,'Invalid Pokémon checksum or record');assert(!m.isEgg&&!(raw[19]&5),'Eggs/bad eggs are not playable in this runtime');const species=catalog.species(m.species),level=(()=>{let n=1;while(n<100&&m.experience>=experience(n+1,species.growthRate))n++;return n;})();
      const nature=(m.personality%25)^(raw[18]>>>3);assert(nature<25,'Invalid hidden nature');
      const ability=species.abilities[m.abilitySlot];assert(ability,'Unsupported ability slot');
      const mon={uid:`mon-${s.nextId}`,species:m.species,level,exp:m.experience,nickname:m.nickname||species.name,nature,ivs:[m.ivs.hp,m.ivs.atk,m.ivs.def,m.ivs.spd,m.ivs.spa,m.ivs.spdef],evs:[m.evs.hp,m.evs.atk,m.evs.def,m.evs.spd,m.evs.spa,m.evs.spdef],ability,item:m.heldItem,shiny:m.isShiny,moves:m.moves.map((id,i)=>({id,pp:m.pp[i],ppUps:(m.ppBonuses>>>(i*2))&3})).filter(m=>m.id>0),status:entry.party?status(m.status):[null,'sleep','sleep','sleep','sleep','sleep','poison','burn','freeze','paralysis','toxic',null][raw[27]>>>4],hp:1,origin:'gba-import',gba:{...entry.slot,personality:m.personality,otId:m.otId,otName:m.otName,friendship:m.friendship,teraType:m.teraType,ball:m.ballCaught,metLocation:m.metLocation,raw:toBase64(raw)}};
      const max=catalog.stats(mon)[0];mon.hp=entry.party&&m.maxHP>0?Math.min(max,Math.ceil(m.currentHP*max/m.maxHP)):Math.max(0,max-(new DataView(raw.buffer,raw.byteOffset,raw.byteLength).getUint16(30,true)&0x3fff));
      if(entry.party&&m.maxHP!==max)report.adjustments.push({slot:entry.slot,reason:'HP scaled to native recalculated stats; original stored in archive'});
      catalog.validateMon(mon);(entry.party?s.party:s.boxes).push(mon);s.nextId++;campaign.mark('seen',mon.species);campaign.mark('caught',mon.species);
    }catch(error){report.archived.push({slot:entry.slot,reason:error.message});}
  }
  if(!s.party.length&&s.boxes.length){s.party.push(s.boxes.shift());report.adjustments.push({reason:'Promoted the first playable boxed Pokémon because no playable party member could be imported'});}
  assert(s.party.length,'No playable Pokémon could be imported. Original save remains unchanged.');
  for(const [id,count]of Object.entries(save.bag)){if(catalog.data.items[id]&&count<=999999)s.inventory[id]=count;else report.archived.push({item:Number(id),count,reason:'Unsupported inventory entry preserved in original save'});}
  const target=layout?.maps?.[`${save.location.group}:${save.location.number}`],map=pack.maps[target?.nativeMap||catalog.fieldData?.mapNames?.[target?.sourceName]];
  const mode=catalog.fieldData?.maps?.[map?.id]?.mapType==='MAP_TYPE_UNDERWATER'?'underwater':map&&campaign.tile(save.location.x,save.location.y,map)==='~'?'surf':'land';
  if(map&&campaign.canOccupy(save.location.x,save.location.y,map,mode)){s.position={map:map.id,x:save.location.x,y:save.location.y};s.field={mode};}else report.warnings.push('Saved location is unavailable/blocked; placed at the standalone starting location. Original coordinates are archived.');
  report.story=restoreGbaStory(save,s,catalog);if(!report.story.applied)report.warnings.push('Source story metadata is unavailable. Story flags were not restored.');
  report.party=s.party.length;report.stored=s.boxes.length;
  s.gbaSource={format:'brisk-gba-original',sha256:await sha256(save.bytes),bytes:toBase64(save.bytes),location:save.location,boxNames:save.boxNames,report};
  campaign.snapshot();return {campaign,report};
}
export async function originalGbaBytes(state){assert(state.gbaSource?.format==='brisk-gba-original','No original GBA save is archived');const bytes=fromBase64(state.gbaSource.bytes);assert(await sha256(bytes)===state.gbaSource.sha256,'Original GBA archive checksum mismatch');return bytes;}
