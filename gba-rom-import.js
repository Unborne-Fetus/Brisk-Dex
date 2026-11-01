(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.BriskRomImporter=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
var MAGIC='BDXROM1!', MAGIC_V2='BDXROM2!', MAX_PACK=24*1024*1024, MAX_SPECIES=4096;
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
  var needle=[112,111,107,101,109,111,110,32,101,109,101,114,97,108,100,32,118,101,114,115,105,111,110],pos=0;
  while((pos=findBytes(b,needle,pos,Math.min(b.length,1024*1024)))>=0){
    var base=pos-8;if(base>=0 && u32(b,base)<=25 && offset(b,u32(b,base+188),8)!=null)return {base:base,version:u32(b,base),name:text(b,pos,32),speciesInfo:offset(b,u32(b,base+188),8),iconPalettes:offset(b,u32(b,base+64),8),icons:offset(b,u32(b,base+56),4),iconPaletteIds:offset(b,u32(b,base+60),1),speciesNames:offset(b,u32(b,base+68),1),moveNames:offset(b,u32(b,base+72),1),pokedexCount:u32(b,base+112),nameLength:b[base+118]||10};pos++;
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
      entry.stats={hp:hp,attack:atk,defense:def,spAttack:spa,spDefense:spd,speed:spe};
      entry.bst=hp+atk+def+spe+spa+spd;
    }
    out[String(i)]=entry;
  }
  if(Object.keys(out).length<10)warnings.push('Species table was not readable at the detected layout.');
  return out;
}
function extractNames(b,base,step,count){var out={};if(base==null||step<2||step>64)return out;for(var i=1;i<Math.min(count,MAX_SPECIES);i++){var s=gbaString(b,base+i*step,step);if(s&&s.length>1)out[String(i)]=s;}return out;}
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
  var icon=asOffset(b,iconPtr,512),pal=asOffset(b,palettePtr,32);
  if(icon==null||pal==null)return null;
  var tiles=b.subarray(icon,icon+512),palette=b.subarray(pal,pal+32);
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
function basicDetails(b){
  if(b.length<0xC0||b[0xB2]!==0x96)throw new Error('This is not a recognizable Game Boy Advance ROM (invalid header).');
  return {title:text(b,0xA0,12),gameCode:text(b,0xAC,4),maker:text(b,0xB0,2),size:b.length,version:b[0xBC]};
}
function normalizedManifest(manifest){
  var d=manifest.data||{},o={};
  ['species','moves','items','abilities','itemDetails','moveDetails','abilityDetails','movePP'].forEach(function(k){if(d[k]&&typeof d[k]==='object'&&!Array.isArray(d[k]))o[k]=d[k];});
  ['routeEncounters','trainerTeams','changes'].forEach(function(k){if(Array.isArray(d[k]))o[k]=d[k];});
  return o;
}
function importRom(value,options){
  var b=bytesOf(value),details=basicDetails(b),warnings=[],header=scanHeader(b),rhh=scanRhh(b);
  var embedded=(options&&options.manifest)||parseEmbedded(b),layout=(options&&options.layout)||(embedded&&embedded.layout)||{};
  var data=embedded?normalizedManifest(embedded):{},source=embedded?'embedded-manifest':'rom-tables';
  var speciesLayout=layout.speciesInfo||null,count=Number(layout.speciesCount)||(rhh&&rhh.species)||(header&&header.pokedexCount+1)||387;
  if(!data.species){
    if(!speciesLayout&&header&&header.speciesInfo!=null){
      var candidate=findSpeciesLayout(b,header.speciesInfo,count);
      if(candidate)speciesLayout=Object.assign({base:header.speciesInfo},candidate);
    }
    if(speciesLayout)data.species=extractSpecies(b,speciesLayout,count,count,warnings);
    if((!data.species||!Object.keys(data.species).length)&&header&&header.speciesNames!=null){
      var step=(header.nameLength||10)+1;data.species={};
      var names=extractNames(b,header.speciesNames,step,Math.min(count,600));
      Object.keys(names).forEach(function(k){data.species[k]={name:names[k],constant:'SPECIES_ROM_'+k,romSpeciesId:Number(k)};});
    }
  }
  if(!data.moves&&header&&header.moveNames!=null){data.moves=extractNames(b,header.moveNames,13,Math.min((rhh&&rhh.moves)||355,2048));}
  var icons={};
  if(data.species&&Object.keys(data.species).length){
    icons=collectIcons(b,header, Object.assign({},layout,{speciesInfo:speciesLayout||layout.speciesInfo}),data.species,MAX_SPECIES,warnings);
  }
  if(!Array.isArray(data.trainerTeams))warnings.push('Trainer teams are not indexed in this ROM; a validated ROM metadata manifest is required for complete trainer data.');
  if(!Array.isArray(data.routeEncounters))warnings.push('Map/route encounter tables are not indexed in this ROM; a validated ROM metadata manifest is required for complete locations.');
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
  var counts={species:Object.keys(data.species||{}).length,icons:new Set(Object.keys(icons).concat(Object.keys(urls))).size,trainers:(data.trainerTeams||[]).length,routes:(data.routeEncounters||[]).length,moves:Object.keys(data.moves||{}).length,items:Object.keys(data.items||{}).length,abilities:Object.keys(data.abilities||{}).length};
  return {details:details,header:header,rhh:rhh,data:data,icons:icons,iconUrls:urls,shinyIconUrls:shinyUrls,counts:counts,source:source,warnings:warnings,complete:!!embedded&&counts.species>0&&counts.trainers>0&&counts.routes>0};
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
  if(typeof DecompressionStream!=='undefined'){
    var stream=new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate'));
    inflated=new Uint8Array(await new Response(stream).arrayBuffer());
  }else if(typeof require==='function'){
    inflated=bytesOf(require('zlib').inflateSync(Buffer.from(packed)));
  }else throw new Error('This device cannot decode compressed ROM indexes.');
  if(inflated.length>MAX_PACK)throw new Error('ROM index exceeds the 12 MB data limit.');
  var raw=typeof TextDecoder!=='undefined'?new TextDecoder('utf-8',{fatal:true}).decode(inflated):Buffer.from(inflated).toString('utf8');
  var manifest=JSON.parse(raw);
  if(!manifest||manifest.format!=='briskdex-rom-v1'||!manifest.data)throw new Error('Invalid compressed ROM index.');
  return importRom(b,Object.assign({},options||{},{manifest:manifest}));
}
return {importRomAsync:importRomAsync,importRom:importRom,readIcon:readIcon,tilesToRgba:tilesToRgba,lz77:lz77,crc32:crc32,gbaString:gbaString,scanHeader:scanHeader,scanRhh:scanRhh,parseEmbedded:parseEmbedded,MAGIC:MAGIC};
});
