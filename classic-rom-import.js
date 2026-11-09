/* GB/GBC Generation I–II compatibility reader.
 * Recover only independently identifiable cartridge data. A matching
 * source-authored compatibility pack is required for complete arbitrary hacks.
 */
(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.BriskClassicImporter=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
var NINTENDO_LOGO=[
  0xCE,0xED,0x66,0x66,0xCC,0x0D,0x00,0x0B,0x03,0x73,0x00,0x83,
  0x00,0x0C,0x00,0x0D,0x00,0x08,0x11,0x1F,0x88,0x89,0x00,0x0E,
  0xDC,0xCC,0x6E,0xE6,0xDD,0xDD,0xD9,0x99,0xBB,0xBB,0x67,0x63,
  0x6E,0x0E,0xEC,0xCC,0xDD,0xDC,0x99,0x9F,0xBB,0xB9,0x33,0x3E
];
function bytesOf(value){
  if(value instanceof Uint8Array)return value;
  if(value instanceof ArrayBuffer)return new Uint8Array(value);
  if(ArrayBuffer.isView(value))return new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
  throw new Error('Expected a Game Boy ROM.');
}
function charAt(byte){
  if(byte>=0x80&&byte<=0x99)return String.fromCharCode(65+byte-0x80);
  if(byte>=0xA0&&byte<=0xB9)return String.fromCharCode(97+byte-0xA0);
  if(byte>=0xF6&&byte<=0xFF)return String.fromCharCode(48+byte-0xF6);
  var special={0x7F:' ',0xE0:"'",0xE3:'-',0xE6:'?',0xE7:'!',0xE8:'.',0xE9:'&',0xEA:'é',
    0xEB:'→',0xEF:'♂',0xF0:'¥',0xF1:'×',0xF2:'.',0xF3:'/',0xF4:',',0xF5:'♀'};
  return special[byte]||'';
}
function decodeName(b,at,stride){
  if(at<0||at+stride>b.length)return '';
  var out='',ended=false;
  for(var i=0;i<stride;i++){
    var c=b[at+i];
    if(c===0x50||c===0x00){ended=true;break;}
    var letter=charAt(c);
    if(!letter)return '';
    out+=letter;
  }
  if(!out||out.length<2||out.length>10)return '';
  if(!/[A-Za-z]/.test(out))return '';
  return out;
}
function encodeName(s){
  return Array.from(String(s).toUpperCase()).map(function(ch){
    var code=ch.charCodeAt(0);
    return code>=65&&code<=90?code-65+0x80:0x50;
  });
}
function findSequence(b,words,stride){
  var first=encodeName(words[0]),max=b.length-words.length*stride;
  if(max<0)return -1;
  outer:for(var pos=0;pos<=max;pos++){
    if(b[pos]!==first[0])continue;
    for(var i=0;i<words.length;i++){
      var expected=words[i].toUpperCase(),actual=decodeName(b,pos+i*stride,stride);
      if(actual.toUpperCase()!==expected)continue outer;
    }
    return pos;
  }
  return -1;
}
function scanTable(b,stride,wanted,anchors){
  var at=findSequence(b,anchors,stride),method='anchors';
  if(at<0){
    // No fixed English starter names? Validate a long, diverse series of
    // contiguous fixed-width names instead of assigning arbitrary ROM text.
    method='structural';
    var best=-1,bestScore=0,window=48;
    for(var pos=0;pos+window*stride<b.length;pos++){
      if(b[pos]<0x80||b[pos]>0x99||b[pos+stride]<0x80||b[pos+stride]>0x99)continue;
      var a=decodeName(b,pos,stride),c=decodeName(b,pos+stride,stride),
          d=decodeName(b,pos+2*stride,stride);
      if(!a||!c||!d||a===c||c===d)continue;
      var good=0,distinct=new Set(),longNames=0;
      for(var i=0;i<window;i++){
        var n=decodeName(b,pos+i*stride,stride);
        if(n){good++;distinct.add(n);if(n.length>=5)longNames++;}
      }
      if(good>=44&&distinct.size>=40&&longNames>=25){
        var score=distinct.size*2+longNames;
        if(score>bestScore){best=pos;bestScore=score;}
        // Names are not self-describing; prefer indexed/source data over
        // structural guesses, and never claim full table recovery.
      }
    }
    if(best<0)return null;
    at=best;
  }
  var species={},valid=0;
  for(var id=1;id<=wanted&&at+(id*stride)<=b.length;id++){
    var name=decodeName(b,at+(id-1)*stride,stride);
    if(!name)continue;
    species[String(id)]={name:name,constant:'SPECIES_ROM_SLOT_'+id,romSpeciesId:id,
      idScheme:stride===10?'gen1-internal':'gen2-national'};
    valid++;
  }
  // A structural candidate can still be a different ROM name table; require
  // broad coverage and label it a *candidate*, never a complete extraction.
  if(valid<Math.min(30,wanted/3))return null;
  return {species:species,offset:at,stride:stride,method:method,count:valid};
}
function cartridgeHeader(value,filename){
  var b=bytesOf(value);
  if(b.length<0x150||b.length>32*1024*1024)
    throw new Error('GB/GBC cartridge image must be between 336 bytes and 32 MiB.');
  var logoOk=NINTENDO_LOGO.every(function(n,i){return b[0x104+i]===n;});
  var sum=0;
  for(var i=0x134;i<=0x14C;i++)sum=(sum-b[i]-1)&255;
  var checksumOk=sum===b[0x14D];
  if(!logoOk&&!checksumOk)
    throw new Error('Not a recognizable GB/GBC cartridge: header logo and checksum are invalid.');
  var cgb=b[0x143],titleEnd=(cgb===0x80||cgb===0xC0)?0x143:0x144,title='';
  for(var p=0x134;p<titleEnd;p++){
    if(b[p]===0||b[p]===255)break;
    if(b[p]>=32&&b[p]<=126)title+=String.fromCharCode(b[p]);
    else break;
  }
  title=title.trim();
  var upper=title.toUpperCase(),file=String(filename||'').toLowerCase();
  var known2=/\b(CRYSTAL|GOLD|SILVER)\b/.test(upper),
      known1=/\b(RED|BLUE|GREEN|YELLOW)\b/.test(upper);
  var generation=known2?2:known1?1:/\.gbc$/i.test(file)?2:/\.gb$/i.test(file)?1:
    (cgb===0x80||cgb===0xC0)?2:1;
  var confidence=(known1||known2)?'title-confirmed':'inferred-from-cartridge';
  return {title:title||'Untitled Game Boy hack',gameCode:generation===1?'GB':'GBC',
    generation:generation,platform:(cgb===0x80||cgb===0xC0)?'Game Boy Color':'Game Boy',
    cartridgeType:b[0x147],ramSizeCode:b[0x149],cgbFlag:cgb,
    headerChecksumValid:checksumOk,logoValid:logoOk,familyConfidence:confidence,size:b.length};
}
function importRom(value,options){
  var b=bytesOf(value),details=cartridgeHeader(b,options&&options.filename);
  var candidates=[
    {gen:2,stride:11,count:251,words:['BULBASAUR','IVYSAUR','VENUSAUR','CHARMANDER']},
    {gen:1,stride:10,count:190,words:['RHYDON','KANGASKHAN']}
  ];
  // Names at a valid Gen II first-generation starter sequence or Gen I
  // internal-order sequence outweigh an extension-derived family guess.
  candidates.sort(function(a,c){return a.gen===details.generation?-1:c.gen===details.generation?1:0;});
  var table=null;
  for(var k=0;k<candidates.length;k++){
    var found=scanTable(b,candidates[k].stride,candidates[k].count,candidates[k].words);
    if(found&&(found.method==='anchors'||(!table&&candidates[k].gen===details.generation))){
      table=found;details.generation=candidates[k].gen;
      if(found.method==='anchors')details.familyConfidence='table-confirmed';
      break;
    }
  }
  var species=table?table.species:{},notes=[];
  if(table){
    notes.push('Recovered '+table.count+' fixed-width species-name slots at 0x'+table.offset.toString(16)+
      ' using '+table.method+' validation. '+(details.generation===1?'Generation I uses internal species order; these IDs are NOT National Pokédex IDs.':
      'Generation II names ordinarily follow National Dex order; modified tables and ID remapping require a source index.'));
    if(table.method==='structural')notes.push('Species names are structural candidates. Exact ID mapping is not proven by this scan.');
  }else notes.push('Could not validate a compiled Pokémon-name table; provide a source-matched data pack for this hack.');
  notes.push('GB/GBC encounter maps, trainer teams, battle sprites and synthesized cries use game-specific structures; unknown variants are not fabricated.');
  notes.push('Generation I/II saves are not Emerald saves. Their layout and checksum must be independently verified before any editing.');
  if(!details.headerChecksumValid)notes.push('Cartridge header checksum is invalid; the hack may have a modified or unrepaired header.');
  var counts={species:Object.keys(species).length,icons:0,trainers:0,routes:0,maps:0,moves:0,items:0,abilities:0};
  return {details:details,header:{platform:details.platform,generation:details.generation},data:{species:species},
    counts:counts,icons:{},iconUrls:{},shinyIconUrls:{},source:'classic-rom-tables',
    complete:false,warnings:notes,saveSupport:'readonly-unidentified',
    detectedTable:table&&{offset:table.offset,stride:table.stride,method:table.method}};
}
function inspectSave(value,rom){
  var b=bytesOf(value);
  var sizes=[8*1024,16*1024,32*1024,64*1024,128*1024,256*1024];
  var plausible=sizes.indexOf(b.length)>=0;
  return {generation:rom&&rom.details&&rom.details.generation,
    bytes:b.length,status:plausible?'format-unverified':'unrecognized',
    writeSafe:false,reason:plausible?
      'Save size is plausible but ROM/save identity, bank layout, party structure and checksums remain unverified. No editing is permitted.':
      'Save size does not match a standard GB/GBC SRAM size; the save is not editable.'};
}
return {importRom:importRom,cartridgeHeader:cartridgeHeader,inspectSave:inspectSave,
  scanTable:scanTable,decodeName:decodeName};
});