(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.BriskRomImporter=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
var MAGIC='BDXROM1!', MAGIC_V2='BDXROM2!', MAX_PACK=48*1024*1024, MAX_SPECIES=4096;
function bytesOf(value){
  if(value instanceof Uint8Array)return value;
  if(value instanceof ArrayBuffer)return new Uint8Array(value);
  if(ArrayBuffer.isView(value))return new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
  throw new Error('Expected GBA file bytes.');
}
function u16(b,o){return o>=0&&o+2<=b.length?b[o]|b[o+1]<<8:null;}
function u32(b,o){return o>=0&&o+4<=b.length?(b[o]|b[o+1]<<8|b[o+2]<<16|b[o+3]<<24)>>>0:null;}
function offset(b,address,min){var v=Number(address)>>>0;return v>=0x08000000&&v-0x08000000+(min||1)<=b.length?v-0x08000000:null;}
function asOffset(b,address,min){if(Number.isInteger(address)&&address>=0&&address+(min||1)<=b.length&&address<0x08000000)return address;return offset(b,address,min);}
function text(b,o,n){if(o==null||o<0||o+n>b.length)return '';var t='';for(var i=0;i<n;i++){var c=b[o+i];if(c===0||c===255)break;if(c>=32&&c<127)t+=String.fromCharCode(c);}return t.trim();}
function crc32(b,start,end){var c=0xFFFFFFFF;for(var i=start;i<end;i++){c^=b[i];for(var j=0;j<8;j++)c=(c>>>1)^((c&1)?0xEDB88320:0);}return (c^0xFFFFFFFF)>>>0;}
var special={0x00:' ',0x01:'À',0x02:'Á',0x03:'Â',0x04:'Ç',0x05:'È',0x06:'É',0x07:'Ê',0x08:'Ë',0x09:'Ì',0x0B:'Î',0x0C:'Ï',0x0D:'Ò',0x0E:'Ó',0x0F:'Ô',0x10:'Œ',0x11:'Ù',0x12:'Ú',0x13:'Û',0x14:'Ñ',0x15:'ß',0x16:'à',0x17:'á',0x19:'ç',0x1A:'è',0x1B:'é',0x1C:'ê',0x1D:'ë',0x1E:'ì',0x20:'î',0x21:'ï',0x22:'ò',0x23:'ó',0x24:'ô',0x25:'œ',0x26:'ù',0x27:'ú',0x28:'û',0x29:'ñ',0x2A:'º',0x2B:'ª',0xAC:'?',0xAB:'!',0xAD:'.',0xAE:'-',0xB8:',',0xB4:"'",0xB5:'♂',0xB6:'♀',0xF0:':'};
function gbaChar(c){if(c>=0xA1&&c<=0xAA)return String.fromCharCode(48+c-0xA1);if(c>=0xBB&&c<=0xD4)return String.fromCharCode(65+c-0xBB);if(c>=0xD5&&c<=0xEE)return String.fromCharCode(97+c-0xD5);return special[c]||'';}
function gbaString(b,o,n){if(o==null||o<0||o+n>b.length)return '';var s='';for(var i=0;i<n;i++){var c=b[o+i];if(c===255)break;s+=gbaChar(c);}return s.trim();}
function encodeGba(s){var out=[];for(var i=0;i<s.length;i++){var c=s.charCodeAt(i);out.push(c>=65&&c<=90?0xBB+c-65:c>=97&&c<=122?0xD5+c-97:c>=48&&c<=57?0xA1+c-48:0);}return out;}
function findBytes(b,pattern,from,to){outer:for(var i=from;i+pattern.length<=to;i++){for(var j=0;j<pattern.length;j++)if(b[i+j]!==pattern[j])continue outer;return i;}return -1;}
function scanHeader(b){
  var needle=[112,111,107,101,109,111,110,32],pos=0;
  while((pos=findBytes(b,needle,pos,Math.min(b.length,1024*1024)))>=0){
    // GFRomHeader is shared by multiple Gen III families. Never search only
    // for Emerald's internal description: it would skip FRLG and Ruby/Sapphire.
    var banner=text(b,pos,32);
    if(!/^pokemon\s+(?:emerald|ruby|sapphire|fire\s?red|leaf\s?green)\s+version/i.test(banner)){pos++;continue;}
    var base=pos-8;
    if(base<0||u32(b,base)>25||offset(b,u32(b,base+188),8)==null){pos++;continue;}
    // This layout follows the public GFRomHeader in pokeemerald-expansion.
    // Older forks use a shortened header; retain conservative fallback
    // pointers only when the current layout's fields are unresolvable.
    var itemNew=offset(b,u32(b,base+200),4),moveNew=offset(b,u32(b,base+204),4);
    var itemLegacy=offset(b,u32(b,base+192),4),moveLegacy=offset(b,u32(b,base+196),4);
    var saveBlock2=u32(b,base+136),saveBlock1=u32(b,base+140);
    var partyCount=u32(b,base+144),partyOffset=u32(b,base+148);
    var hasLayout=saveBlock1>=1024&&saveBlock1<=65536&&saveBlock2>=256&&saveBlock2<=65536&&
      partyCount<3968&&partyOffset<3968&&partyOffset>partyCount&&partyOffset+600<=3968;
    return {
      base:base,version:u32(b,base),name:text(b,pos,32),
      speciesInfo:offset(b,u32(b,base+188),8),
      iconPalettes:offset(b,u32(b,base+64),8),
      icons:offset(b,u32(b,base+56),4),
      iconPaletteIds:offset(b,u32(b,base+60),1),
      speciesNames:offset(b,u32(b,base+68),1),
      moveNames:offset(b,u32(b,base+72),1),
      itemsInfo:itemNew!=null?itemNew:itemLegacy,
      movesInfo:moveNew!=null?moveNew:moveLegacy,
      abilitiesInfo:offset(b,u32(b,base+192),4),
      abilityDescriptions:offset(b,u32(b,base+196),4),
      pokedexCount:u32(b,base+112),nameLength:b[base+118]||10,
      saveLayout:hasLayout?{
        saveBlock1Size:saveBlock1,saveBlock2Size:saveBlock2,
        partyCountOffset:partyCount,partyOffset:partyOffset,
        playerNameOffset:u32(b,base+160),playerGenderOffset:u32(b,base+164),
        trainerIdOffset:u32(b,base+156),pokedexOffset:u32(b,base+88),
        flagsOffset:u32(b,base+80),varsOffset:u32(b,base+84),
        seenOffset:u32(b,base+92),
        bagCounts:[b[base+228],b[base+229],b[base+230],b[base+231],b[base+232]],
        pcItemsOffset:u32(b,base+236)
      }:null
    };
  }
  return null;
}
function scanRhh(b){
  var pat=[82,72,72,69,88,80],pos=0;
  while((pos=findBytes(b,pat,pos,Math.min(b.length,1024*1024)))>=0){
    var species=u16(b,pos+12),moves=u16(b,pos+10);
    if(species>50&&species<=MAX_SPECIES&&moves>100&&moves<4096)return {base:pos,version:[b[pos+6],b[pos+7],b[pos+8]].join('.'),species:species,moves:moves,abilities:u16(b,pos+14),items:u16(b,pos+20),abilitiesPointer:offset(b,u32(b,pos+16),4)};
    pos++;
  }return null;
}
function findTrailer(b){
  var first=Math.max(0,b.length-32*1024*1024),magic1=Array.from(MAGIC).map(function(c){return c.charCodeAt(0);}),magic2=Array.from(MAGIC_V2).map(function(c){return c.charCodeAt(0);});
  for(var i=b.length-8;i>=first;i--){
    if(b[i]!==magic1[0])continue;
    var version=0;
    for(var choice=1;choice<=2;choice++){
      var magic=choice===1?magic1:magic2,ok=true;
      for(var j=1;j<8;j++)if(b[i+j]!==magic[j]){ok=false;break;}
      if(ok){version=choice;break;}
    }
    if(!version)continue;
    var size=u32(b,i-8),checksum=u32(b,i-4),start=i-8-size;
    if(size==null||size<2||size>MAX_PACK||start<0)throw new Error('ROM metadata trailer has invalid size.');
    if(crc32(b,start,i-8)!==checksum)throw new Error('ROM metadata checksum does not match.');
    return {version:version,bytes:b.subarray(start,i-8)};
  }
  return null;
}
function parseManifestBytes(data){
  var raw;
  if(typeof TextDecoder!=='undefined')raw=new TextDecoder('utf-8',{fatal:true}).decode(data);
  else if(typeof Buffer!=='undefined')raw=Buffer.from(data).toString('utf8');
  else throw new Error('No UTF-8 decoder is available.');
  var manifest=JSON.parse(raw);
  if(!manifest||manifest.format!=='briskdex-rom-v1'||!manifest.data||typeof manifest.data!=='object')
    throw new Error('Unsupported embedded ROM data format.');
  return manifest;
}
function parseEmbedded(b){
  var trailer=findTrailer(b);
  if(!trailer)return null;
  if(trailer.version!==1)throw new Error('Compressed ROM index requires asynchronous import.');
  return parseManifestBytes(trailer.bytes);
}
async function parseEmbeddedAsync(b){
  var trailer=findTrailer(b);
  if(!trailer)return null;
  if(trailer.version===1)return parseManifestBytes(trailer.bytes);
  if(typeof DecompressionStream!=='undefined'&&typeof Blob!=='undefined'){
    var stream=new Blob([trailer.bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    var buf=await new Response(stream).arrayBuffer();
    if(buf.byteLength>64*1024*1024)throw new Error('Decompressed ROM index exceeds safety limit.');
    return parseManifestBytes(new Uint8Array(buf));
  }
  if(typeof module==='object'&&module.exports&&typeof require==='function'){
    var z=require('zlib'),decompressed=z.inflateSync(Buffer.from(trailer.bytes),{maxOutputLength:64*1024*1024});
    return parseManifestBytes(decompressed);
  }
  throw new Error('This browser cannot decompress the ROM data index.');
}
function findSpeciesLayout(b,base,count){
  var names=['Bulbasaur','Ivysaur','Venusaur'],variants=names.map(function(x){return [encodeGba(x),encodeGba(x.toUpperCase()),Array.from(x).map(function(c){return c.charCodeAt(0);})];});
  var found=variants.map(function(list){var candidates=[];for(var i=0;i<list.length;i++){var at=0;while((at=findBytes(b,list[i],at,Math.min(b.length,base+8192)))>=0){if(at>=base&&candidates.length<15)candidates.push(at);at+=list[i].length;if(candidates.length>=15)break;}}return candidates;});
  for(var a=0;a<found[0].length;a++)for(var c=0;c<found[1].length;c++){
    var stride=found[1][c]-found[0][a],nameOffset=found[0][a]-base-stride;
    if(stride<96||stride>1024||stride%4!==0||nameOffset<0||nameOffset>=stride)continue;
    if(found[2].indexOf(found[0][a]+2*stride)<0)continue;
    var valid=0;for(var k=1;k<Math.min(count,25);k++){var name=gbaString(b,base+k*stride+nameOffset,14);if(name.length>=3&&/^[A-Za-zÀ-ÿ0-9 .'-]+$/.test(name))valid++;}
    if(valid>=16)return {stride:stride,nameOffset:nameOffset,confidence:'high',sample:valid};
  }return null;
}
// Not every hack preserves the first three Kanto starters. When the public GF
// ROM header supplies a trusted SpeciesInfo pointer, independently score
// candidate compiled structure layouts using name terminators, base stats,
// types, and unique species names rather than assuming Bulbasaur is present.
function inferSpeciesLayoutFromStructure(b,base,count){
  if(base==null||base<0||base>=b.length||count<12)return null;
  var sample=Math.min(24,count-1),candidates=[],maxOffset=192;
  for(var stride=96;stride<=704;stride+=4){
    if(base+sample*stride+16>b.length)continue;
    for(var nameOffset=12;nameOffset<=Math.min(stride-14,maxOffset);nameOffset+=4){
      var valid=0,totalChars=0,names=new Set(),nonPokemon=0;
      for(var id=1;id<=sample;id++){
        var p=base+id*stride;
        var statsOk=true;
        for(var stat=0;stat<6;stat++)if(b[p+stat]===0||b[p+stat]===255){statsOk=false;break;}
        if(!statsOk||b[p+6]>18||b[p+7]>18)continue;
        var raw=p+nameOffset,length=0,unknown=0,terminated=false;
        for(var j=0;j<14;j++){
          var c=b[raw+j];
          if(c===0xFF){terminated=true;break;}
          if(c===0||(!gbaChar(c)&&c!==0x00)){unknown++;break;}
          length++;
        }
        if(!terminated||unknown||length<3||length>13)continue;
        var nm=gbaString(b,raw,14);
        if(!/^[A-Za-zÀ-ÿ0-9 .'-]{3,13}$/.test(nm))continue;
        valid++;totalChars+=nm.length;names.add(nm.toLowerCase());
        if(nm.indexOf('????')>=0)nonPokemon++;
      }
      // Never trust tiny coincidental runs of decoded text.
      if(valid<Math.max(9,Math.floor(sample*.75))||names.size<Math.floor(valid*.9)||nonPokemon)continue;
      candidates.push({stride:stride,nameOffset:nameOffset,valid:valid,
        score:valid*100+names.size*20+totalChars,confidence:'structure-validated'});
    }
  }
  if(!candidates.length)return null;
  candidates.sort(function(a,b){return b.score-a.score||a.nameOffset-b.nameOffset||a.stride-b.stride;});
  var best=candidates[0];
  // If competing *different strides* appear equally plausible, the ROM
  // header alone isn't enough to identify a safe structure.
  if(candidates.some(function(c){return c.stride!==best.stride&&c.score>=best.score-8;}))return null;
  return {stride:best.stride,nameOffset:best.nameOffset,confidence:best.confidence,sample:best.valid};
}

function extractSpecies(b,layout,count,limit,warnings){
  var out={},root=layout.base==null?null:asOffset(b,layout.base,1),stride=Number(layout.stride),nameOffset=Number(layout.nameOffset);
  if(root==null||!Number.isInteger(stride)||stride<12||stride>2048||!Number.isInteger(nameOffset)||nameOffset<0||nameOffset+12>stride)return out;
  var n=Math.min(count||limit||386,limit||count||386,MAX_SPECIES,Math.floor((b.length-root)/stride));
  for(var i=1;i<n;i++){
    var p=root+i*stride,nm=gbaString(b,p+nameOffset,Math.min(14,stride-nameOffset));
    if(!nm||/^\?+$/.test(nm))continue;
    var entry={name:nm,constant:'SPECIES_ROM_'+i,romSpeciesId:i};
    var hp=b[p],atk=b[p+1],def=b[p+2],spe=b[p+3],spa=b[p+4],spd=b[p+5];
    if([hp,atk,def,spe,spa,spd].every(function(x){return x>0&&x<=255;})){
      entry.baseStats=[hp,atk,def,spe,spa,spd];
      entry.bst=hp+atk+def+spe+spa+spd;
    }
    var typeNames=['Normal','Fighting','Flying','Poison','Ground','Rock','Bug','Ghost','Steel','???','Fire','Water','Grass','Electric','Psychic','Ice','Dragon','Dark','Fairy'];
    var type1=typeNames[b[p+6]],type2=typeNames[b[p+7]];
    if(type1&&type1!=='???'&&type2&&type2!=='???')entry.types=type1===type2?[type1]:[type1,type2];
    out[String(i)]=entry;
  }
  if(Object.keys(out).length<10)warnings.push('Species table was not readable at the detected layout.');
  return out;
}
function extractNames(b,base,step,count){var out={};if(base==null||step<2||step>64)return out;for(var i=1;i<Math.min(count,MAX_SPECIES);i++){var s=gbaString(b,base+i*step,step);if(s&&s.length>1)out[String(i)]=s;}return out;}
// Recover named move/item/ability tables when the ROM retains the
// documented Emerald/Expansion pointers. Strides are verified against
// multiple known entries to avoid reading arbitrary code as game data.
function recognizeName(s){return String(s||'').normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');}
function inferPointerTable(b,base,fieldOffset,firstNames,count,minStride,maxStride){
  if(base==null)return null;
  for(var stride=minStride;stride<=maxStride;stride+=4){
    var hits=0,total=0;
    Object.keys(firstNames).forEach(function(key){
      var p=base+stride*Number(key)+fieldOffset;
      if(p+4>b.length)return;
      var nameOff=offset(b,u32(b,p),32);
      if(nameOff==null)return;
      total++;
      if(recognizeName(gbaString(b,nameOff,40))===recognizeName(firstNames[key]))hits++;
    });
    if(hits!==Object.keys(firstNames).length||total!==hits)continue;
    var names={},good=0;
    for(var n=1;n<Math.min(count||350,4096);n++){
      var o=base+stride*n+fieldOffset,ptr=offset(b,u32(b,o),2);
      if(ptr==null)continue;
      var name=gbaString(b,ptr,40);
      if(name.length>=2&&name.length<=30&&/^[A-Za-zÀ-ÿ0-9 .!?'-]+$/.test(name)){
        names[String(n)]=name;
        if(n<25)good++;
      }
    }
    if(good>=12)return {names:names,stride:stride};
  }
  return null;
}
function inferInlineNameTable(b,base,names,count,minStride,maxStride){
  if(base==null)return null;
  for(var stride=minStride;stride<=maxStride;stride+=4){
    var hits=0;
    Object.keys(names).forEach(function(key){
      var name=gbaString(b,base+stride*Number(key),40);
      if(recognizeName(name)===recognizeName(names[key]))hits++;
    });
    if(hits!==Object.keys(names).length)continue;
    var out={},good=0;
    for(var i=1;i<Math.min(count||350,4096);i++){
      var n=gbaString(b,base+stride*i,Math.min(stride,40));
      if(n.length>=2&&/^[A-Za-zÀ-ÿ0-9 .!?'-]+$/.test(n)){out[i]=n;if(i<25)good++;}
    }
    if(good>=12)return {names:out,stride:stride};
  }
  return null;
}
function lz77(b,off,maxBytes){
  if(off==null||b[off]!==0x10||off+4>b.length)return null;
  var length=b[off+1]|(b[off+2]<<8)|(b[off+3]<<16);
  if(length<=0||length>(maxBytes||262144))return null;
  var out=new Uint8Array(length),src=off+4,dst=0;
  while(dst<length){
    if(src>=b.length)return null;var flags=b[src++];
    for(var bit=7;bit>=0&&dst<length;bit--){
      if(!(flags&(1<<bit))){if(src>=b.length)return null;out[dst++]=b[src++];continue;}
      if(src+1>=b.length)return null;
      var x=b[src++],y=b[src++],size=(x>>4)+3,back=((x&15)<<8)+y+1;
      if(back>dst||dst+size>length)return null;
      while(size--)out[dst]=out[dst++-back];
    }
  }return out;
}
function tilesToRgba(tiles,palette,width,height){
  if(!tiles||tiles.length<(width*height/2)||!palette||palette.length<32)return null;
  var pixels=new Uint8ClampedArray(width*height*4),tilesWide=width/8;
  for(var y=0;y<height;y++)for(var x=0;x<width;x++){
    var tile=((y>>3)*tilesWide+(x>>3))*32+((y&7)*4)+((x&7)>>1);
    var val=tiles[tile],c=(x&1)?val>>4:val&15,color=u16(palette,c*2),idx=(y*width+x)*4;
    pixels[idx]=(color&31)*255/31;pixels[idx+1]=((color>>5)&31)*255/31;pixels[idx+2]=((color>>10)&31)*255/31;pixels[idx+3]=c===0?0:255;
  }return pixels;
}
function readIcon(b,iconPtr,palettePtr){
  // Most Emerald icons are raw 4bpp, but expanded graphics packs can use
  // LZ77 for either tiles or the palette.
  var icon=asOffset(b,iconPtr,4),pal=asOffset(b,palettePtr,4);
  if(icon==null||pal==null)return null;
  var packedTiles=b[icon]===0x10?lz77(b,icon,512):null;
  var packedPalette=b[pal]===0x10?lz77(b,pal,32):null;
  var tiles=packedTiles&&packedTiles.length===512?packedTiles:b.subarray(icon,icon+512);
  var palette=packedPalette&&packedPalette.length>=32?packedPalette:b.subarray(pal,pal+32);
  return tilesToRgba(tiles,palette,32,32);
}
function collectIcons(b,header,layout,species,limit,warnings){
  var result={},ids=Object.keys(species),table=layout&&layout.iconTable,base=layout&&layout.speciesInfo&&asOffset(b,layout.speciesInfo.base,1);
  var palBase=header&&header.iconPalettes,ptrOff=layout&&layout.iconPointerOffset;
  if(!Number.isInteger(ptrOff)&&base!=null&&layout.stride&&layout.nameOffset!=null){
    // Check likely pointer fields after the name in species info against several real entries.
    // Do not guess if there is no reliable three-species run.
    var lo=layout.nameOffset+12,hi=Math.min(layout.stride-4,lo+104),best=null;
    for(var f=Math.ceil(lo/4)*4;f<=hi;f+=4){
      var hits=0;
      [1,2,3,4,5].forEach(function(id){
        var entry=base+id*layout.stride+f,p=offset(b,u32(b,entry),512);
        if(p!=null){var nonzero=0;for(var z=0;z<512;z++)if(b[p+z])nonzero++;if(nonzero>128)hits++;}
      });
      if(hits===5){if(best!=null){best=null;break;}best=f;}
    }
    if(best!=null)ptrOff=best;
  }
  if(table==null && !(base!=null&&Number.isInteger(ptrOff)) && !(header&&header.icons!=null))return result;
  var paletteIndexOffset=layout&&layout.iconPaletteIndexOffset;
  for(var ix=0;ix<ids.length&&ix<(limit||MAX_SPECIES);ix++){
    var id=Number(ids[ix]),p=null,index=0;
    if(table!=null){var to=asOffset(b,table,4*(id+1));if(to!=null)p=u32(b,to+id*4);}
    else if(base!=null&&Number.isInteger(ptrOff))p=u32(b,base+id*layout.stride+ptrOff);
    else if(header&&header.icons!=null)p=u32(b,header.icons+id*4);
    if(Number.isInteger(paletteIndexOffset)&&base!=null)index=b[base+id*layout.stride+paletteIndexOffset]&7;
    else if(header&&header.iconPaletteIds!=null)index=b[header.iconPaletteIds+id]&7;
    if(index>5)index=0;
    var palettePtr=layout&&layout.palettePointers&&layout.palettePointers[index];
    if(palettePtr==null&&palBase!=null)palettePtr=u32(b,palBase+index*8);
    var rgba=readIcon(b,p,palettePtr);
    if(rgba)result[id]=rgba;
  }
  if(Object.keys(result).length&&base!=null&&!Number.isInteger(paletteIndexOffset)&&!(header&&header.iconPaletteIds!=null))
    warnings.push('Expansion icon palettes could not be identified per species; preview colors may be inaccurate.');
  return result;
}


// Some expansion forks store four time-of-day encounter sets per map, each
// with five categories (land, water, rock, fishing and hidden). That compiled
// header occupies 84 bytes instead of the vanilla 20-byte map record.
function scanTimedWildEncounters(b,speciesLimit,warnings){
  var limit=Math.min(b.length,32*1024*1024),stride=84,dayNames=['Morning','Day','Evening','Night'];
  var kinds=[
    {key:'land_mons',name:'Walking',counts:[24,12]},
    {key:'water_mons',name:'Surfing',counts:[11,5]},
    {key:'rock_smash_mons',name:'Rock Smash',counts:[5]},
    {key:'fishing_mons',name:'Fishing',counts:[10]},
    {key:'hidden_mons',name:'Hidden',counts:[5,3]}
  ];
  function parseInfo(ptr,counts){
    var info=offset(b,ptr,8);
    if(info==null||b[info]<1||b[info]>100)return null;
    var pointer=u32(b,info+4);
    for(var ci=0;ci<counts.length;ci++){
      var n=counts[ci],slotsAt=offset(b,pointer,n*4);
      if(slotsAt==null)continue;
      var slots=[],good=true;
      for(var j=0;j<n;j++){
        var o=slotsAt+j*4,lo=b[o],hi=b[o+1],mon=u16(b,o+2);
        if(mon==null||mon>speciesLimit||(!mon&&lo===0&&hi===0)) {
          if(mon===0&&lo===0&&hi===0)continue;
          good=false;break;
        }
        if(lo<1||hi>100||hi<lo){good=false;break;}
        if(mon)slots.push({species:mon,minLevel:lo,maxLevel:hi,slot:j+1});
      }
      if(good&&slots.length>=2)return {slots:slots,encounterRate:b[info],slotCount:n};
    }
    return null;
  }
  function rowAt(at){
    if(at+stride>limit||b[at]===255||b[at]>=100||b[at+1]>=240||b[at+2]!==0||b[at+3]!==0)return null;
    var methods=[],pointerCount=0,activeDays=0,seenPointers=new Map();
    for(var day=0;day<4;day++){
      var dayHas=false;
      for(var k=0;k<5;k++){
        var ptr=u32(b,at+4+day*20+k*4);
        if(ptr===0)continue;
        var key=ptr+':'+k;
        var data=seenPointers.has(key)?seenPointers.get(key):parseInfo(ptr,kinds[k].counts);
        if(!data)return null;
        seenPointers.set(key,data);
        pointerCount++;dayHas=true;
        methods.push({
          name:dayNames[day]+' · '+kinds[k].name,
          type:kinds[k].key,encounterRate:data.encounterRate,
          slots:data.slots
        });
      }
      if(dayHas)activeDays++;
    }
    if(pointerCount<2||activeDays<2)return null;
    return {mapGroup:b[at],mapNumber:b[at+1],methods:methods};
  }
  var best=[],bestAt=-1;
  for(var at=0;at+stride*6<=limit;at+=4){
    if(b[at+2]!==0||b[at+3]!==0||b[at]>=100)continue;
    var plausible=false;
    for(var k=0;k<5;k++){var hi=b[at+7+k*4];if(hi===8||hi===9){plausible=true;break;}}
    if(!plausible)continue;
    var first=rowAt(at);if(!first)continue;
    var rows=[],seen=new Set();
    for(var off=at;off+stride<=limit&&rows.length<2048;off+=stride){
      var row=rowAt(off);if(!row)break;
      var key=row.mapGroup+':'+row.mapNumber;
      if(seen.has(key))break;
      seen.add(key);rows.push(row);
    }
    if(rows.length>best.length){best=rows;bestAt=at;}
    if(rows.length>1)at+=stride*(rows.length-1);
  }
  if(best.length<6)return {areas:[],count:0};
  var areas=best.map(function(row){return {
    id:'ROM_MAP_GROUP_'+row.mapGroup+'_MAP_'+row.mapNumber,
    name:'Map group '+row.mapGroup+' · map '+row.mapNumber,
    mapGroup:row.mapGroup,mapNumber:row.mapNumber,
    source:'verified-time-of-day-wild-headers',methods:row.methods
  };});
  warnings.push('Recovered '+areas.length+' multi-time wild-encounter maps (four time periods) at ROM offset 0x'+bestAt.toString(16)+'. All recovered slots are validated, but custom map names, encounters without tables and exact slot chances still require a source-matched index.');
  return {areas:areas,count:areas.length};
}

// Recover the standard compiled Emerald gWildMonHeaders structure when there
// is no source-generated ROM index. This reports map-group/number identity,
// NOT invented route names or unsupported map geometry.
function scanWildEncounters(b,speciesLimit,warnings){
  var kinds=[
    {key:'land_mons',name:'Walking',slots:12},
    {key:'water_mons',name:'Surfing',slots:5},
    {key:'rock_smash_mons',name:'Rock Smash',slots:5},
    {key:'fishing_mons',name:'Fishing',slots:10}
  ];
  var cache=new Map(),limit=Math.min(b.length,32*1024*1024);
  function infoAt(ptr,slotCount){
    var p=offset(b,ptr,8);
    if(p==null)return null;
    var rate=b[p],slotBase=offset(b,u32(b,p+4),slotCount*4);
    if(rate<1||rate>100||slotBase==null)return null;
    var slots=[],good=0,nonzero=0;
    for(var i=0;i<slotCount;i++){
      var o=slotBase+i*4,lo=b[o],hi=b[o+1],species=u16(b,o+2);
      if(lo<1||lo>100||hi<lo||hi>100||species==null||species>speciesLimit)return null;
      if(species!==0){
        nonzero++;
        slots.push({species:species,minLevel:lo,maxLevel:hi,slot:i+1});
      }
      good++;
    }
    return good===slotCount&&nonzero>=2?{encounterRate:rate,slots:slots}:null;
  }
  function rowAt(at){
    if(cache.has(at))return cache.get(at);
    var row=null;
    if(at+20<=limit&&b[at]!==255&&b[at]<100&&b[at+1]<240&&b[at+2]===0&&b[at+3]===0){
      var mapGroup=b[at],mapNumber=b[at+1],valid=true,methods=[];
      for(var k=0;k<4;k++){
        var ptr=u32(b,at+4+k*4);
        if(!ptr)continue;
        var parsed=infoAt(ptr,kinds[k].slots);
        if(!parsed){valid=false;break;}
        methods.push({name:kinds[k].name,type:kinds[k].key,encounterRate:parsed.encounterRate,slots:parsed.slots});
      }
      if(valid&&methods.length)row={mapGroup:mapGroup,mapNumber:mapNumber,methods:methods};
    }
    cache.set(at,row);
    return row;
  }
  var best=[],bestStart=-1,verifiedRuns=[];
  // Quickly prefilter aligned structs. For each promising row, require a long
  // consecutive run of independently validated wild-mon pointers and slots.
  for(var at=0;at+160<=limit;at+=4){
    if(b[at+2]!==0||b[at+3]!==0||b[at]===255||b[at]>90)continue;
    var ptrBits=b[at+7],ptr2=b[at+11],ptr3=b[at+15],ptr4=b[at+19];
    if(ptrBits!==8&&ptrBits!==9&&ptr2!==8&&ptr2!==9&&ptr3!==8&&ptr3!==9&&ptr4!==8&&ptr4!==9)continue;
    var first=rowAt(at);if(!first)continue;
    var rows=[],keys=new Set();
    for(var next=at;next+20<=limit&&rows.length<2048;next+=20){
      var row=rowAt(next);
      if(!row)break;
      var key=row.mapGroup+':'+row.mapNumber;
      if(keys.has(key))break;
      keys.add(key);rows.push(row);
    }
    if(rows.length>best.length){best=rows;bestStart=at;}
    if(rows.length>=6)verifiedRuns.push({start:at,rows:rows});
    if(rows.length>1)at+=20*(rows.length-1);
  }
  // A handful of plausible structs can occur by coincidence; avoid claiming
  // real encounters until enough independent map records agree.
  if(best.length<6)return scanTimedWildEncounters(b,speciesLimit,warnings);
  // Hacks may append additional encounter-header runs for added regions or
  // difficulty modes. The former longest-run-only scan missed those maps.
  // Deduplicate by the actual compiled map group/number, not a guessed name.
  verifiedRuns.sort(function(a,b){return b.rows.length-a.rows.length;});
  var merged=[],seenMaps=new Set();
  verifiedRuns.forEach(function(run){
    run.rows.forEach(function(row){
      var key=row.mapGroup+':'+row.mapNumber;
      if(!seenMaps.has(key)&&merged.length<2048){seenMaps.add(key);merged.push(row);}
    });
  });
  var areas=merged.map(function(row){
    return {
      id:'ROM_MAP_GROUP_'+row.mapGroup+'_MAP_'+row.mapNumber,
      name:'Map group '+row.mapGroup+' · map '+row.mapNumber,
      mapGroup:row.mapGroup,mapNumber:row.mapNumber,
      source:'verified-emerald-wild-headers',
      methods:row.methods
    };
  });
  warnings.push('Recovered '+areas.length+' compiled wild-encounter maps across '+verifiedRuns.length+' validated table run(s), first at ROM offset 0x'+bestStart.toString(16)+'. These have verified species and levels but only map group/number IDs; route names, custom slot counts and maps with no wild encounters require a source-matched ROM index.');
  warnings.push('Unindexed wild encounter slot percentages are unknown and intentionally not estimated.');
  return {areas:areas,count:areas.length};
}

function basicDetails(b){
  if(b.length<0xC0||b[0xB2]!==0x96)throw new Error('This is not a recognizable Game Boy Advance ROM (invalid header).');
  var code=text(b,0xAC,4).toUpperCase(),family=/^BPR/.test(code)?'firered':
    /^BPG/.test(code)?'leafgreen':/^AXV/.test(code)?'ruby':
    /^AXP/.test(code)?'sapphire':/^BPE/.test(code)?'emerald':'unknown-gen3';
  return {title:text(b,0xA0,12),gameCode:text(b,0xAC,4),maker:text(b,0xB0,2),
    size:b.length,version:b[0xBC],generation:3,platform:'Game Boy Advance',gameFamily:family};
}
function cleanIndexedArt(data){
  var fields=['frontSprite','backSprite','frontShinySprite','backShinySprite',
    'frontAnimation','backAnimation','frontShinyAnimation','backShinyAnimation','cry'];
  if(!data||!data.species||typeof data.species!=='object')return;
  Object.keys(data.species).forEach(function(id){
    var entry=data.species[id];
    if(!entry||typeof entry!=='object')return;
    fields.forEach(function(field){
      var value=entry[field];
      if(value==null)return;
      if(typeof value!=='string'||value.length>1500000||
        !/^data:(?:image\/(?:png|gif)|audio\/(?:wav|ogg|mpeg|aiff));base64,[A-Za-z0-9+/=]+$/i.test(value))
        delete entry[field];
    });
  });
}

function normalizedManifest(manifest){
  var d=manifest.data||{},o={};
  ['species','moves','items','abilities','itemDetails','moveDetails','abilityDetails','movePP'].forEach(function(k){if(d[k]&&typeof d[k]==='object'&&!Array.isArray(d[k]))o[k]=d[k];});
  ['routeEncounters','trainerTeams','changes','mapCatalog'].forEach(function(k){if(Array.isArray(d[k]))o[k]=d[k];});
  if(Number.isInteger(d.shinyOdds)&&d.shinyOdds>0)o.shinyOdds=d.shinyOdds;
  cleanIndexedArt(o);
  return o;
}
function importRom(value,options){
  var b=bytesOf(value),details=basicDetails(b),warnings=[],header=scanHeader(b),rhh=scanRhh(b);
  var embedded=(options&&options.manifest)||parseEmbedded(b),layout=(options&&options.layout)||(embedded&&embedded.layout)||{};
  var data=embedded?normalizedManifest(embedded):{},source=embedded?'embedded-manifest':'rom-tables';
  var indexedSaveProfile=embedded&&embedded.compatibility&&embedded.compatibility.profile;
  if(!indexedSaveProfile||typeof indexedSaveProfile!=='object'||Array.isArray(indexedSaveProfile))
    indexedSaveProfile=null;
  var speciesLayout=layout.speciesInfo||null,count=Number(layout.speciesCount)||(rhh&&rhh.species)||(header&&header.pokedexCount+1)||387;
  if(!data.species){
    if(!speciesLayout&&header&&header.speciesInfo!=null){
      var candidate=findSpeciesLayout(b,header.speciesInfo,count);
      if(!candidate)candidate=inferSpeciesLayoutFromStructure(b,header.speciesInfo,count);
      if(candidate){
        speciesLayout=Object.assign({base:header.speciesInfo},candidate);
        if(candidate.confidence==='structure-validated')
          warnings.push('Recognized a nonstandard SpeciesInfo structure using '+candidate.sample+' independent species records. Form/evolution details still require a source index.');
      }
    }
    if(speciesLayout)data.species=extractSpecies(b,speciesLayout,count,count,warnings);
    if((!data.species||!Object.keys(data.species).length)&&header&&header.speciesNames!=null){
      var step=(header.nameLength||10)+1;data.species={};
      var names=extractNames(b,header.speciesNames,step,Math.min(count,600));
      Object.keys(names).forEach(function(k){data.species[k]={name:names[k],constant:'SPECIES_ROM_'+k,romSpeciesId:Number(k)};});
    }
  }
  if(!data.moves&&header&&header.moveNames!=null){data.moves=extractNames(b,header.moveNames,13,Math.min((rhh&&rhh.moves)||355,2048));}
  if(!data.moves&&header&&header.movesInfo!=null){
    var foundMoves=inferPointerTable(b,header.movesInfo,0,{1:'Pound',2:'Karate Chop',3:'Double Slap'},(rhh&&rhh.moves)||355,24,256);
    if(foundMoves)data.moves=foundMoves.names;
  }
  if(!data.items&&header&&header.itemsInfo!=null){
    // Vanilla Emerald and pokeemerald-expansion assign different IDs to the
    // core Poké Balls, and some forks move the name pointer within ItemInfo.
    var knownItemOrders=[
      {1:'Master Ball',2:'Ultra Ball',3:'Great Ball'},
      {1:'Poke Ball',2:'Great Ball',3:'Ultra Ball',4:'Master Ball'},
      {1:'Poké Ball',2:'Great Ball',3:'Ultra Ball',4:'Master Ball'},
      // Expansion forks may prepend Strange Ball and other new Poké Balls.
      {2:'Poké Ball',3:'Great Ball',4:'Ultra Ball',5:'Master Ball'},
      {3:'Poké Ball',4:'Great Ball',5:'Ultra Ball',6:'Master Ball'},
      {4:'Poké Ball',5:'Great Ball',6:'Ultra Ball',7:'Master Ball'}
    ];
    var foundItems=null;
    outerItems:for(var f=0;f<=40;f+=4){
      for(var order=0;order<knownItemOrders.length;order++){
        var candidate=inferPointerTable(b,header.itemsInfo,f,knownItemOrders[order],(rhh&&rhh.items)||380,32,192);
        if(candidate){foundItems=candidate;break outerItems;}
      }
    }
    if(foundItems)data.items=foundItems.names;
  }
  if(!data.abilities&&((rhh&&rhh.abilitiesPointer!=null)||(header&&header.abilitiesInfo!=null))){
    var abilityAnchors={1:'Stench',2:'Drizzle',3:'Speed Boost'},abilityBase=(rhh&&rhh.abilitiesPointer!=null)?rhh.abilitiesPointer:header.abilitiesInfo;
    var foundAbilities=inferInlineNameTable(b,abilityBase,abilityAnchors,(rhh&&rhh.abilities)||80,20,96);
    if(!foundAbilities)for(var af=0;af<=24&&!foundAbilities;af+=4)
      foundAbilities=inferPointerTable(b,abilityBase,af,abilityAnchors,(rhh&&rhh.abilities)||80,20,128);
    if(foundAbilities)data.abilities=foundAbilities.names;
  }
  var icons={};
  if(data.species&&Object.keys(data.species).length){
    icons=collectIcons(b,header, Object.assign({},layout,{speciesInfo:speciesLayout||layout.speciesInfo}),data.species,MAX_SPECIES,warnings);
  }
  if(!Array.isArray(data.routeEncounters)){
    var wildScan=scanWildEncounters(b,Math.max(386,Math.min(MAX_SPECIES,count)),warnings);
    if(wildScan.areas.length)data.routeEncounters=wildScan.areas;
  }
  if(!Array.isArray(data.trainerTeams))warnings.push('Trainer teams are not indexed in this ROM; a validated ROM metadata manifest is required for complete trainer data.');
  if(!Array.isArray(data.routeEncounters))warnings.push('Unable to identify a reliable compiled wild-encounter table; complete routes and maps require a source-matched ROM metadata index.');
  if(!header)warnings.push('The standard Emerald GF ROM header was not located.');
  if(!rhh)warnings.push('Expansion metadata (RHHEXP) was not located; species limits may be incomplete.');
  var urls={},shinyUrls={};
  if(embedded&&embedded.assets){
    ['icons','shinyIcons'].forEach(function(k){
      var raw=embedded.assets[k],target=k==='icons'?urls:shinyUrls;
      if(!raw||typeof raw!=='object')return;
      Object.keys(raw).forEach(function(id){
        if(!/^\d{1,5}$/.test(id))return;
        var value=raw[id];
        if(typeof value==='string'&&value.length<100000&&/^data:image\/png;base64,[a-z0-9+/=]+$/i.test(value))target[id]=value;
      });
    });
  }
  var counts={species:Object.keys(data.species||{}).length,icons:new Set(Object.keys(icons).concat(Object.keys(urls))).size,trainers:(data.trainerTeams||[]).length,routes:(data.routeEncounters||[]).length,maps:(data.mapCatalog||[]).length,moves:Object.keys(data.moves||{}).length,items:Object.keys(data.items||{}).length,abilities:Object.keys(data.abilities||{}).length};
  var requiredObjects=['species','moves','abilities','items','itemDetails','moveDetails','abilityDetails'];
  var requiredArrays=['routeEncounters','trainerTeams','mapCatalog'];
  var missingIndexFields=embedded?requiredObjects.filter(function(k){return !data[k]||!Object.keys(data[k]).length;})
    .concat(requiredArrays.filter(function(k){return !Array.isArray(data[k]);})):[];
  var isComplete=!!embedded&&!missingIndexFields.length;
  if(embedded&&missingIndexFields.length)
    warnings.push('This ROM has an incomplete reference index: '+missingIndexFields.join(', ')+'. Missing fields are not verified.');
  return {details:details,header:header,rhh:rhh,data:data,icons:icons,iconUrls:urls,shinyIconUrls:shinyUrls,counts:counts,source:source,warnings:warnings,complete:isComplete,missingIndexFields:missingIndexFields,saveProfile:indexedSaveProfile};
}
// A CRC verifies transport integrity. A SHA-256 digest additionally binds the
// source-exported metadata to the exact live compiled ROM that was indexed.
// WebCrypto is unavailable in some Android WebViews and file:// contexts.
// This constant-memory implementation verifies indexed ROM fingerprints
// locally rather than silently skipping the identity check.
function portableSha256(source){
  source=bytesOf(source);
  var K=[
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ],H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  var W=new Uint32Array(64),n=source.length,padded=Math.ceil((n+9)/64)*64;
  var lenBits=n*8,hi=Math.floor(lenBits/0x100000000)>>>0,lo=lenBits>>>0;
  function getByte(i){
    if(i<n)return source[i];
    if(i===n)return 128;
    if(i>=padded-8){
      var q=i-(padded-8);
      return q<4?(hi>>>(24-q*8))&255:(lo>>>(24-(q-4)*8))&255;
    }
    return 0;
  }
  for(var block=0;block<padded;block+=64){
    for(var i=0;i<16;i++){
      var p=block+i*4;
      W[i]=((getByte(p)<<24)|(getByte(p+1)<<16)|(getByte(p+2)<<8)|getByte(p+3))>>>0;
    }
    for(var j=16;j<64;j++){
      var v=W[j-15],u=W[j-2];
      var s0=(v>>>7|v<<25)^(v>>>18|v<<14)^(v>>>3);
      var s1=(u>>>17|u<<15)^(u>>>19|u<<13)^(u>>>10);
      W[j]=(W[j-16]+s0+W[j-7]+s1)>>>0;
    }
    var a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
    for(var t=0;t<64;t++){
      var S1=(e>>>6|e<<26)^(e>>>11|e<<21)^(e>>>25|e<<7);
      var ch=(e&f)^(~e&g);
      var temp1=(h+S1+ch+K[t]+W[t])>>>0;
      var S0=(a>>>2|a<<30)^(a>>>13|a<<19)^(a>>>22|a<<10);
      var maj=(a&b)^(a&c)^(b&c);
      var temp2=(S0+maj)>>>0;
      h=g;g=f;f=e;e=(d+temp1)>>>0;d=c;c=b;b=a;a=(temp1+temp2)>>>0;
    }
    H[0]=(H[0]+a)>>>0;H[1]=(H[1]+b)>>>0;H[2]=(H[2]+c)>>>0;H[3]=(H[3]+d)>>>0;
    H[4]=(H[4]+e)>>>0;H[5]=(H[5]+f)>>>0;H[6]=(H[6]+g)>>>0;H[7]=(H[7]+h)>>>0;
  }
  return H.map(function(v){return v.toString(16).padStart(8,'0');}).join('');
}

async function sha256Hex(bytes){
  var source=bytesOf(bytes),cryptoApi=typeof globalThis!=='undefined'?globalThis.crypto:null;
  if(cryptoApi&&cryptoApi.subtle&&cryptoApi.subtle.digest){
    var digest=new Uint8Array(await cryptoApi.subtle.digest('SHA-256',source));
    return Array.from(digest).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
  }
  if(typeof require==='function'&&typeof Buffer!=='undefined'){
    return require('crypto').createHash('sha256').update(Buffer.from(source)).digest('hex');
  }
  return portableSha256(source);
}
async function verifyIndexedSource(b,manifest){
  var fp=manifest&&manifest.meta&&manifest.meta.sourceFingerprint;
  if(!fp)return {status:'legacy',reason:'This indexed ROM does not include a source fingerprint; the metadata cannot be bound to the game binary.'};
  if(fp.algorithm!=='sha256'||!Number.isInteger(fp.liveRomLength)||fp.liveRomLength<0xC0||
    fp.liveRomLength>b.length||!/^[0-9a-f]{64}$/i.test(fp.sha256||''))
    throw new Error('The indexed ROM has an invalid source fingerprint.');
  var observed=await sha256Hex(b.subarray(0,fp.liveRomLength));
  if(!observed)return {status:'unsupported',reason:'SHA-256 is not available on this device, so ROM/index identity remains unverified.'};
  if(observed.toLowerCase()!==fp.sha256.toLowerCase())
    throw new Error('The indexed reference data belongs to a different ROM build (source SHA-256 mismatch).');
  return {status:'verified',sha256:observed,liveRomLength:fp.liveRomLength};
}

async function importRomAsync(value,options){
  var b=bytesOf(value),pat=[66,68,88,82,79,77,90,33],found=-1;
  for(var i=b.length-pat.length;i>=Math.max(0,b.length-16*1024*1024);i--){
    var yes=true;for(var j=0;j<pat.length;j++)if(b[i+j]!==pat[j]){yes=false;break;}
    if(yes){found=i;break;}
  }
  if(found<0)return importRom(b,options);
  basicDetails(b);
  var size=u32(b,found-8),expected=u32(b,found-4),start=found-8-size;
  if(!size||size>MAX_PACK||start<0)throw new Error('Compressed ROM index has an invalid size.');
  if(crc32(b,start,found-8)!==expected)throw new Error('Compressed ROM index has a checksum mismatch.');
  var packed=b.slice(start,found-8),inflated;
  if(typeof DecompressionStream!=='undefined'&&typeof Blob!=='undefined'){
    var stream=new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate'));
    var reader=stream.getReader(),chunks=[],total=0;
    while(true){
      var part=await reader.read();
      if(part.done)break;
      total+=part.value.byteLength;
      if(total>MAX_PACK){
        await reader.cancel();
        throw new Error('ROM index exceeds the 48 MiB decoded-data limit.');
      }
      chunks.push(part.value);
    }
    inflated=new Uint8Array(total);
    var position=0;
    chunks.forEach(function(chunk){inflated.set(chunk,position);position+=chunk.byteLength;});
  }else if(typeof require==='function'){
    inflated=bytesOf(require('zlib').inflateSync(Buffer.from(packed),{maxOutputLength:MAX_PACK}));
  }else throw new Error('This device cannot decode compressed ROM indexes.');
  if(inflated.length>MAX_PACK)throw new Error('ROM index exceeds the 48 MiB decoded-data limit.');
  var raw=typeof TextDecoder!=='undefined'?new TextDecoder('utf-8',{fatal:true}).decode(inflated):Buffer.from(inflated).toString('utf8');
  var manifest=JSON.parse(raw);
  if(!manifest||manifest.format!=='briskdex-rom-v1'||!manifest.data)throw new Error('Invalid compressed ROM index.');
  var integrity=await verifyIndexedSource(b,manifest);
  var imported=importRom(b,Object.assign({},options||{},{manifest:manifest}));
  imported.integrity=integrity;
  if(integrity.status==='verified')imported.romFingerprint='sha256:'+integrity.sha256;
  else imported.warnings.push(integrity.reason||'Indexed ROM source identity could not be verified.');
  return imported;
}
return {scanTimedWildEncounters:scanTimedWildEncounters,scanWildEncounters:scanWildEncounters,importRomAsync:importRomAsync,verifyIndexedSource:verifyIndexedSource,sha256Hex:sha256Hex,portableSha256:portableSha256,importRom:importRom,readIcon:readIcon,tilesToRgba:tilesToRgba,lz77:lz77,crc32:crc32,gbaString:gbaString,scanHeader:scanHeader,scanRhh:scanRhh,inferSpeciesLayoutFromStructure:inferSpeciesLayoutFromStructure,parseEmbedded:parseEmbedded,MAGIC:MAGIC};
});
