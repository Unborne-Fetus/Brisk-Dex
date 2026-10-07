(function(global){
'use strict';

var PROFILES={
  emerald:{
    id:'emerald',
    name:'Pokémon Emerald / Emerald-based hack',
    family:'emerald',
    brisk:false,
    boxCount:14,
    pokemonEncoding:'vanilla-gen3',
    dex:{kind:'vanilla-emerald',flagBytes:52,ownedOffset:0x28,seenOffset:0x5C},
    features:{tera:false,provenance:false,shinyOverride:false,outfits:false,expandedBoxes:false}
  },
  briskEmerald:{
    id:'brisk-emerald',
    name:'Pokémon Brisk Emerald',
    family:'emerald',
    brisk:true,
    boxCount:20,
    pokemonEncoding:'brisk-expansion',
    dex:{kind:'brisk-expanded',flagBytes:129,seenOffset:0x3598},
    features:{tera:true,provenance:true,shinyOverride:true,outfits:true,expandedBoxes:true}
  }
};

function detectProfile(context){
  context=context||{};
  if(context.override==='emerald') return PROFILES.emerald;
  if(context.override==='brisk-emerald') return PROFILES.briskEmerald;
  // Brisk's fixed 20-box storage extension is intentionally a strong signal.
  // Unknown 14-box Emerald hacks stay on the conservative vanilla profile.
  return context.storageExtensionPresent ? PROFILES.briskEmerald : PROFILES.emerald;
}

function emeraldInternalSpeciesToNational(raw){
  raw=Number(raw)||0;
  if(raw>=1 && raw<=251) return raw;
  if(raw>=252 && raw<=276) return 201; // unused old-Unown IDs: display as Unown
  if(raw>=277 && raw<=411) return raw-25;
  return raw;
}

function nationalSpeciesToEmeraldInternal(id){
  id=Number(id)||0;
  if(id>=1 && id<=251) return id;
  if(id>=252 && id<=386) return id+25;
  return id;
}

function readDexFlags(profile, sections){
  profile=profile||PROFILES.emerald;
  if(profile.dex.kind==='vanilla-emerald'){
    var s0=sections[0];
    if(!s0) return {seen:new Uint8Array(0),caught:new Uint8Array(0)};
    return {
      caught:s0.slice(profile.dex.ownedOffset,profile.dex.ownedOffset+profile.dex.flagBytes),
      seen:s0.slice(profile.dex.seenOffset,profile.dex.seenOffset+profile.dex.flagBytes)
    };
  }
  var parts=[];
  for(var id=1;id<=4;id++){
    if(!sections[id]) return {seen:new Uint8Array(0),caught:new Uint8Array(0)};
    parts.push(sections[id]);
  }
  var total=parts.reduce(function(n,p){return n+p.length;},0);
  var all=new Uint8Array(total),pos=0;
  parts.forEach(function(p){all.set(p,pos);pos+=p.length;});
  var off=profile.dex.seenOffset,n=profile.dex.flagBytes;
  return {seen:all.slice(off,off+n),caught:all.slice(off+n,off+n*2)};
}

global.EmeraldCompat={
  profiles:PROFILES,
  detectProfile:detectProfile,
  emeraldInternalSpeciesToNational:emeraldInternalSpeciesToNational,
  nationalSpeciesToEmeraldInternal:nationalSpeciesToEmeraldInternal,
  readDexFlags:readDexFlags
};
})(window);
