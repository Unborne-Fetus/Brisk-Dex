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
  record('changes','Custom game changes',Array.isArray(data.changes),Array.isArray(data.changes)?data.changes.length:0,indexed?'source-indexed changes':'unavailable','Procedural features cannot be guaranteed by scanning.');
  var recovered=Object.values(byType).filter(x=>x.state!=='unavailable').length;
  var fullyIndexed=Object.values(byType).filter(x=>x.state==='indexed').length;
  return {game:(rom&&rom.details&&rom.details.title)||'Unknown ROM',gameCode:(rom&&rom.details&&rom.details.gameCode)||'',
    indexed:indexed,byType:byType,recoveredCategories:recovered,indexedCategories:fullyIndexed,
    notes:(rom&&rom.warnings||[]).slice()};
}
function inspectSave(rom,save){
  if(!save)return {status:'no-save',writeSafe:false,headline:'No save selected',warnings:[],conflicts:[],checked:0};
  var findings=[],conflicts=[],checked=0;
  var complete=rom&&rom.source==='embedded-manifest',data=rom&&rom.data||{};
  var knownSpecies=keySet(data.species),knownMoves=keySet(data.moves),knownItems=keySet(data.items);
  var members=(save.party||[]).slice();
  (save.boxes||[]).forEach(function(box){(box||[]).forEach(function(mon){members.push(mon);});});
  members.forEach(function(mon){
    if(!mon||mon.empty)return;
    checked++;
    if(mon.checksumValid===false)conflicts.push('Pokémon checksum failed');
    var species=Number(mon.species)||0;
    if(species&&complete&&knownSpecies.size&&!knownSpecies.has(species))
      conflicts.push('Species ID '+species+' is absent from the ROM index');
    // Custom moves and items can have disjoint numeric namespaces. Only
    // reject when the matching complete ROM index proves the ID is absent.
    if(complete&&knownMoves.size&&Array.isArray(mon.moves))mon.moves.forEach(function(move){
      var id=typeof move==='number'?move:Number(move&&move.id)||0;
      if(id>0&&!knownMoves.has(id))conflicts.push('Move ID '+id+' is absent from the ROM index');
    });
    var item=Number(mon.heldItem)||0;
    if(complete&&knownItems.size&&item>0&&!knownItems.has(item))
      conflicts.push('Held item ID '+item+' is absent from the ROM index');
  });
  if(save.profile&&save.profile.confidence==='inferred-rom')
    findings.push('Save layout inferred from ROM header; editing is disabled.');
  if(!complete)findings.push('ROM data is partial; unmatched custom IDs cannot be checked reliably.');
  if(!checked)findings.push('No occupied Pokémon records found to compare.');
  findings.push('A Gen III save generally lacks a trustworthy hash of its source ROM; matching IDs alone cannot prove exact game identity.');
  var unique=Array.from(new Set(conflicts)).slice(0,12),bad=unique.length>0;
  return {status:bad?'incompatible':checked&&complete?'plausible':'unverified',
    writeSafe:!bad&&!!(save.profile&&save.profile.writeSafe),
    headline:bad?'Potentially wrong ROM or save profile':checked&&complete?'Structurally consistent, identity unverified':'ROM/save identity unverified',
    checked:checked,conflicts:unique,warnings:findings,
    profile:save.profile&&save.profile.name||'Unknown save format'};
}
function summary(rom,save){
  var c=coverage(rom),match=inspectSave(rom,save);
  return {coverage:c,match:match,warningCount:c.notes.length+match.conflicts.length};
}
return {coverage:coverage,inspectSave:inspectSave,summary:summary};
});
