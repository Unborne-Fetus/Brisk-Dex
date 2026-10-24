import {connectedPosition} from './connections.mjs';
import {assert,clone,integer} from './model.mjs';
import {applyFieldEffect,fieldMoveUser} from './traversal.mjs';
import {fieldSpecial,setMetatile,tileAt} from './field-specials.mjs';
// Native script DATA only: no eval, Function constructor or JavaScript imports.
const compiled=new Map();
export function compileScripts(source){
  if(compiled.has(source))return compiled.get(source);
  const labels={};let current=null;
  for(const raw of source.split(/\r?\n/)){
    const line=raw.replace(/\s+@.*$/,'').trim();const label=line.match(/^(\w+)::?$/);if(label){if(current)current.push('goto '+label[1]);current=labels[label[1]]=[];continue;}
    if(current&&line&&!line.startsWith('//')&&!line.startsWith('@'))current.push(line.replace(/\s+\/\/.*$/,''));
  }
  if(compiled.size>=3)compiled.delete(compiled.keys().next().value);compiled.set(source,labels);return labels;
}
const IGNORE=new Set(['lock','lockall','release','releaseall','faceplayer','waitmessage','closemessage','waitbuttonpress','waitfanfare','waitse','waitmovement','nop']);
export class ScriptInputRequired extends Error {
  constructor(key,request){super('Script input required');this.key=key;this.request=request;}
}
export class ScriptBattleLost extends Error{constructor(state){super('Battle lost');this.state=state;}}
export function planScript(campaign,source,entry,decisions=null){
  const labels=compileScripts(source),draft=clone(campaign.snapshot()),messages=[],calls=[];let label=entry,index=0,steps=0,comparison=null,switchValue=null;const buffers={};let movementStart=null,pendingMovements=[],savedParty=null,wildSpec=null;
  const input=request=>{const key=`${label}:${index}:${steps}:${request.kind}`;assert(decisions,'Interactive '+request.kind+' requires a host');if(!decisions.has(key))throw new ScriptInputRequired(key,{...request,state:clone(draft)});return decisions.get(key);};
  const constants={...campaign.catalog.scriptData?.constants,...campaign.catalog.storyData?.maps?.[draft.position.map]?.localIds};
  const localId=token=>{if(token==='LOCALID_PLAYER'||token==='OBJ_EVENT_ID_PLAYER')return 'LOCALID_PLAYER';if(/^VAR_|^(?:0x[0-9a-f]+|[0-9]+)$/i.test(token)){const id=value(token);if(id===255)return 'LOCALID_PLAYER';return Object.entries(campaign.catalog.storyData?.maps?.[draft.position.map]?.localIds||{}).find(([,n])=>n===id)?.[0]||String(id);}return token;};
  const itemIds=new Map(Object.entries(campaign.catalog.data.itemDetails).map(([id,item])=>[item.constant,Number(id)]));
  const value=token=>{token=String(token).trim();if(/^0x[0-9a-f]+$/i.test(token))return parseInt(token,16);if(/^\d+$/.test(token))return Number(token);if(token==='TRUE'||token==='YES')return 1;if(token==='FALSE'||token==='NO')return 0;if(/^0x80[0-9a-f]{2}$/i.test(token))return draft.vars?.['VAR_0x'+token.slice(2).toUpperCase()]||0;if(/^VAR_/.test(token))return draft.vars?.[token]||0;if(Object.hasOwn(constants,token))return constants[token];throw new Error('Unresolved value '+token);};
  const text=target=>{
    assert(labels[target]||campaign.catalog.scriptData?.text?.[target],'Missing text '+target);const lines=labels[target]?labels[target].filter(line=>line.startsWith('.string')):['.string "'+campaign.catalog.scriptData.text[target]+'"'];
    assert(lines.length,'Missing text '+target);
    return lines.map(line=>{const match=line.match(/^\.string\s+"(.*)"$/);assert(match,'Unsupported text');return match[1].replace(/\\[nl]/g,' ').replace(/\\p/g,'\n\n').replace(/\\"/g,'"').replace(/\$/g,'');}).join('').replaceAll('{PLAYER}',draft.trainer.name).replaceAll('{RIVAL}',draft.trainer.gender==='Female'?'Brendan':'May').replace(/\{(STR_VAR_[123])\}/g,(_,key)=>buffers[key]||'');
  };
  // Brisk resized Route 101; its original rescue trigger/movement still targets
  // the old width. Align the player with the surviving rescue corridor.
  if(entry==='Route101_EventScript_StartBirchRescue'&&draft.position.map==='map_route101')draft.position.x=9;
  while(++steps<=4096){
    assert(labels[label],'Unported script '+label);const line=labels[label][index++];assert(line!==undefined,'Script has no ending');const [opcode,...rest]=line.split(/\s+/),args=rest.join(' ').split(',').map(s=>s.trim());if(['setvar','copyvar','addvar','subvar'].includes(opcode)){if(args.length===1&&rest.length===2)args.splice(0,1,...rest);if(/^0x80[0-9a-f]{2}$/i.test(args[0]))args[0]='VAR_0x'+args[0].slice(2).toUpperCase();}
    if(['applymovement','addobject','removeobject','setobjectxy','setobjectxyperm','turnobject','setobjectmovementtype'].includes(opcode))args[0]=localId(args[0]);
    if(opcode==='isfollowerfieldmoveuser'){draft.vars??={};draft.vars[args[0]]=0;continue;}
    if(opcode==='setrespawn'){const point=campaign.catalog.storyData?.healLocations?.[args[0]];assert(point,'Unknown recovery point '+args[0]);draft.respawn=clone(point);continue;}
    if(opcode==='setdynamicwarp'){assert(args.length===3,'Unsupported dynamic warp');draft.dynamicWarp={map:args[0].toLowerCase(),x:value(args[1]),y:value(args[2])};continue;}
    if(opcode==='bufferleadmonspeciesname'){buffers[args[0]]=campaign.catalog.species(draft.party[0].species).name;continue;}
    if(opcode==='getpartysize'){draft.vars??={};draft.vars.VAR_RESULT=draft.party.length;continue;}
    if(opcode==='special'&&args[0]==='InitBirchState'){draft.vars??={};draft.vars.VAR_BIRCH_STATE=0;continue;}
    if(opcode==='special'&&args[0]==='SavePlayerParty'){savedParty=clone(draft.party);continue;}
    if(opcode==='special'&&args[0]==='LoadWallyZigzagoon'){const temporary=new campaign.constructor(campaign.catalog,campaign.pack,draft);draft.party=[temporary.createMon('ZIGZAGOON',7)];draft.rng=temporary.random.state;continue;}
    if(opcode==='special'&&args[0]==='StartWallyTutorialBattle'){input({kind:'tutorial',species:'RALTS',level:5});continue;}
    if(opcode==='special'&&args[0]==='LoadPlayerParty'){assert(savedParty,'No saved party');draft.party=savedParty;savedParty=null;continue;}
    if(opcode==='vsseeker_rematchid')continue;
    if(opcode==='setorcopyvar'){draft.vars??={};draft.vars[args[0]]=value(args[1]);continue;}
    if(opcode==='setwildbattle'){wildSpec={species:args[0].replace(/^SPECIES_/,''),level:value(args[1])};continue;}
    if(opcode==='dowildbattle'||opcode==='special'&&args[0]==='RockSmashWildEncounter'){
      const temporary=new campaign.constructor(campaign.catalog,campaign.pack,draft);let mon;
      if(opcode==='dowildbattle'){assert(wildSpec,'Wild battle not configured');mon=temporary.createMon(wildSpec.species,wildSpec.level);}
      else{const table=temporary.mapInfo.encounters?.rock_smash_mons;draft.vars??={};draft.vars.VAR_RESULT=0;if(!table||temporary.random.next()>=table.rate/100){draft.rng=temporary.random.state;continue;}mon=temporary.chooseEncounter(table.slots.filter(e=>e.species))?.mon;if(!mon)continue;draft.vars.VAR_RESULT=1;}
      draft.rng=temporary.random.state;const result=input({kind:'wild-battle',mon});if(result?.phase==='lost')throw new ScriptBattleLost(result.state);assert(['won','caught','fled'].includes(result?.phase),'Wild battle unfinished');Object.assign(draft,new campaign.constructor(campaign.catalog,campaign.pack,clone(result.state)).snapshot());continue;
    }
    if(opcode==='special'&&args[0]==='GetRivalSonDaughterString'){buffers.STR_VAR_1=draft.trainer.gender==='Female'?'son':'daughter';continue;}
    if(opcode==='special'&&['StartWallClock','Special_ViewWallClock'].includes(args[0])){
      const response=input({kind:'clock',message:'Set the clock in your room.',view:args[0]==='Special_ViewWallClock',clock:draft.clock});if(!response)throw Error('Clock cancelled');draft.clock=response;continue;
    }
    if(opcode==='special'&&args[0]==='StartNewPokeballCaseUI'){
      const starters=campaign.catalog.storyData?.starters||['TREECKO','TORCHIC','MUDKIP'],chosen=input({kind:'starter',starters});assert(starters.includes(chosen),'Invalid starter');const temporary=new campaign.constructor(campaign.catalog,campaign.pack,draft),mon=temporary.createMon(chosen,5);temporary.catchMon(mon);draft.vars??={};draft.vars.VAR_STARTER_MON=['BULBASAUR','TREECKO','SNIVY'].includes(chosen)?0:['CHARMANDER','TORCHIC','CHIMCHAR'].includes(chosen)?1:2;draft.intro=false;temporary.snapshot();continue;
    }
    if(opcode==='special'&&['EnableNationalPokedex','SetUnlockedPokedexFlags'].includes(args[0])){draft.flags.FLAG_SYS_NATIONAL_DEX=true;continue;}
    if(opcode==='special'&&args[0]==='ChangePokemonNickname'){const mon=draft.party[draft.vars?.VAR_0x8004||0];assert(mon,'No Pokémon to nickname');const name=input({kind:'nickname',name:mon.nickname});assert(typeof name==='string'&&name.trim().length&&name.length<=24,'Invalid nickname');mon.nickname=name.trim();continue;}
    if(opcode==='special'&&['TurnOffTVScreen','SetPlayerBedroomDecoration','SetSecretBase2F','InitSecretBaseDecorationSprites'].includes(args[0]))continue;
    if(['setstepcallback','opendoor','closedoor','hideplayer','showplayer','incrementgamestat','setescapewarp'].includes(opcode))continue;
    if(opcode==='waitmovement'){if(pendingMovements.length&&decisions?.present)input({kind:'movement',startState:movementStart,actors:pendingMovements});pendingMovements=[];movementStart=null;continue;}
    if(opcode==='checkfieldmove'){
      const index=fieldMoveUser(campaign.catalog,draft,args[0],args[1]?!!value(args[1]):false);draft.vars??={};draft.vars.VAR_RESULT=index<0?6:index;if(index>=0)draft.vars.VAR_0x8004=draft.party[index].species;continue;
    }
    if(opcode==='bufferpartymonnick'){assert(/^STR_VAR_[123]$/.test(args[0]),'Invalid text buffer');const mon=draft.party[value(args[1])];assert(mon,'Invalid field-move user');buffers[args[0]]=mon.nickname;continue;}
    if(opcode==='setfieldeffectargument')continue;
    if(opcode==='hidefollowernpc'){draft.flags.FLAG_TEMP_HIDE_FOLLOWER=true;continue;}
    if(opcode==='callnative'&&['FollowerNPC_WarpSetEnd','SetFollowerNPCSurfSpriteAfterDive'].includes(args[0])){draft.flags.FLAG_TEMP_HIDE_FOLLOWER=false;continue;}
    if(opcode==='dofieldeffect'&&['FLDEFF_USE_SURF','FLDEFF_USE_DIVE','FLDEFF_USE_WATERFALL','FLDEFF_USE_CUT_ON_TREE','FLDEFF_USE_ROCK_SMASH','FLDEFF_USE_STRENGTH'].includes(args[0])){
      const start=clone(draft),temporary=new campaign.constructor(campaign.catalog,campaign.pack,draft),frames=applyFieldEffect(temporary,args[0]);temporary.snapshot();const user=fieldMoveUser(campaign.catalog,draft,{FLDEFF_USE_CUT_ON_TREE:'FIELD_MOVE_CUT',FLDEFF_USE_ROCK_SMASH:'FIELD_MOVE_ROCK_SMASH',FLDEFF_USE_STRENGTH:'FIELD_MOVE_STRENGTH'}[args[0]]);if(user>=0)buffers.STR_VAR_1=draft.party[user].nickname;if(frames.length&&decisions?.present)input({kind:'movement',startState:start,movementMode:temporary.mode,actors:[{localId:'LOCALID_PLAYER',frames}]});continue;
    }
    if(IGNORE.has(opcode))continue;
    if(['playse','playfanfare','delay','playbgm','fadedefaultbgm','fadescreen','fadescreenspeed','savebgm','fadeoutbgm','fadeinbgm','setbattlebgm','waitstate','nop1','nop2','hidebox','showmoneybox','updatemoneybox','hidemoneybox','waitdooranim','setdooropened','setdoorclosed','setdooropen','setdoorclose','dofieldeffect','waitfieldeffect'].includes(opcode))continue;
    if(opcode==='checkplayergender'){draft.vars??={};draft.vars.VAR_RESULT=draft.trainer.gender==='Female'?1:0;continue;}
    if(opcode==='settrainerflag'||opcode==='cleartrainerflag'){assert(/^TRAINER_\w+$/.test(args[0]),'Invalid trainer');draft.flags[args[0]]=opcode==='settrainerflag';continue;}
    if(opcode==='goto_if_defeated'||opcode==='goto_if_not_defeated'){if(!!draft.flags[args[0]]===(opcode==='goto_if_defeated')){label=args[1];index=0;}continue;}
    if(opcode==='checktrainerflag'){draft.vars??={};draft.vars.VAR_RESULT=draft.flags[args[0]]?1:0;comparison=draft.vars.VAR_RESULT;continue;}
    if(opcode==='bufferspeciesname'||opcode==='bufferitemname'||opcode==='buffermovename'||opcode==='buffernumberstring'){
      assert(/^STR_VAR_[123]$/.test(args[0]),'Invalid text buffer');const id=value(args[1]);buffers[args[0]]=opcode==='bufferspeciesname'?campaign.catalog.species(id).name:opcode==='bufferitemname'?campaign.catalog.data.items[id]:opcode==='buffermovename'?campaign.catalog.move(id).name:String(id);continue;
    }
    if(opcode==='setmetatile'){setMetatile(draft,campaign.pack.maps[draft.position.map],value(args[0]),value(args[1]),value(args[2]),value(args[3]));continue;}
    if(opcode==='special'&&fieldSpecial(args[0],draft,campaign.pack.maps[draft.position.map],constants))continue;
    if(opcode==='setflashlevel'||opcode==='animateflash'){draft.flashLevel=value(args[0]);continue;}
    if(opcode==='setobjectmovementtype'||opcode==='turnobject'){
      if(args[0]==='LOCALID_PLAYER'){draft.vars??={};draft.vars.VAR_FACING=value(args[1]);continue;}
      const map=campaign.pack.maps[draft.position.map];assert(map.events.some(e=>e.localId===args[0]),'Unknown object '+args[0]);draft.objects??={};draft.objects[map.id]??={};const obj=draft.objects[map.id][args[0]]??={};obj.movementType=opcode==='turnobject'?'MOVEMENT_TYPE_FACE_'+({1:'DOWN',2:'UP',3:'LEFT',4:'RIGHT'}[value(args[1])]):args[1];continue;
    }
    if(opcode==='register_matchcall'){draft.flags['REGISTERED_'+args[0]]=true;continue;}
    if(opcode==='specialvar'){
      draft.vars??={};assert(/^VAR_\w+$/.test(args[0]),'Invalid special result');const name=args[1];
      if(name==='TryUpdateRusturfTunnelState'){draft.vars[args[0]]=0;if(draft.position.map==='map_rusturf_tunnel'&&!draft.flags.FLAG_RUSTURF_TUNNEL_OPENED){if(draft.flags.FLAG_HIDE_RUSTURF_TUNNEL_ROCK_1){draft.vars.VAR_RUSTURF_TUNNEL_STATE=4;draft.vars[args[0]]=1;}else if(draft.flags.FLAG_HIDE_RUSTURF_TUNNEL_ROCK_2){draft.vars.VAR_RUSTURF_TUNNEL_STATE=5;draft.vars[args[0]]=1;}}}
      else if(name==='ShouldTryRematchBattle'||name==='IsTrainerReadyForRematch')draft.vars[args[0]]=0;
      else if(name==='IsTrainerRegistered'){const id=Object.entries(constants).find(([key,id])=>key.startsWith('TRAINER_')&&id===value('VAR_0x8004'))?.[0];draft.vars[args[0]]=draft.flags['REGISTERED_'+id]?1:0;}
      else throw new Error('Unported special '+name);continue;
    }
    if(opcode==='special'&&['PlayerFaceTrainerAfterBattle','DrawWholeMapView','UpdateTrainerFanClubGameClear','BufferRivalName'].includes(args[0]))continue;
    if(opcode==='end')return {state:draft,messages,steps};
    if(opcode==='return'){if(!calls.length)return {state:draft,messages,steps};[label,index]=calls.pop();continue;}
    if(opcode==='goto'||opcode==='call'){if(opcode==='call')calls.push([label,index]);label=args[0];index=0;continue;}
    if(opcode==='goto_if_set'||opcode==='goto_if_unset'){const set=!!draft.flags[args[0]];if(set===(opcode==='goto_if_set')){label=args[1];index=0;}continue;}
    if(opcode==='setflag'||opcode==='clearflag'){assert(/^FLAG_\w+$/.test(args[0]),'Invalid flag');draft.flags[args[0]]=opcode==='setflag';continue;}
    if(['setvar','addvar','subvar','copyvar'].includes(opcode)){
      assert(/^VAR_\w+$/.test(args[0]),'Invalid variable');draft.vars??={};const v=value(args[1]),old=draft.vars[args[0]]||0;draft.vars[args[0]]=opcode==='addvar'?old+v:opcode==='subvar'?old-v:v;integer(draft.vars[args[0]],0,65535,'script variable');continue;
    }
    if(opcode==='checkflag'){draft.vars??={};draft.vars.VAR_RESULT=draft.flags[args[0]]?1:0;comparison=draft.vars.VAR_RESULT;continue;}
    if(opcode==='switch'){switchValue=value(args[0]);continue;}
    if(opcode==='case'){assert(switchValue!==null,'Switch missing');if(switchValue===value(args[0])){label=args[1];index=0;}continue;}
    if(opcode==='goto_if'){assert(comparison!==null,'Comparison missing');const yes={eq:comparison===0,ne:comparison!==0,lt:comparison<0,gt:comparison>0,le:comparison<=0,ge:comparison>=0}[args[0]];assert(yes!==undefined,'Unsupported condition');if(yes){label=args[1];index=0;}continue;}
    if(opcode==='call_if_set'||opcode==='call_if_unset'){if(!!draft.flags[args[0]]===(opcode==='call_if_set')){calls.push([label,index]);label=args[1];index=0;}continue;}
    if(opcode==='compare'){comparison=value(args[0])-value(args[1]);continue;}
    if(/^(?:goto|call)_if_(?:eq|ne|lt|gt|le|ge)$/.test(opcode)){
      let target;if(args.length===3){comparison=value(args[0])-value(args[1]);target=args[2];}else target=args[0];assert(comparison!==null,'Comparison missing');const condition=opcode.replace(/^call_/,'goto_');const yes={goto_if_eq:comparison===0,goto_if_ne:comparison!==0,goto_if_lt:comparison<0,goto_if_gt:comparison>0,goto_if_le:comparison<=0,goto_if_ge:comparison>=0}[condition];if(yes){if(opcode.startsWith('call_'))calls.push([label,index]);label=target;index=0;}continue;
    }
    if(opcode==='msgbox'||opcode==='message'){
      const message=text(args[0]);
      if(args.includes('MSGBOX_YESNO')){const key=`${label}:${index}:${steps}`;assert(decisions,'A choice is required; this event is not ported');if(!decisions.has(key))throw new ScriptInputRequired(key,{kind:'yesno',message});const answer=decisions.get(key);assert(answer===0||answer===1,'Invalid choice');draft.vars??={};draft.vars.VAR_RESULT=answer;}
      else{messages.push(message);if(decisions?.present)input({kind:'message',message});}continue;
    }
    if(/^trainerbattle_(?:single|double|rematch|rematch_double|no_intro)$/.test(opcode)){
      const trainer=args[0],rematch=opcode.includes('rematch'),double=opcode.includes('double'),noIntro=opcode==='trainerbattle_no_intro';
      if(draft.flags[trainer]&&!rematch)continue;
      const team=campaign.catalog.scriptData?.trainers?.[trainer];assert(team?.party?.length,'Missing trainer '+trainer);
      const result=input({kind:'battle',trainer,team,format:double?'doubles':'singles',intro:!noIntro&&args[1]?text(args[1]):'',defeat:args[noIntro?1:2]?text(args[noIntro?1:2]):''});
      if(result?.phase==='lost')throw new ScriptBattleLost(result.state);assert(result?.phase==='won','Trainer battle was not won');const validated=new campaign.constructor(campaign.catalog,campaign.pack,clone(result.state));Object.assign(draft,validated.snapshot());draft.flags[trainer]=true;
      const defeat=args[noIntro?1:2];if(defeat){const message=text(defeat);messages.push(message);if(decisions?.present)input({kind:'message',message});}
      const after=args[double?4:3];if(after&&labels[after]){label=after;index=0;}continue;
    }
    if(['warp','warpsilent','warpfadeout','warpdoor'].includes(opcode)){
      assert(args.length===3,'Unsupported warp signature');const map=args[0].toLowerCase(),x=value(args[1]),y=value(args[2]),destination=campaign.pack.maps[map];
      assert(destination,'Warp destination is not ported');integer(x,0,destination.width-1,'warp x');integer(y,0,destination.height-1,'warp y');assert(!'#~h'.includes(destination.tiles[y][x]),'Warp destination is blocked');if(campaign.pack.maps[draft.position.map].outdoor)draft.escapeOrigin=clone(draft.position);draft.position={map,x,y};delete draft.sceneMap;delete draft.wildlife;delete draft.flashLevel;delete draft.flags.FLAG_SYS_USE_STRENGTH;for(const key of Object.keys(draft.flags))if(/^FLAG_TEMP_/.test(key))delete draft.flags[key];for(const key of Object.keys(draft.vars||{}))if(/^VAR_TEMP_/.test(key))delete draft.vars[key];continue;
    }
    if(['addobject','removeobject','setobjectxy','setobjectxyperm'].includes(opcode)){
      const map=campaign.pack.maps[draft.position.map],object=args[0]==='LOCALID_PLAYER'?draft.position:map.events.find(e=>e.localId===args[0]);assert(object,'Unknown object '+args[0]);
      if(args[0]==='LOCALID_PLAYER'){assert(opcode.startsWith('setobjectxy'),'Cannot hide player');draft.position.x=value(args[1]);draft.position.y=value(args[2]);continue;}
      assert(args.length<4,'Remote object commands are not ported');draft.objects??={};draft.objects[map.id]??={};const target=draft.objects[map.id][args[0]]??={};
      if(opcode==='addobject'||opcode==='removeobject'){target.visible=opcode==='addobject';if(object.hideFlag&&object.hideFlag!=='0')draft.flags[object.hideFlag]=!target.visible;}
      else{if(opcode==='setobjectxyperm')target.persistent=true;target.x=value(args[1]);target.y=value(args[2]);integer(target.x,0,map.width-1,'object x');integer(target.y,0,map.height-1,'object y');}continue;
    }
    if(opcode==='applymovement'){
      movementStart??=clone(draft);const frames=[];
      const map=campaign.pack.maps[draft.position.map],player=args[0]==='LOCALID_PLAYER',object=player?draft.position:map.events.find(e=>e.localId===args[0]);assert(object,'Unknown movement object '+args[0]);assert(labels[args[1]],'Movement table is not ported');
      draft.objects??={};draft.objects[map.id]??={};const actor=player?draft.position:(draft.objects[map.id][args[0]]={x:object.x,y:object.y,...draft.objects[map.id][args[0]]});
      let finished=false;for(const command of labels[args[1]]){if(command==='step_end'){finished=true;break;}if(command.startsWith('goto '))break;
        const facing=command.match(/^(?:face_|walk_in_place_(?:fast_|faster_|slow_)?)(up|down|left|right)$/);if(facing){if(!player)actor.movementType='MOVEMENT_TYPE_FACE_'+facing[1].toUpperCase();frames.push({x:actor.x,y:actor.y,facing:facing[1]});continue;}if(/^(?:delay_|emote_|disable_ground_effects|enable_ground_effects|set_invisible|set_visible|face_original_direction|hide|show|cut_tree|rock_smash_break|pause|lock_facing_direction|unlock_facing_direction)/.test(command))continue;if(command==='face_player'){frames.push({x:actor.x,y:actor.y,facing:actor.x<draft.position.x?'right':actor.x>draft.position.x?'left':actor.y<draft.position.y?'down':'up'});continue;}
        const movement=command.match(/^(?:walk|walk_fast|walk_faster|walk_slow|walk_fastest|jump|jump_2|jump_in_place)_(up|down|left|right)$/);assert(movement,'Unsupported movement '+command);
        const [dx,dy]=command.startsWith('jump_in_place')?[0,0]:{up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]}[movement[1]],map=campaign.pack.maps[draft.position.map],x=actor.x+dx,y=actor.y+dy;
        assert((connectedPosition(campaign.pack,map,x,y))&&(map.sourceMap||!('#~h'.includes(tileAt(draft,map,x,y)))),'Scripted movement is blocked: '+args[0]+' '+x+','+y+' in '+map.id);actor.x=x;actor.y=y;if(player&&(x<0||y<0||x>=map.width||y>=map.height))draft.sceneMap=map.id;frames.push({x,y,facing:movement[1]});
      }assert(finished,'Movement table has no ending');if(player&&frames.length){draft.vars??={};draft.vars.VAR_FACING={down:1,up:2,left:3,right:4}[frames.at(-1).facing];}pendingMovements.push({localId:args[0],frames});continue;
    }
    if(opcode==='checkitem'||opcode==='checkitemspace'||opcode==='removeitem'){
      const id=itemIds.get(args[0]),count=args[1]?value(args[1]):1;assert(id,'Unknown item');integer(count,1,999,'item count');const current=draft.inventory[id]||0;draft.vars??={};
      if(opcode==='removeitem'){assert(current>=count,'Not enough items');draft.inventory[id]=current-count;}else draft.vars.VAR_RESULT=opcode==='checkitem'?(current>=count?1:0):(current+count<=999999?1:0);continue;
    }
    if(['checkmoney','givemoney','takemoney'].includes(opcode)){
      const amount=value(args[0]);integer(amount,0,999999999,'money amount');draft.vars??={};if(opcode==='checkmoney')draft.vars.VAR_RESULT=draft.money>=amount?1:0;
      else if(opcode==='givemoney'){draft.money+=amount;integer(draft.money,0,999999999,'money');}else{assert(draft.money>=amount,'Not enough money');draft.money-=amount;}continue;
    }
    if(opcode==='givemon'){
      const species=campaign.catalog.data.species[constants[args[0]]]?.constant||args[0].replace(/^SPECIES_/,''),level=value(args[1]);integer(level,1,100,'gift level');const temporary=new campaign.constructor(campaign.catalog,campaign.pack,draft),mon=temporary.createMon(species,level);
      if(args[2]&&args[2]!=='ITEM_NONE'){const item=itemIds.get(args[2]);assert(item,'Unknown gift item');mon.item=item;}
      temporary.catchMon(mon);temporary.snapshot();draft.vars??={};draft.vars.VAR_RESULT=draft.party.includes(mon)?0:1;messages.push(`Received ${mon.nickname}!`);continue;
    }
    if(opcode==='special'&&args[0]==='HealPlayerParty'){
      for(const mon of draft.party)campaign.catalog.heal(mon);continue;
    }
    if(opcode==='giveitem'){
      const id=itemIds.get(args[0]),count=args[1]?value(args[1]):1;assert(id,'Unknown reward item');integer(count,1,999,'reward quantity');const total=(draft.inventory[id]||0)+count;integer(total,0,999999,'bag capacity');draft.inventory[id]=total;draft.vars??={};draft.vars.VAR_RESULT=1;messages.push(`Received ${campaign.catalog.data.items[id]} × ${count}!`);continue;
    }
    throw new Error('Unported command '+opcode);
  }
  throw new Error('Script exceeded the execution limit');
}
export function runScript(campaign,source,entry){
  const result=planScript(campaign,source,entry);
  // Validate the entire result before committing any reward, variable or story flag.
  const previous=campaign.state;try{campaign.state=result.state;campaign.validate();campaign.random.state=campaign.state.rng;}catch(error){campaign.state=previous;throw error;}
  return result.messages;
}

export async function runInteractiveScript(campaign,source,entry,host){
  const before=JSON.stringify(campaign.snapshot()),decisions=new Map();decisions.present=host?.present===true;
  for(let resumes=0;resumes<512;resumes++){
    let result;
    try{result=planScript(campaign,source,entry,decisions);}catch(error){
      if(!(error instanceof ScriptInputRequired))throw error;
      assert(typeof host?.choose==='function','No choice interface installed');
      const response=await host.choose(error.request);assert(response!==null&&response!==undefined,'Interaction cancelled');
      assert(JSON.stringify(campaign.snapshot())===before,'Campaign changed during interaction');decisions.set(error.key,response);continue;
    }
    assert(JSON.stringify(campaign.snapshot())===before,'Campaign changed during interaction');
    const previous=campaign.state;try{campaign.state=result.state;campaign.validate();campaign.random.state=campaign.state.rng;}catch(error){campaign.state=previous;throw error;}return result.messages;
  }
  throw new Error('Too many script choices');
}
