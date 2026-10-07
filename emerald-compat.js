(function(global){
'use strict';

var STORAGE_KEY='briskdex_emerald_custom_profiles_v1';
var SUB_ORDERS=[
  'GAEM','GAME','GEAM','GEMA','GMAE','GMEA',
  'AGEM','AGME','AEGM','AEMG','AMGE','AMEG',
  'EGAM','EGMA','EAGM','EAMG','EMGA','EMAG',
  'MGAE','MGEA','MAGE','MAEG','MEGA','MEAG'
];

var DEFAULT_CHECKSUM_SIZES={0:3884,1:3968,2:3968,3:3968,4:3848,5:3968,6:3968,7:3968,8:3968,9:3968,10:3968,11:3968,12:3968,13:2000};
var DEFAULT_BAG=[
  {offset:0x560,count:30,category:'other'},
  {offset:0x5D8,count:30,category:'key'},
  {offset:0x650,count:16,category:'balls'},
  {offset:0x690,count:64,category:'tms'},
  {offset:0x790,count:46,category:'berries'}
];

function deepClone(value){return JSON.parse(JSON.stringify(value));}
function merge(base,extra){
  var out=deepClone(base||{});
  Object.keys(extra||{}).forEach(function(key){
    var value=extra[key];
    if(value && typeof value==='object' && !Array.isArray(value) && out[key] && typeof out[key]==='object' && !Array.isArray(out[key]))
      out[key]=merge(out[key],value);
    else out[key]=deepClone(value);
  });
  return out;
}

var BASE_PROFILE={
  schemaVersion:1,
  family:'emerald',
  baseGame:'emerald',
  writePolicy:'full',
  pokemonEncoding:'vanilla-gen3',
  speciesMapping:'emerald-internal',
  idLimits:{species:386,moves:354,items:376,abilities:77},
  idMaps:{species:{},moves:{},items:{},abilities:{}},
  save:{
    minimumSize:0x1C000,
    blockOffsets:[0x0000,0xE000],
    sectionSize:4096,
    sectionDataSize:3968,
    sectionCount:14,
    signature:0x08012025,
    partyCountOffset:0x0234,
    partyOffset:0x0238,
    partyRecordSize:100,
    moneyOffset:0x0490,
    encryptionKeyOffset:0x00AC,
    checksumSizes:DEFAULT_CHECKSUM_SIZES
  },
  pokemon:{
    boxRecordSize:80,
    partyRecordSize:100,
    speciesMask:0xFFFF,
    heldItemMask:0xFFFF,
    experienceMask:0xFFFFFFFF,
    moveMask:0xFFFF,
    ppMask:0xFF,
    teraShift:null,
    teraMask:0,
    abilityMode:'vanilla-bit31',
    provenanceBit:null,
    shinyOverrideBit:null,
    shinyThreshold:8
  },
  pc:{
    boxCount:14,
    slotsPerBox:30,
    mainSectionIds:[5,6,7,8,9,10,11,12,13],
    sectionSize:3968,
    lastSectionSize:2000,
    extension:null
  },
  bag:{pockets:DEFAULT_BAG,quantityEncrypted:true,maxStack:999},
  dex:{kind:'saveblock2',flagBytes:52,ownedOffset:0x28,seenOffset:0x5C},
  trainer:{outfitOffset:null},
  features:{tera:false,provenance:false,shinyOverride:false,outfits:false,expandedBoxes:false},
  fingerprints:[]
};

var BUILTINS={
  emerald:merge(BASE_PROFILE,{
    id:'emerald',
    name:'Pokémon Emerald / Emerald-based hack',
    description:'Conservative standard Emerald layout.',
    writePolicy:'full'
  }),
  'pokeemerald-expansion-generic':merge(BASE_PROFILE,{
    id:'pokeemerald-expansion-generic',
    name:'Generic pokeemerald-expansion hack',
    description:'Conservative expansion-family profile. Uses standard Emerald save/Pokémon fields unless a game-specific pack overrides them.',
    writePolicy:'readonly',
    speciesMapping:'national-direct',
    idLimits:{species:2047,moves:2047,items:1023,abilities:1023},
    pokemon:{speciesMask:0x07FF,heldItemMask:0x03FF,experienceMask:0x001FFFFF,moveMask:0x07FF,ppMask:0x7F,abilityMode:'expansion-bits29-30'},
    dex:{kind:'unknown',flagBytes:0},
    features:{tera:false,provenance:false,shinyOverride:false,outfits:false,expandedBoxes:false}
  }),
  'brisk-emerald':merge(BASE_PROFILE,{
    id:'brisk-emerald',
    name:'Pokémon Brisk Emerald',
    description:'Brisk Emerald expanded save and Pokémon metadata.',
    brisk:true,
    writePolicy:'full',
    pokemonEncoding:'brisk-expansion',
    speciesMapping:'national-direct',
    idLimits:{species:2047,moves:2047,items:1023,abilities:1023},
    pokemon:{
      speciesMask:0x07FF,heldItemMask:0x03FF,experienceMask:0x001FFFFF,moveMask:0x07FF,ppMask:0x7F,
      teraShift:11,teraMask:0x1F,abilityMode:'expansion-bits29-30',provenanceBit:15,shinyOverrideBit:14,shinyThreshold:8
    },
    pc:{
      boxCount:20,
      extension:{
        physicalSectors:[28,29,30,31],
        ids:[0x100,0x101,0x102,0x103],
        sizes:[3968,3968,3968,988]
      }
    },
    dex:{kind:'saveblock1-linear',flagBytes:129,seenOffset:0x3598,caughtOffset:0x3619,sectionIds:[1,2,3,4]},
    trainer:{outfitOffset:0x0090},
    features:{tera:true,provenance:true,shinyOverride:true,outfits:true,expandedBoxes:true},
    fingerprints:[{type:'pc-extension',sector:28,id:0x100,signature:0x08012025}]
  })
};

var customProfiles={};

function normalizeProfile(profile){
  if(!profile || typeof profile!=='object') throw new Error('Compatibility profile must be a JSON object.');
  if(!profile.id || !/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(profile.id)) throw new Error('Profile id must be 2-64 letters, numbers, dots, underscores, or dashes.');
  if(!profile.name || typeof profile.name!=='string') throw new Error('Profile name is required.');
  if(profile.family && profile.family!=='emerald') throw new Error('This compatibility build only accepts Emerald-family profiles.');
  var normalized=merge(BASE_PROFILE,profile);
  normalized.family='emerald';
  if(!['full','readonly'].includes(normalized.writePolicy)) throw new Error('writePolicy must be "full" or "readonly".');
  if(!Number.isInteger(normalized.pc.boxCount) || normalized.pc.boxCount<1 || normalized.pc.boxCount>255) throw new Error('pc.boxCount must be between 1 and 255.');
  if(!Number.isInteger(normalized.pc.slotsPerBox) || normalized.pc.slotsPerBox<1 || normalized.pc.slotsPerBox>255) throw new Error('pc.slotsPerBox must be between 1 and 255.');
  if(!Array.isArray(normalized.bag.pockets)) throw new Error('bag.pockets must be an array.');
  normalized.bag.pockets.forEach(function(pocket){
    if(!Number.isInteger(pocket.offset)||pocket.offset<0||!Number.isInteger(pocket.count)||pocket.count<0) throw new Error('Every Bag pocket needs non-negative integer offset/count.');
    if(!pocket.category) throw new Error('Every Bag pocket needs a category.');
  });
  if(normalized.pc.extension){
    var ext=normalized.pc.extension;
    if(!Array.isArray(ext.physicalSectors)||!Array.isArray(ext.ids)||!Array.isArray(ext.sizes)||
       ext.physicalSectors.length!==ext.ids.length||ext.ids.length!==ext.sizes.length)
      throw new Error('pc.extension physicalSectors, ids, and sizes must be equal-length arrays.');
  }
  return normalized;
}

function loadCustomProfiles(){
  customProfiles={};
  try{
    var raw=global.localStorage && global.localStorage.getItem(STORAGE_KEY);
    var parsed=raw?JSON.parse(raw):{};
    Object.keys(parsed||{}).forEach(function(id){
      try{var p=normalizeProfile(parsed[id]);customProfiles[p.id]=p;}catch(e){}
    });
  }catch(e){}
}
function persistCustomProfiles(){
  try{if(global.localStorage)global.localStorage.setItem(STORAGE_KEY,JSON.stringify(customProfiles));}catch(e){}
}
loadCustomProfiles();

function profileForId(id){
  if(!id)return null;
  var p=BUILTINS[id]||customProfiles[id];
  return p?deepClone(p):null;
}
function listProfiles(){
  return Object.keys(BUILTINS).map(function(id){return profileForId(id);})
    .concat(Object.keys(customProfiles).sort().map(function(id){return profileForId(id);}));
}

function importPack(pack){
  if(!pack||typeof pack!=='object')throw new Error('Compatibility pack must be a JSON object.');
  var profiles=[];
  if(pack.profile)profiles=[pack.profile];
  else if(Array.isArray(pack.profiles))profiles=pack.profiles;
  else if(pack.id)profiles=[pack];
  if(!profiles.length)throw new Error('No compatibility profile was found in this pack.');
  var imported=[];
  profiles.forEach(function(raw){
    var p=normalizeProfile(raw);
    if(BUILTINS[p.id])throw new Error('Built-in profile ids cannot be overwritten: '+p.id);
    customProfiles[p.id]=p;imported.push(p.id);
  });
  persistCustomProfiles();
  return {profileIds:imported,data:pack.data||pack.gameData||null,meta:pack.meta||null};
}
function removeCustomProfile(id){
  if(!customProfiles[id])return false;
  delete customProfiles[id];persistCustomProfiles();return true;
}

function readU16(bytes,off){
  if(off<0||off+2>bytes.length)return null;
  return bytes[off]|(bytes[off+1]<<8);
}
function readU32(bytes,off){
  if(off<0||off+4>bytes.length)return null;
  return (bytes[off]|(bytes[off+1]<<8)|(bytes[off+2]<<16)|(bytes[off+3]<<24))>>>0;
}
function fingerprintMatches(profile,bytes,context){
  var rules=profile.fingerprints||[];
  if(!rules.length)return false;
  return rules.every(function(rule){
    if(rule.type==='file-size')return bytes.length===Number(rule.value);
    if(rule.type==='min-file-size')return bytes.length>=Number(rule.value);
    if(rule.type==='u16')return readU16(bytes,Number(rule.offset))===Number(rule.value);
    if(rule.type==='u32')return readU32(bytes,Number(rule.offset))===Number(rule.value);
    if(rule.type==='pc-extension'){
      var off=Number(rule.sector)*4096;
      return readU16(bytes,off+0xFF4)===Number(rule.id)&&readU32(bytes,off+0xFF8)===Number(rule.signature||0x08012025);
    }
    if(rule.type==='context')return context && context[rule.key]===rule.value;
    return false;
  });
}

function runtimeProfile(profile,confidence,writeSafe,reason){
  var p=deepClone(profile);
  p.confidence=confidence;
  p.writeSafe=!!writeSafe && p.writePolicy!=='readonly';
  p.readOnlyReason=p.writeSafe?'':(reason||'This profile is not considered safe for save writes.');
  return p;
}

function detectProfile(context){
  context=context||{};
  var bytes=context.bytes instanceof Uint8Array?context.bytes:new Uint8Array(context.bytes||0);
  if(context.override && context.override!=='auto'){
    var forced=profileForId(context.override);
    if(!forced)throw new Error('Unknown Emerald compatibility profile: '+context.override);
    return runtimeProfile(forced,'explicit',forced.writePolicy==='full',forced.writePolicy==='readonly'?'This imported/profile definition is read-only.':'');
  }
  var all=listProfiles();
  for(var i=0;i<all.length;i++){
    if(all[i].fingerprints && all[i].fingerprints.length && fingerprintMatches(all[i],bytes,context))
      return runtimeProfile(all[i],'exact',all[i].writePolicy==='full','');
  }
  // A standard 14-sector Emerald-looking save is deliberately only "likely":
  // there is no reliable hack identity inside a generic .sav.
  return runtimeProfile(BUILTINS.emerald,'likely',false,'Auto-detection cannot prove which Emerald ROM/hack created this save. Select the Standard Emerald profile explicitly to enable writes.');
}

function emeraldInternalSpeciesToNational(raw){
  raw=Number(raw)||0;
  if(raw>=1&&raw<=251)return raw;
  if(raw>=252&&raw<=276)return 201;
  if(raw>=277&&raw<=411)return raw-25;
  return raw;
}
function nationalSpeciesToEmeraldInternal(id){
  id=Number(id)||0;
  if(id>=1&&id<=251)return id;
  if(id>=252&&id<=386)return id+25;
  return id;
}

function mapId(profile,kind,value,toDisplay){
  value=Number(value)||0;
  var map=(profile.idMaps&&profile.idMaps[kind])||{};
  if(toDisplay){
    if(Object.prototype.hasOwnProperty.call(map,String(value)))return Number(map[String(value)]);
    if(kind==='species'&&profile.speciesMapping==='emerald-internal')return emeraldInternalSpeciesToNational(value);
    return value;
  }
  var keys=Object.keys(map);
  for(var i=0;i<keys.length;i++)if(Number(map[keys[i]])===value)return Number(keys[i]);
  if(kind==='species'&&profile.speciesMapping==='emerald-internal')return nationalSpeciesToEmeraldInternal(value);
  return value;
}

function readDexFlags(profile,sections){
  profile=profile||BUILTINS.emerald;
  var dex=profile.dex||{};
  if(dex.kind==='unknown'||!dex.flagBytes)return {seen:new Uint8Array(0),caught:new Uint8Array(0),known:false};
  if(dex.kind==='saveblock2'){
    var s0=sections[0];
    if(!s0)return {seen:new Uint8Array(0),caught:new Uint8Array(0),known:false};
    return {caught:s0.slice(dex.ownedOffset,dex.ownedOffset+dex.flagBytes),seen:s0.slice(dex.seenOffset,dex.seenOffset+dex.flagBytes),known:true};
  }
  if(dex.kind==='saveblock1-linear'){
    var ids=dex.sectionIds||[1,2,3,4],parts=[];
    for(var i=0;i<ids.length;i++){if(!sections[ids[i]])return {seen:new Uint8Array(0),caught:new Uint8Array(0),known:false};parts.push(sections[ids[i]]);}
    var total=parts.reduce(function(n,p){return n+p.length;},0),all=new Uint8Array(total),pos=0;
    parts.forEach(function(p){all.set(p,pos);pos+=p.length;});
    var seenOff=Number(dex.seenOffset)||0,caughtOff=dex.caughtOffset==null?seenOff+dex.flagBytes:Number(dex.caughtOffset);
    return {seen:all.slice(seenOff,seenOff+dex.flagBytes),caught:all.slice(caughtOff,caughtOff+dex.flagBytes),known:true};
  }
  return {seen:new Uint8Array(0),caught:new Uint8Array(0),known:false};
}

function checksumSize(profile,sectionId){
  var sizes=profile&&profile.save&&profile.save.checksumSizes||DEFAULT_CHECKSUM_SIZES;
  return Number(sizes[sectionId]!==undefined?sizes[sectionId]:sizes[String(sectionId)]);
}
function bagPockets(profile){return deepClone((profile&&profile.bag&&profile.bag.pockets)||DEFAULT_BAG);}

function validateContentForProfile(mon,destinationProfile){
  var p=destinationProfile||BUILTINS.emerald,issues=[];
  if(!mon||mon.empty)return {ok:false,issues:['Empty Pokémon record.']};
  var limits=p.idLimits||{};
  if(Number(mon.species)>Number(limits.species||65535))issues.push('Species #'+mon.species+' is not supported by '+p.name+'.');
  (mon.moves||[]).filter(Boolean).forEach(function(id){if(Number(id)>Number(limits.moves||65535))issues.push('Move #'+id+' is not supported by '+p.name+'.');});
  if(Number(mon.heldItem||0)>Number(limits.items||65535))issues.push('Held item #'+mon.heldItem+' is not supported by '+p.name+'.');
  if(mon.teraType!=null && mon.teraType!==0 && !(p.features&&p.features.tera))issues.push('The destination profile does not store Tera Types.');
  return {ok:issues.length===0,issues:issues};
}

function decryptRecord(raw){
  if(!(raw instanceof Uint8Array)||raw.length<80)throw new Error('Pokémon record must contain at least 80 bytes.');
  var view=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
  var personality=view.getUint32(0,true),otId=view.getUint32(4,true),key=(personality^otId)>>>0;
  var secure=new Uint8Array(48);secure.set(raw.subarray(0x20,0x50));
  var dv=new DataView(secure.buffer);
  for(var w=0;w<12;w++)dv.setUint32(w*4,(dv.getUint32(w*4,true)^key)>>>0,true);
  var order=SUB_ORDERS[personality%24],offsets={};
  for(var i=0;i<4;i++)offsets[order[i]]=i*12;
  return {personality:personality,otId:otId,key:key,secure:secure,dv:dv,offsets:offsets};
}
function encryptRecord(raw,decoded){
  var out=raw.slice(),view=new DataView(out.buffer,out.byteOffset,out.byteLength),plain=decoded.dv,key=decoded.key,order=SUB_ORDERS[decoded.personality%24];
  for(var sub=0;sub<4;sub++){
    var source=({G:decoded.offsets.G,A:decoded.offsets.A,E:decoded.offsets.E,M:decoded.offsets.M})[order[sub]];
    var target=0x20+sub*12;
    for(var word=0;word<3;word++)view.setUint32(target+word*4,(plain.getUint32(source+word*4,true)^key)>>>0,true);
  }
  var sum=0;for(var c=0;c<24;c++)sum=(sum+plain.getUint16(c*2,true))&0xFFFF;
  view.setUint16(0x1C,sum,true);
  return out;
}

function recordSummary(raw,profile){
  var d=decryptRecord(raw),dv=d.dv,g=d.offsets.G,a=d.offsets.A,m=d.offsets.M,p=profile||BUILTINS.emerald,pk=p.pokemon||{};
  var speciesWord=dv.getUint16(g,true),rawSpecies=speciesWord&(pk.speciesMask==null?0xFFFF:pk.speciesMask);
  var held=dv.getUint16(g+2,true)&(pk.heldItemMask==null?0xFFFF:pk.heldItemMask);
  var moves=[];
  for(var i=0;i<4;i++)moves.push(dv.getUint16(a+i*2,true)&(pk.moveMask==null?0xFFFF:pk.moveMask));
  return {
    species:mapId(p,'species',rawSpecies,true),
    rawSpecies:rawSpecies,
    heldItem:mapId(p,'items',held,true),
    moves:moves.map(function(x){return mapId(p,'moves',x,true);}),
    personality:d.personality,otId:d.otId,
    teraType:pk.teraShift==null?null:((speciesWord>>>pk.teraShift)&pk.teraMask),
    abilitySlot:pk.abilityMode==='vanilla-bit31'?((dv.getUint32(m+4,true)>>>31)&1):((dv.getUint32(m+8,true)>>>29)&3)
  };
}

function convertPokemonRecord(raw,sourceProfile,destinationProfile){
  var source=typeof sourceProfile==='string'?profileForId(sourceProfile):sourceProfile;
  var dest=typeof destinationProfile==='string'?profileForId(destinationProfile):destinationProfile;
  if(!source||!dest)throw new Error('Both source and destination compatibility profiles are required.');
  var summary=recordSummary(raw,source),check=validateContentForProfile(summary,dest);
  if(!check.ok)throw new Error(check.issues.join(' '));

  var d=decryptRecord(raw),dv=d.dv,g=d.offsets.G,a=d.offsets.A,m=d.offsets.M,sp=source.pokemon||{},dp=dest.pokemon||{};
  var destSpecies=mapId(dest,'species',summary.species,false);
  var speciesWord=destSpecies&(dp.speciesMask==null?0xFFFF:dp.speciesMask);
  if(dp.teraShift!=null && dest.features&&dest.features.tera && summary.teraType!=null)speciesWord|=(Number(summary.teraType)&dp.teraMask)<<dp.teraShift;
  dv.setUint16(g,speciesWord,true);
  dv.setUint16(g+2,mapId(dest,'items',summary.heldItem,false)&(dp.heldItemMask==null?0xFFFF:dp.heldItemMask),true);
  summary.moves.forEach(function(moveId,i){dv.setUint16(a+i*2,mapId(dest,'moves',moveId,false)&(dp.moveMask==null?0xFFFF:dp.moveMask),true);});

  var ivWord=dv.getUint32(m+4,true),miscWord=dv.getUint32(m+8,true);
  // Remove source ability representation, then set destination representation.
  if(sp.abilityMode==='vanilla-bit31')ivWord&=0x7FFFFFFF;
  else miscWord&=~(3<<29);
  if(dp.abilityMode==='vanilla-bit31')ivWord=(ivWord&0x7FFFFFFF)|((summary.abilitySlot&1)<<31);
  else miscWord=(miscWord&~(3<<29))|((summary.abilitySlot&3)<<29);
  dv.setUint32(m+4,ivWord>>>0,true);dv.setUint32(m+8,miscWord>>>0,true);

  var out=encryptRecord(raw,d);
  var ov=new DataView(out.buffer,out.byteOffset,out.byteLength),padding=ov.getUint16(0x1E,true);
  if(source.features&&source.features.provenance&&sp.provenanceBit!=null)padding&=~(1<<sp.provenanceBit);
  if(source.features&&source.features.shinyOverride&&sp.shinyOverrideBit!=null)padding&=~(1<<sp.shinyOverrideBit);
  if(dest.features&&dest.features.provenance&&dp.provenanceBit!=null)padding|=(1<<dp.provenanceBit);
  ov.setUint16(0x1E,padding,true);
  return out;
}

function compatibilityReport(profile){
  var p=profile||BUILTINS.emerald;
  return {
    id:p.id,name:p.name,confidence:p.confidence||'profile',writeSafe:p.writeSafe!==false&&p.writePolicy!=='readonly',
    boxCount:p.pc.boxCount,pokemonEncoding:p.pokemonEncoding,dexKind:p.dex.kind,
    features:deepClone(p.features||{}),limits:deepClone(p.idLimits||{}),
    readOnlyReason:p.readOnlyReason||''
  };
}

global.EmeraldCompat={
  schemaVersion:1,
  profiles:BUILTINS,
  listProfiles:listProfiles,
  profileForId:profileForId,
  normalizeProfile:normalizeProfile,
  importPack:importPack,
  removeCustomProfile:removeCustomProfile,
  detectProfile:detectProfile,
  mapId:mapId,
  emeraldInternalSpeciesToNational:emeraldInternalSpeciesToNational,
  nationalSpeciesToEmeraldInternal:nationalSpeciesToEmeraldInternal,
  readDexFlags:readDexFlags,
  checksumSize:checksumSize,
  bagPockets:bagPockets,
  validateContentForProfile:validateContentForProfile,
  recordSummary:recordSummary,
  convertPokemonRecord:convertPokemonRecord,
  compatibilityReport:compatibilityReport
};
})(window);
