(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.BriskRomAudit=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
function count(obj){return obj&&typeof obj==='object'?Object.keys(obj).length:0;}
function keySet(obj){return new Set(Object.keys(obj||{}).map(Number));}
function lines(items){return items.filter(Boolean).join(' · ');}
function coverage(rom){
  var data=rom&&rom.data||{},counts=rom&&rom.counts||{},indexed=rom&&rom.source==='embedded-manifest';
  var byType={};
  function record(id,label,available,total,source,notes){
    byType[id]={label:label,state:indexed&&available?'indexed':available?'partial':'unavailable',
      count:total==null?0:total,source:source||'not identified',notes:notes||''};
  }
  var species=count(data.species),items=count(data.items),moves=count(data.moves),abilities=count(data.abilities);
  var trainers=Array.isArray(data.trainerTeams)?data.trainerTeams.length:0,encounters=Array.isArray(data.routeEncounters)?data.routeEncounters.length:0,maps=Array.isArray(data.mapCatalog)?data.mapCatalog.length:0;
  var normalIcons=new Set(Object.keys(rom&&rom.icons||{}).concat(Object.keys(rom&&rom.iconUrls||{}))).size;
  var shinies=count(rom&&rom.shinyIconUrls);
  record('species','Pokémon and Fakémon',species>0,species,indexed?'source-indexed species':'identified ROM species','Base stats and forms depend on the table layout.');
  record('moves','Moves',moves>0,moves,indexed?'source-indexed moves':'ROM move names',indexed?'Move details from source':'Descriptions and effects may be incomplete.');
  record('abilities','Abilities',abilities>0,abilities,indexed?'source-indexed abilities':'ROM ability names','Effects may need the source index.');
  record('items','Items',items>0,items,indexed?'source-indexed items':'ROM item names',indexed?'Item metadata from source':'Pockets, descriptions and availability may be missing.');
  record('wild','Wild encounters',Array.isArray(data.routeEncounters),encounters,indexed?'source-indexed encounters':'validated compiled map groups','Unindexed map names, scripts, probabilities and modified slot structures are not guaranteed.');
  record('maps','All maps and new routes',Array.isArray(data.mapCatalog),maps,indexed?'source-indexed map catalog':'unavailable','Full custom map names and maps without wild encounters require source-matched data.');
  record('trainers','Trainer teams',Array.isArray(data.trainerTeams),trainers,indexed?'source-indexed teams':'unavailable','Dynamic battle teams and difficulty modes may not be statically recoverable.');
  record('icons','Pokémon icons',normalIcons>0,normalIcons,'identified icon tables or indexed artwork','Some custom palettes may be ambiguous.');
  record('shiny','Shiny icon artwork',shinies>0,shinies,indexed?'indexed artwork':'unavailable','Normal palette rendering does not imply shiny art was recovered.');
  // An index with only some graphics is not full sprite coverage.
  if(species>0){
    if(normalIcons<species&&byType.icons.state==='indexed')byType.icons.state='partial';
    if(shinies<species&&byType.shiny.state==='indexed')byType.shiny.state='partial';
  }
  var speciesEntries=Object.values(data.species||{}).filter(function(v){return v&&typeof v==='object';});
  var battleSprites=speciesEntries.filter(function(v){return !!v.frontSprite&&!!v.backSprite;}).length;
  var shinySprites=speciesEntries.filter(function(v){return !!v.frontShinySprite&&!!v.backShinySprite;}).length;
  var cries=speciesEntries.filter(function(v){return !!v.cry;}).length;
  record('battleSprites','Front/back battle sprites',battleSprites>0,battleSprites,indexed?'portable source-indexed artwork':'unavailable',
    'Full coverage requires front and back art for each supported species.');
  record('shinySprites','Shiny battle sprites',shinySprites>0,shinySprites,indexed?'portable source-indexed artwork':'unavailable',
    'Only true shiny artwork is counted, not recolored normal icons.');
  record('cries','Pokémon cries',cries>0,cries,indexed?'portable source-indexed audio':'unavailable',
    'Custom cries must be included in the ROM index.');
  if(species>0&&indexed){
    ['battleSprites','shinySprites','cries'].forEach(function(id){
      if(byType[id].state==='indexed'&&byType[id].count<species)byType[id].state='partial';
    });
  }
  var recovered=Object.values(byType).filter(x=>x.state!=='unavailable').length;
  var fullyIndexed=Object.values(byType).filter(x=>x.state==='indexed').length;
  return {game:(rom&&rom.details&&rom.details.title)||'Unknown ROM',gameCode:(rom&&rom.details&&rom.details.gameCode)||'',
    indexed:indexed,byType:byType,recoveredCategories:recovered,indexedCategories:fullyIndexed,
    notes:(rom&&rom.warnings||[]).slice()};
}
// Remember a user's previously opened ROM/save association. This detects
// accidental cross-hack reloads but is NOT a cryptographic proof that the
// original pair was correct: Emerald save files don't contain a ROM SHA-256.
function saveIdentity(save){
  var t=save&&save.trainer;
  if(!t||!Number.isInteger(Number(t.publicId))||!Number.isInteger(Number(t.secretId))||
      !String(t.name||'').trim())return '';
  var src=String(t.name).normalize('NFKC').trim().toUpperCase()+
    '|'+Number(t.publicId)+'|'+Number(t.secretId);
  var a=2166136261,b=5381;
  for(var i=0;i<src.length;i++){var n=src.charCodeAt(i);a=Math.imul(a^n,16777619)>>>0;b=(Math.imul(b,33)+n)>>>0;}
  return 'briskdex_pair_v1_'+a.toString(16).padStart(8,'0')+b.toString(16).padStart(8,'0');
}
function pairingStatus(rom,save,storage){
  var key=saveIdentity(save),fingerprint=rom&&rom.romFingerprint;
  if(!storage||!key||!/^(sha256:)[0-9a-f]{64}$/i.test(fingerprint||''))
    return {status:'unavailable',reason:'No durable local ROM identity available.'};
  var previous;
  try{previous=storage.getItem(key);}catch(e){return {status:'unavailable',reason:'Local pairing records are not accessible.'};}
  if(!previous)return {status:'new',key:key,romFingerprint:fingerprint};
  if(previous!==fingerprint)return {status:'changed',key:key,romFingerprint:fingerprint,previous:previous,
    reason:'This trainer save was previously opened with a different ROM. Confirm the new game version and reset the association before editing.'};
  return {status:'known',key:key,romFingerprint:fingerprint};
}
function rememberPairing(rom,save,storage){
  var state=pairingStatus(rom,save,storage);
  if(state.status==='new')try{storage.setItem(state.key,state.romFingerprint);}catch(e){}
  return state;
}
function forgetPairing(save,storage){
  var key=saveIdentity(save);
  if(!key||!storage)return false;
  try{storage.removeItem(key);return true;}catch(e){return false;}
}

function inspectSave(rom,save,storage){
  if(!save)return {status:'no-save',writeSafe:false,headline:'No save selected',warnings:[],conflicts:[],checked:0};
  var findings=[],conflicts=[],checked=0;
  var pairing=pairingStatus(rom,save,storage);
  if(pairing.status==='changed')conflicts.push(pairing.reason);
  var complete=!!(rom&&rom.complete),data=rom&&rom.data||{};
  var knownSpecies=keySet(data.species),knownMoves=keySet(data.moves),knownItems=keySet(data.items);
  var members=(save.party||[]).slice();
  (save.boxes||[]).forEach(function(box){(box||[]).forEach(function(mon){members.push(mon);});});
  members.forEach(function(mon){
    if(!mon||mon.empty)return;
    checked++;
    if(mon.checksumValid===false)conflicts.push('Pokémon checksum failed');
    var species=Number(mon.species)||0,rawSpecies=Number(mon.rawSpecies)||0;
    if(species&&complete&&knownSpecies.size&&!knownSpecies.has(species)&&!knownSpecies.has(rawSpecies))
      conflicts.push('Species ID '+species+' is absent from the ROM index');
    // Custom moves and items can have disjoint numeric namespaces. Only
    // reject when the matching complete ROM index proves the ID is absent.
    if(complete&&knownMoves.size&&Array.isArray(mon.moves))mon.moves.forEach(function(move){
      var id=typeof move==='number'?move:Number(move&&move.id)||0;
      if(id>0&&!knownMoves.has(id))conflicts.push('Move ID '+id+' is absent from the ROM index');
    });
    var item=Number(mon.heldItem)||0;
    if(complete&&knownItems.size&&item>0&&!knownItems.has(item)&&!knownItems.has(Number(mon.rawHeldItem)||0))
      conflicts.push('Held item ID '+item+' is absent from the ROM index');
  });
  if(save.profile&&save.profile.confidence==='inferred-rom')
    findings.push('Save layout inferred from ROM header; editing is disabled.');
  if(!complete)findings.push('ROM data is partial; unmatched custom IDs cannot be checked reliably.');
  if(!complete&&save.profile&&save.profile.confidence!=='explicit')findings.push('Automatic save writes are disabled until the game layout is verified or a trusted profile is selected.');
  if(!checked)findings.push('No occupied Pokémon records found to compare.');
  if(pairing.status==='known')findings.push('This save is linked locally to the same ROM fingerprint as a previous session.');
  findings.push('A Gen III save generally lacks a trustworthy hash of its source ROM; matching IDs alone cannot prove exact game identity.');
  var unique=Array.from(new Set(conflicts)).slice(0,12),bad=unique.length>0;
  return {status:bad?'incompatible':checked&&complete?'plausible':'unverified',
    writeSafe:!bad&&!!(save.profile&&save.profile.writeSafe)&&(!!(complete&&checked>0)||!!(save.profile&&save.profile.confidence==='explicit')),
    headline:bad?'Potentially wrong ROM or save profile':checked&&complete?'Structurally consistent, identity unverified':'ROM/save identity unverified',
    checked:checked,conflicts:unique,warnings:findings,pairing:pairing.status,
    profile:save.profile&&save.profile.name||'Unknown save format'};
}
function summary(rom,save){
  var c=coverage(rom),match=inspectSave(rom,save);
  return {coverage:c,match:match,warningCount:c.notes.length+match.conflicts.length};
}
return {coverage:coverage,inspectSave:inspectSave,summary:summary,
  pairingStatus:pairingStatus,rememberPairing:rememberPairing,forgetPairing:forgetPairing,saveIdentity:saveIdentity};
});
