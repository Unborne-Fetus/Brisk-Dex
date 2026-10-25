import {FieldInput} from './field-motion.mjs';
import {dialoguePages,battleEnvironment} from './dialogue.mjs';
import {resumeAppSave,activeAppSave} from './app-save.mjs';
import {refreshWildlife,meetWildlife} from './overworld.mjs';
import {fieldMoveUser} from './traversal.mjs';
import {Catalog} from './model.mjs';
import {Campaign,fieldWeather,migrateCampaign} from './world.mjs';
import {LocalBattle,supportedMove} from './battle.mjs';
import {SaveStore,encodeSave,decodeSave} from './storage.mjs';
import {loadSprite} from './media.mjs';
import {importGbaSave,originalGbaBytes} from './gba-import.mjs';
import {mapEntryScripts,coordinateScript,frameScript,warpScripts,sightedTrainers,pairedTrainerBattle} from './scenes.mjs';
import {runInteractiveScript} from './scripts.mjs';
import {drawNative} from './renderer.mjs';
import {IntegrationBridge} from './integrations.mjs';
const $=id=>document.getElementById(id),ctx=$('world').getContext('2d'),store=new SaveStore();
let appVisible=true;
window.addEventListener('message',e=>{if(e.source!==window.parent||e.data?.type!=='brisk-game-visibility')return;appVisible=e.data.visible===true;keys.clear();movement.clear();});
let runLatch=false;
let sceneBattleResolve=null,storySource='',appSavePending=false,gbaLayout,fontMetrics={};
let campaign,battle,battleEvent,pack,catalog,facing=[0,1],busy=false,dirty=false,savedAt=0,saving=null,storyActive=false,choiceCancel=null;
const keys=new Set(),bridge=new IntegrationBridge();
const notice=text=>$('notice').textContent=text;
const button=(text,fn)=>{const b=document.createElement('button');b.textContent=text;b.onclick=()=>guard(fn);return b;};
async function guard(fn){try{await fn();}catch(e){notice(e.message);}}
function sprite(mon,back=false){const s=catalog.species(mon.species);return '../'+(mon.shiny?(back?s.backShinySprite:s.frontShinySprite):(back?s.backSprite:s.frontSprite));}
function modal(title,content,scene=false){movement.clear();if($('modal').open)$('modal').close();$('modal').classList.remove('pause');$('modal').classList.toggle('scene',scene);$('modal-title').textContent=title;$('modal-content').replaceChildren();if(typeof content==='string'){const p=document.createElement('p');p.textContent=content;$('modal-content').append(p);}else $('modal-content').append(...content);if(scene)$('modal').show();else $('modal').showModal();}
function close(){ $('modal').close();$('modal').classList.remove('pause');$('world').focus(); }
$('modal-close').onclick=()=>{if(choiceCancel){const cancel=choiceCancel;choiceCancel=null;close();cancel(null);}else close();};
$('modal').addEventListener('cancel',()=>{if(choiceCancel){const cancel=choiceCancel;choiceCancel=null;cancel(null);}});
function update(fieldOnly=false){
  if(!campaign)return;
  const s=campaign.state;document.body.dataset.theme=s.options.theme||'dark';$('run').setAttribute('aria-pressed',String(isRunning()));$('map-name').textContent=campaign.map.name;$('money').textContent=`₽ ${s.money.toLocaleString()}`;
  $('weather').textContent=fieldWeather(campaign.map,s.party[0]).toUpperCase()+(campaign.map.weatherLocked?' · PROTECTED':'');
  if(fieldOnly){$('dive').disabled=busy||!campaign.fieldScript(...facing,'dive');$('fish').disabled=busy||!campaign.fishable(s.position.x+facing[0],s.position.y+facing[1]);return;}
  $('encounters').checked=s.options.encounters;$('weather-effects').checked=s.options.weather;
  $('party').replaceChildren(...s.party.map((mon,index)=>{
    const row=document.createElement('div');row.className='party-mon';const img=document.createElement('img');loadSprite(img,sprite(mon));img.alt='';
    const info=document.createElement('div'),name=document.createElement('strong');name.textContent=mon.nickname+(mon.shiny?' ✦':'');const sub=document.createElement('small');sub.textContent=`Lv. ${mon.level} · ${mon.ability}`;const hp=document.createElement('progress');hp.value=mon.hp;hp.max=catalog.stats(mon)[0];hp.setAttribute('aria-label',`${mon.hp} of ${hp.max} HP`);info.append(name,sub,hp);
    const action=button('Lead',()=>{if(battle||storyActive)throw new Error('Finish the active interaction first');campaign.setLead(index);dirty=true;update();});action.disabled=index===0||!!battle;const controls=document.createElement('div');controls.className='party-controls';controls.append(action,button('Info',()=>{if(!battle&&!storyActive)partyDetails(mon);}));row.append(img,info,controls);
    row.ondblclick=()=>{if(!battle&&!storyActive)partyDetails(mon);};return row;
  }));
  $('bag').replaceChildren(...Object.entries(s.inventory).filter(([,n])=>n>0).map(([id,n])=>{const p=document.createElement('div');const usable=[28,29,30,31,32,33,34].includes(Number(id))||/^ITEM_EXP_CANDY_/.test(catalog.data.itemDetails[id]?.constant||'');if(usable){p.append(button(`${catalog.data.items[id]} × ${n}`,()=>{if(battle||storyActive)throw new Error('Finish the active interaction first');modal('Use on which Pokémon?',s.party.map(mon=>button(mon.nickname,async()=>{const candy=/^ITEM_EXP_CANDY_/.test(catalog.data.itemDetails[id]?.constant||'');let amount=1;if(candy){const input=await textInput(`How many? (1–${Math.min(n,99)})`,'1','number');if(input===null)return;amount=Number(input);}campaign.useFieldItem(Number(id),mon.uid,amount);dirty=true;close();update();growthPrompts();})));}));}else p.textContent=`${catalog.data.items[id]} × ${n}`;return p;}));
  document.querySelector('.play').classList.toggle('in-battle',!!battle);
  $('world').hidden=!!battle;$('battle').hidden=!battle;
  $('save').disabled=!!battle||storyActive||busy;
  $('dive').disabled=!!battle||storyActive||busy||!campaign.fieldScript(...facing,'dive');$('fish').disabled=!!battle||storyActive||busy||!campaign.fishable(s.position.x+facing[0],s.position.y+facing[1]);
  if(battle)renderBattle();
}
function partyDetails(mon){
  const stats=catalog.stats(mon),p=document.createElement('p');p.textContent=`${mon.nickname} · HP ${mon.hp}/${stats[0]} · Attack ${stats[1]} · Defense ${stats[2]} · Speed ${stats[3]} · Sp. Atk ${stats[4]} · Sp. Def ${stats[5]}`;
  const nodes=[p];
  nodes.push(button('Relearn level-up move',()=>{close();const learned=(catalog.native.species?.[mon.species]?.learnset||[]).filter(e=>e.level<=mon.level&&!mon.moves.some(m=>m.id===e.move));modal('Level-up moves', [...new Set(learned.map(e=>e.move))].map(id=>button(catalog.move(id).name,()=>chooseMove(mon,id))));}));
  nodes.push(button('Held item',()=>{close();const stock=Object.entries(campaign.state.inventory).filter(([id,n])=>n>0);modal('Choose a held item',stock.map(([id])=>button(catalog.data.items[id],()=>{campaign.consume(Number(id));if(mon.item)campaign.state.inventory[mon.item]=(campaign.state.inventory[mon.item]||0)+1;mon.item=Number(id);dirty=true;close();update();})));}));

  if(campaign.state.boxes.length)nodes.push(button('Swap with storage',()=>{
    close();modal('Caught Pokémon in storage',campaign.state.boxes.slice(0,100).map((stored,index)=>button(`${stored.nickname} · Lv. ${stored.level}`,()=>{campaign.swapStorage(campaign.state.party.indexOf(mon),index);dirty=true;close();update();})));
  }));
  const evo=catalog.evolution(mon);if(evo)nodes.push(button('Evolve',()=>{campaign.evolve(mon.uid);dirty=true;close();update();notice(`${mon.nickname} evolved!`);}));
  for(const [id,count] of Object.entries(campaign.state.inventory))if(count>0&&catalog.evolution(mon,catalog.data.itemDetails[id]?.constant))nodes.push(button(`Use ${catalog.data.items[id]}`,()=>{campaign.evolve(mon.uid,Number(id));dirty=true;close();update();}));
  modal('Partner details',nodes);
}
function beginBattle(mon,trainer=null,eventId=null,format='singles'){battleEvent=eventId;battle=new LocalBattle(campaign,mon,{trainer,format});dirty=true;update();}
function renderBattle(){
  const environment='assets/battle-'+battleEnvironment(campaign)+'.png',field=document.querySelector('.battlefield');
  if(field.dataset.environment!==environment){field.dataset.environment=environment;if(globalThis.BriskGameAssets)BriskGameAssets.assetUrl(environment).then(url=>{if(field.dataset.environment===environment)field.style.backgroundImage=`url(${url})`;});else field.style.backgroundImage=`url(${environment})`;}
  field.classList.toggle('doubles',battle.doubles);document.querySelector('.play').classList.add('in-battle');
  const view=(side,slot)=>{const p=battle.room.players[side],index=slot?p.active2:p.active,runtime=p.team[index],mon=side?battle.opponents[index]:campaign.state.party[index];return runtime&&mon?{...mon,species:runtime.species,nickname:runtime.name,hp:runtime.hp,status:runtime.status,battleMaxHP:runtime.maxHP}:null;};
  const cards=battle.doubles?[['enemy-card',view(1,0),false],['player-card',view(0,0),true],['enemy-card-2',view(1,1),false],['player-card-2',view(0,1),true]]:[['enemy-card',battle.enemy,false],['player-card',battle.playerView||battle.player,true],['enemy-card-2',null,false],['player-card-2',null,true]];
  for(const [id,mon,back] of cards){
    const card=$(id);card.hidden=!mon;if(!mon)continue;
    if(!card.querySelector('section')){card.replaceChildren();const stats=document.createElement('section');stats.className='battle-stats';const name=document.createElement('strong'),level=document.createElement('span'),condition=document.createElement('span'),track=document.createElement('span'),fill=document.createElement('span'),hpText=document.createElement('small');name.className='battle-name';level.className='battle-level';condition.className='battle-status';track.className='hp-track';fill.className='hp-fill';hpText.className='hp-text';track.setAttribute('role','progressbar');track.append(fill);stats.append(name,level,condition,track,hpText);const img=document.createElement('img');card.append(stats,img);}
    const img=card.querySelector('img'),path=sprite(mon,back);if(img.dataset.sprite!==path){img.dataset.sprite=path;loadSprite(img,path);}img.alt=mon.nickname;
    const max=mon.battleMaxHP||catalog.stats(mon)[0],ratio=Math.max(0,Math.min(1,mon.hp/max));card.querySelector('.battle-name').textContent=mon.nickname;card.querySelector('.battle-level').textContent='Lv. '+mon.level;card.querySelector('.battle-status').textContent=mon.status?mon.status.toUpperCase():'';card.querySelector('.hp-text').textContent=`${mon.hp} / ${max} HP`;
    const track=card.querySelector('.hp-track');track.setAttribute('aria-label',mon.nickname+' HP');track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax',max);track.setAttribute('aria-valuenow',mon.hp);const fill=card.querySelector('.hp-fill');fill.style.width=100*ratio+'%';fill.dataset.health=ratio>.5?'healthy':ratio>.2?'low':'critical';card.classList.toggle('fainted',mon.hp<=0);card.classList.toggle('choosing',back&&mon.uid===battle.player.uid&&battle.phase==='battle');
  }
  $('battle-context').textContent=`${battle.trainer||'Wild encounter'} · Turn ${battle.turn||1}${battle.weather?' · '+(typeof battle.weather==='string'?battle.weather:battle.weather.type||'Weather'):''}`;
  $('battle-log').replaceChildren(...battle.log.slice(-3).map(line=>{const p=document.createElement('div');p.textContent=line;return p;}));$('battle-log').scrollTop=10000;
  const actions=[],nav=$('battle-nav');nav.replaceChildren();$('battle-targets').replaceChildren();
  if(battle.phase!=='battle')actions.push(button('Return to the field',async()=>{
    if(sceneBattleResolve){const resolve=sceneBattleResolve;sceneBattleResolve=null;const result={phase:battle.phase,state:campaign.snapshot()};battle=null;update();resolve(result);return;}
    if(battle.phase==='lost'){campaign.heal();campaign.state.position=structuredClone(campaign.state.respawn||pack.start);notice('Your party was brought back to safety.');}
    const defeated=battle.phase==='won'&&battle.trainer&&battleEvent;const paired=defeated&&Array.isArray(battleEvent)?battleEvent:[];if(defeated)for(const id of Array.isArray(battleEvent)?battleEvent.map(e=>e.id):[battleEvent])campaign.state.flags[id]=true;
    battle=null;update();await save();for(const event of paired)if(event.sourceScript)await playScene(event.sourceScript);growthPrompts();
  }));
  else{
    battle.menu??='fight';
    for(const [key,label]of [['fight','Fight'],['bag','Bag'],['party','Pokémon']]){const tab=button(label,()=>{battle.menu=key;renderBattle();});tab.setAttribute('aria-pressed',String(battle.menu===key));tab.disabled=key==='bag'&&!(campaign.bagAllowed()||!battle.trainer&&campaign.state.options.battleBag!==false);nav.append(tab);}
    if(!battle.trainer)nav.append(button('Run',()=>act({type:'run'})));
    const heading=document.createElement('p');heading.className='battle-prompt';heading.textContent=`What will ${battle.player.nickname} do?`;actions.push(heading);
    if(battle.menu==='fight'){
      if(battle.doubles){const foe=battle.room.players[1];for(const [pos,index]of [[0,foe.active],[1,foe.active2]])if(foe.team[index]?.hp>0){const target=button('Target: '+foe.team[index].name,()=>{battle.targetPos=pos;renderBattle();});target.textContent=foe.team[index].name;target.setAttribute('aria-label','Target: '+foe.team[index].name);target.className='target-choice';target.setAttribute('aria-pressed',String((battle.targetPos||0)===pos));$('battle-targets').append(target);}}
      battle.player.moves.forEach((m,i)=>{const move=catalog.move(m.id),b=button('',()=>act({type:'move',index:i,...(battle.selectedForm?{gimmick:battle.selectedForm.kind,formIndex:battle.selectedForm.index}:{})}));b.className='move-choice';b.dataset.type=move.type;const name=document.createElement('strong'),meta=document.createElement('small');name.textContent=move.name;meta.textContent=`${move.type} · ${move.category} · ${m.pp}/${catalog.maxPP(m)} PP`;const shortcut=document.createElement('kbd');shortcut.textContent=String(i+1);b.append(name,meta,shortcut);b.title=`${move.description||''}\nPower: ${move.power||'—'} · Accuracy: ${move.accuracy||'—'}`;b.disabled=!m.pp||!supportedMove(move);actions.push(b);});
      if(!battle.available(battle.player).length)actions.push(button('Struggle',()=>act({type:'move',index:-1})));
      for(const form of battle.gimmicks()){const b=button(`${form.kind}: ${form.name}`,()=>{battle.selectedForm=battle.selectedForm?.index===form.index?null:form;renderBattle();});b.className='gimmick-choice';b.textContent=form.kind;b.title=form.name;b.setAttribute('aria-label',`${form.kind}: ${form.name}`);b.setAttribute('aria-pressed',String(battle.selectedForm?.index===form.index));nav.append(b);}
    }else if(battle.menu==='bag'){
      const potion=button(`Potion (${campaign.state.inventory[28]||0})`,()=>act({type:'potion'}));potion.disabled=!campaign.bagAllowed()||!(campaign.state.inventory[28]>0)||battle.playerView.hp>=battle.playerView.battleMaxHP;actions.push(potion);
      if(!battle.trainer)for(const item of [1,2,3,4]){const ball=button(`${catalog.data.items[item]} (${campaign.state.inventory[item]||0})`,()=>act({type:'catch',item}));ball.disabled=!(campaign.state.inventory[item]>0);actions.push(ball);}
    }else campaign.state.party.forEach((mon,i)=>{const active=i===battle.room.players[0].active||i===battle.room.players[0].active2,b=button(`Switch: ${mon.nickname}`,()=>act({type:'switch',index:i}));b.disabled=active||mon.hp<=0;const info=document.createElement('small');info.textContent=`Lv. ${mon.level} · ${mon.hp}/${catalog.stats(mon)[0]} HP${active?' · Active':''}`;b.append(info);actions.push(b);});
  }
  $('battle-actions').replaceChildren(...actions);$('battle').dataset.menu=battle.phase==='battle'?battle.menu:'finished';
}
function act(action){
 const before=new Map([battle.enemy,battle.playerView].map(m=>[m.uid,m.hp]));battle.act(action);battle.selectedForm=null;battle.menu='fight';dirty=true;update();
 if(!matchMedia('(prefers-reduced-motion: reduce)').matches)for(const [id,mon]of [['enemy-card',battle.enemy],['player-card',battle.playerView]])if(before.has(mon.uid)&&mon.hp<before.get(mon.uid))$(id).animate([{opacity:1},{opacity:.2},{opacity:1}],{duration:300});
}
function chooseMove(mon,id){
  close();if(mon.moves.length<4){catalog.teach(mon,id,mon.moves.length);dirty=true;update();return growthPrompts();}
  modal(`${mon.nickname} wants to learn ${catalog.move(id).name}`, [...mon.moves.map((m,index)=>button(`Replace ${catalog.move(m.id).name}`,()=>{catalog.teach(mon,id,index);dirty=true;close();update();growthPrompts();})),button('Keep current moves',()=>{mon.pendingMoves=(mon.pendingMoves||[]).filter(move=>move!==id);dirty=true;close();growthPrompts();})]);
}
function growthPrompts(){
  const pending=campaign.state.party.find(m=>m.pendingMoves?.length);if(pending){chooseMove(pending,pending.pendingMoves[0]);return;}
  const evolving=campaign.state.party.find(m=>catalog.evolution(m)&&m.evolutionDeclinedAt!==m.level);if(evolving){modal(`${evolving.nickname} can evolve`,[button('Evolve',()=>{campaign.evolve(evolving.uid);dirty=true;close();update();growthPrompts();}),button('Later',()=>{evolving.evolutionDeclinedAt=evolving.level;dirty=true;close();growthPrompts();})]);}
}
async function save(){
  if(!campaign||battle||storyActive)throw new Error('Finish the active interaction before saving');if(saving)return saving;
  const current=campaign,snapshot=current.snapshot();busy=true;$('save').disabled=true;notice('Saving your journey…');
  saving=store.commit(snapshot).then(()=>{if(campaign===current)dirty=JSON.stringify(campaign.snapshot())!==JSON.stringify(snapshot);savedAt=performance.now();notice('Journey saved. Your previous save is kept as a backup.');}).finally(()=>{busy=false;saving=null;$('save').disabled=false;});return saving;
}
async function interact(){
  if(!campaign||battle||busy||storyActive||$('modal').open)return;
  await movement.idle();if(battle||storyActive||$('modal').open)return;
  campaign.state.vars??={};campaign.state.vars.VAR_FACING=facing[0]===1?4:facing[0]===-1?3:facing[1]===-1?2:1;
  const wild=meetWildlife(campaign,campaign.state.position.x+facing[0],campaign.state.position.y+facing[1]);if(wild){beginBattle(wild.mon);return;}
  const e=campaign.interact(...facing);if(e?.localId){campaign.state.vars.VAR_LAST_TALKED=catalog.storyData?.maps?.[campaign.map.id]?.localIds?.[e.localId]||Number(e.localId)||0;}if(!e){const entry=campaign.fieldScript(...facing);if(entry)await fieldScene(entry);else notice('Nothing to interact with here.');return;}
  if(e.kind==='heal'){campaign.heal();if(campaign.map.sourceMap?.includes('POKEMON_CENTER'))campaign.state.respawn=structuredClone(campaign.state.position);dirty=true;notice(e.text);update();await save();}
  else if((e.kind==='dialogue'||e.kind==='trainer')&&campaign.map.scriptText&&e.sourceScript){const map=campaign.map.id;await playScene(e.sourceScript,e.text);if(map!==campaign.map.id)await enterMap();else {const frame=frameScript(campaign);if(frame)await playScene(frame);}}
  else if(e.kind==='dialogue')await sceneChoice(e.text);
  else if(e.kind==='trainer'){
    if(campaign.state.flags[e.id]){modal('Trainer','Thanks for the battle!');return;}
    modal('Trainer battle',[Object.assign(document.createElement('p'),{textContent:e.text}),button('Battle',()=>{close();beginBattle(e.team?campaign.trainerTeam(e.team):campaign.createMon(e.species,e.level),e.trainerName||'Trainer',e.id);})]);
  }else if(e.kind==='shop')modal('Field supplies',e.stock.map(stock=>button(`${catalog.data.items[stock.item]} · ₽${stock.price*({easy:1,normal:2,hard:4,extreme:10}[campaign.state.options.difficulty]||1)}`,()=>{campaign.buy(stock.item,1,e);dirty=true;update();notice(`Bought ${catalog.data.items[stock.item]}.`);})));
}
async function sceneChoice(message,labels=['Continue']){
 const pages=dialoguePages(message,fontMetrics);let answer=0;
 for(let i=0;i<pages.length;i++){
  const choices=i===pages.length-1?labels:['Continue'];answer=await new Promise(resolve=>{
   let timer=null,complete=false;const full=pages[i],p=Object.assign(document.createElement('p'),{textContent:full});
   const finish=value=>{if(timer)clearInterval(timer);choiceCancel=null;close();resolve(value);};choiceCancel=()=>finish(null);
   const nodes=[p,...choices.map((label,index)=>{const b=button(label,()=>{if(!complete){p.textContent=full;complete=true;if(timer)clearInterval(timer);return;}finish(index);});b.className=choices.length===1?'dialogue-next':'dialogue-choice';b.setAttribute('aria-label',label);return b;})];
   modal('Brisk Emerald',nodes,true);$('modal').classList.toggle('has-choices',choices.length>1);
   const speed={instant:0,fast:12,normal:28}[campaign?.state.options.textSpeed||'instant'];complete=!speed;
   if(speed){let count=0;p.textContent='';timer=setInterval(()=>{count++;p.textContent=full.slice(0,count);if(count>=full.length){complete=true;clearInterval(timer);}},speed);}
   $('modal-content').querySelector('button')?.focus();
  });if(answer===null)return null;
 }return answer;
}
function textInput(title,value='',type='text'){
 return new Promise(resolve=>{choiceCancel=resolve;const input=document.createElement('input');input.type=type;input.value=value;input.maxLength=24;input.setAttribute('aria-label',title);modal(title,[input,button('Continue',()=>{choiceCancel=null;close();resolve(input.value);})]);input.focus();});
}
async function playScene(entry,fallback='',present=true){
  if(storyActive)return false;const original=campaign,source=storySource||((pack.sharedScripts||'')+'\n'+campaign.map.scriptText);storyActive=true;update();
  try{
    await runInteractiveScript(original,source,entry,{present,choose:async request=>{
      if(request.kind==='starter')return new Promise(resolve=>{choiceCancel=resolve;modal('Choose your first partner',request.starters.map(constant=>{const species=catalog.species(catalog.id(constant)),b=button(species.name,()=>{choiceCancel=null;close();resolve(constant);});const img=document.createElement('img');loadSprite(img,'../'+species.frontSprite);img.alt='';b.prepend(img);b.className='starter';return b;}));});
      if(request.kind==='clock')return new Promise(resolve=>{choiceCancel=resolve;const field=document.createElement('input');field.type='time';field.value=request.clock||new Date().toTimeString().slice(0,5);modal(request.view?'Your room clock':'Set your room clock',[field,button('Set clock',()=>{choiceCancel=null;close();resolve(field.value);})]);});
      if(request.kind==='nickname'){const name=await textInput('Nickname',request.name);return name===null?request.name:name.trim().slice(0,24)||request.name;}
      if(request.kind==='delay'){await new Promise(resolve=>setTimeout(resolve,request.duration));return 1;}
      if(request.kind==='menu')return sceneChoice('Choose an option',request.options);
      if(request.kind==='fade'){const veil=$('scene-fade');veil.style.background=request.white?'white':'black';await veil.animate([{opacity:request.out?0:1},{opacity:request.out?1:0}],{duration:240,fill:'forwards'}).finished;return 1;}
      if(request.kind==='cry'){const path=catalog.species(request.species).cry;if(path){const audio=new Audio(globalThis.BriskGameAssets?await BriskGameAssets.assetUrl('../'+path):'../'+path);audio.volume=.4;audio.play().catch(()=>{});}return 1;}
      if(request.kind==='message')return sceneChoice(request.message);
      if(request.kind==='yesno'){const answer=await sceneChoice(request.message,['Yes','No']);return answer===null?null:answer===0?1:0;}
      if(request.kind==='movement'){
        const previous=campaign;campaign=new Campaign(catalog,pack,request.startState);if(request.movementMode)campaign.state.field={mode:request.movementMode};
        try{for(let frame=0;frame<Math.max(...request.actors.map(actor=>actor.frames.length));frame++){
          for(const actor of request.actors){const point=actor.frames[frame];if(!point)continue;
            if(actor.localId==='LOCALID_PLAYER'){Object.assign(campaign.state.position,{x:point.x,y:point.y});facing={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]}[point.facing];campaign.state.playerEmote=point.emote||null;}
            else{campaign.state.objects??={};campaign.state.objects[campaign.map.id]??={};campaign.state.objects[campaign.map.id][actor.localId]={...campaign.state.objects[campaign.map.id][actor.localId],x:point.x,y:point.y,movementType:'MOVEMENT_TYPE_FACE_'+point.facing.toUpperCase(),emote:point.emote||null,walking:point.walking===true};}
          }update();await new Promise(resolve=>setTimeout(resolve,Math.max(50,...request.actors.map(actor=>actor.frames[frame]?.duration||150))));
        }return 1;}finally{campaign=previous;update();}
      }
      if(request.kind==='tutorial'){await sceneChoice('WALLY sent out ZIGZAGOON! A wild RALTS appeared.');await sceneChoice('ZIGZAGOON used TACKLE! WALLY threw a POKé BALL.');await sceneChoice('Gotcha! RALTS was caught!');return 1;}
      if(request.kind==='battle'||request.kind==='wild-battle'){
        if(request.intro){const answer=await sceneChoice(request.intro,['Battle']);if(answer===null)return null;}
        campaign=new Campaign(catalog,pack,request.state);
        try{if(request.kind==='wild-battle')beginBattle(request.mon);else beginBattle(campaign.trainerTeam(request.team.party),request.team.name,null,request.format);return await new Promise(resolve=>{sceneBattleResolve=resolve;});}
        finally{battle=null;campaign=original;update();}
      }
      throw new Error('Unknown scene request '+request.kind);
    }});dirty=true;update();return true;
  }catch(error){
    if(error.state){original.state=error.state;original.random.state=error.state.rng;original.heal();original.state.position=structuredClone(original.state.respawn||pack.start);dirty=true;notice('Your party was brought back to safety.');}
    else notice((fallback?fallback+' · ':'')+error.message);
    return false;
  }finally{$('scene-fade').getAnimations().forEach(a=>a.cancel());campaign=original;storyActive=false;update();}
}
async function fieldScene(entry){const before=campaign.map.id;campaign.state.vars??={};campaign.state.vars.VAR_FACING=facing[0]===1?4:facing[0]===-1?3:facing[1]===-1?2:1;await playScene(entry);if(campaign.map.id!==before)await enterMap();}
async function enterMap(){for(let hop=0;hop<12;hop++){const map=campaign.map.id;for(const entry of mapEntryScripts(campaign.map))await playScene(entry,'',false);for(const entry of warpScripts(campaign))await playScene(entry,'',false);const frame=frameScript(campaign);if(frame)await playScene(frame);if(map===campaign.map.id){const coord=coordinateScript(campaign);if(coord)await playScene(coord);if(map!==campaign.map.id)continue;refreshWildlife(campaign);return;}}throw Error('Too many map transitions');}
async function stepScene(){
 const trainers=sightedTrainers(campaign);
 if(trainers.length>=2&&campaign.state.party.filter(m=>m.hp>0).length>=2){const answer=await sceneChoice(trainers.slice(0,2).map(e=>e.trainerName||'Trainer').join(' and ')+' spotted you!',['Battle']);if(answer!==null){const paired=pairedTrainerBattle(campaign,trainers);if(paired)beginBattle(paired.team,paired.name,paired.trainers,'doubles');}return;}
 if(trainers[0]){await playScene(trainers[0].sourceScript);return;}
 const map=campaign.map.id,entry=coordinateScript(campaign);if(entry)await playScene(entry);const frame=frameScript(campaign);if(frame)await playScene(frame);if(map!==campaign.map.id)await enterMap();
}
async function move(dx,dy){
  if(!appVisible||!campaign||battle||storyActive||$('modal').open||busy)return;const forced=campaign.forcedDirection();if(forced)[dx,dy]=forced;facing=[dx,dy];const result=campaign.move(dx,dy);
  if(result.kind==='encounter'){
    if(campaign.state.party.some(m=>m.hp>0))beginBattle(result.mon);else notice('Your party needs healing. Visit a bench or the lab.');
  }else if(result.kind==='warp'){notice(`Entered ${result.map}.`);await enterMap();}else if(result.kind==='step')await stepScene();
  if(result.kind!=='blocked')dirty=true;update(!battle);
}
function startSelection(){
  modal('Start your Brisk journey',[button('New game',async()=>{
    const speech=catalog.storyData.speech||{},clean=t=>t.replace(/\\[nl]/g,' ').replace(/\\p/g,'\n\n').replace(/\$/g,'').replace(/\{(?:PAUSE[^}]*|KUN)\}/g,'');
    for(const key of ['gText_Birch_Welcome','gText_ThisIsAPokemon','gText_Birch_MainSpeech'])if(speech[key]&&await sceneChoice(clean(speech[key]))===null)return;
    const gender=await sceneChoice('Are you a boy? Or are you a girl?',['Boy','Girl']);if(gender===null)return;
    const name=await textInput('What is your name?','Trainer');if(name===null)return;
    campaign=Campaign.begin(catalog,pack,{name:name.trim().slice(0,24)||'Trainer',gender:gender===1?'Female':'Male'});battle=null;dirty=true;close();update();
    if(speech.gText_Birch_AreYouReady)await sceneChoice(clean(speech.gText_Birch_AreYouReady).replaceAll('{PLAYER}',campaign.state.trainer.name));
    close();await enterMap();await save();
  }),button('Quick start',()=>{modal('Choose your first partner',['TREECKO','TORCHIC','MUDKIP'].map(constant=>button(catalog.species(catalog.id(constant)).name,async()=>{campaign=Campaign.start(catalog,pack,constant);campaign.state.options.overworldEncounters=true;battle=null;dirty=true;close();update();await save();})));})]);
}
$('dive').onclick=()=>guard(async()=>{if(!campaign||battle||storyActive||busy)return;const entry=campaign.fieldScript(...facing,'dive');if(entry)await fieldScene(entry);});
$('fish').onclick=()=>guard(()=>{if(!campaign||battle||storyActive||busy)return;const rods=['old_rod','good_rod','super_rod'].filter(rod=>Object.entries(catalog.data.itemDetails).some(([id,item])=>item.constant==='ITEM_'+rod.toUpperCase()&&(campaign.state.inventory[id]||0)>0));if(!rods.length){notice('There is no fishing rod in the Bag.');return;}modal('Choose a fishing rod',rods.map(rod=>button(rod.replaceAll('_',' '),()=>{close();const result=campaign.fish(rod,...facing);dirty=true;if(result.kind==='encounter')beginBattle(result.mon);else notice('Not even a nibble…');update();})));});
$('save').onclick=()=>guard(save);$('interact').onclick=()=>guard(interact);
$('encounters').onchange=e=>{if(campaign){campaign.state.options.encounters=e.target.checked;dirty=true;}};
$('weather-effects').onchange=e=>{if(campaign){campaign.state.options.weather=e.target.checked;dirty=true;}};
$('export').onclick=()=>guard(async()=>{
  if(!campaign||battle||storyActive)throw new Error('Finish the active interaction before exporting');const envelope=await encodeSave(campaign.snapshot()),url=URL.createObjectURL(new Blob([JSON.stringify(envelope)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='brisk-standalone-save.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('import').onchange=e=>guard(async()=>{
  const file=e.target.files[0];e.target.value='';if(!file)return;if(battle||storyActive)throw new Error('Finish the active interaction before importing');movement.clear();if(file.size>34000000)throw new Error('Save file is too large');
  const candidate=migrateCampaign(await decodeSave(JSON.parse(await file.text())),pack,catalog);
  if(campaign&&!confirm('Replace this journey with the imported save? Your existing saved journey will become the backup.'))return;
  await store.commit(candidate.snapshot());campaign=candidate;dirty=false;update();close();notice('Imported standalone campaign.');
});
$('restore').onclick=()=>guard(async()=>{if(battle||storyActive)throw new Error('Finish the active interaction first');const previous=await store.load('backup');if(!previous)throw new Error('No backup is available yet');const candidate=migrateCampaign(previous,pack,catalog);if(!confirm('Restore the previous saved journey?'))return;await store.commit(candidate.snapshot());campaign=candidate;dirty=false;update();notice('Previous save restored.');});
$('new-game').onclick=()=>{if(battle||storyActive){notice('Finish the active interaction first.');return;}if(!campaign||confirm('Start a new journey? Your current saved journey will become the backup.'))startSelection();};
const directions={ArrowUp:[0,-1],w:[0,-1],ArrowDown:[0,1],s:[0,1],ArrowLeft:[-1,0],a:[-1,0],ArrowRight:[1,0],d:[1,0]};
const movement=new FieldInput({step:move,canMove:()=>appVisible&&campaign&&!battle&&!storyActive&&!$('modal').open&&!busy,interval:()=>isRunning()?100:150,onError:e=>notice(e.message)});
const keyName=e=>e.key.length===1?e.key.toLowerCase():e.key;
window.addEventListener('keydown',e=>{
 if(e.key==='Escape'&&(document.fullscreenElement||document.querySelector('.play').classList.contains('expanded'))){if(!document.fullscreenElement)toggleFullscreen();return;}
 if(e.key==='Escape'&&$('modal').open&&$('modal').classList.contains('scene')){e.preventDefault();$('modal-close').click();return;}
 if($('modal').open&&$('modal').classList.contains('scene')&&['e','Enter',' '].includes(e.key)){e.preventDefault();$('modal-content').querySelector('button')?.click();return;}
 if(e.key==='Escape'&&!$('modal').open&&!battle){e.preventDefault();openGameMenu();return;}
 if($('modal').open||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;
 const key=keyName(e);if(battle){if(['1','2','3','4'].includes(key)&&battle.menu==='fight'){e.preventDefault();$('battle-actions').querySelectorAll('.move-choice')[Number(key)-1]?.click();}else if(['f','b','p'].includes(key)){e.preventDefault();const menu={f:'fight',b:'bag',p:'party'}[key];if(menu!=='bag'||campaign.bagAllowed()||!battle.trainer&&campaign.state.options.battleBag!==false){battle.menu=menu;renderBattle();}}else if(directions[key])e.preventDefault();return;}if(key==='Shift'||key==='b'){if(campaign?.state.options.runMode==='toggle'){if(!e.repeat)runLatch=!runLatch;}else keys.add(key);e.preventDefault();}
 if(directions[key]){e.preventDefault();movement.press(key,directions[key]);guard(()=>movement.tick(performance.now()));}
 if(['e','Enter',' '].includes(key)&&e.target.tagName!=='BUTTON'){e.preventDefault();guard(interact);}
});
window.addEventListener('keyup',e=>{const key=keyName(e);movement.release(key);keys.delete(key);});
window.addEventListener('blur',()=>{keys.clear();movement.clear();});document.addEventListener('visibilitychange',()=>{if(document.hidden){keys.clear();movement.clear();}});
for(const b of document.querySelectorAll('[data-dir]')){const key={up:'ArrowUp',down:'ArrowDown',left:'ArrowLeft',right:'ArrowRight'}[b.dataset.dir];b.onpointerdown=e=>{e.preventDefault();b.setPointerCapture(e.pointerId);movement.press(key,directions[key]);guard(()=>movement.tick(performance.now()));};b.onpointerup=b.onpointercancel=b.onlostpointercapture=()=>movement.release(key);}
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
function rect(x,y,w,h,color){ctx.fillStyle=color;ctx.fillRect(x,y,w,h);}
function draw(time){
  requestAnimationFrame(draw);if(appSavePending&&catalog&&!battle&&!storyActive&&!busy){appSavePending=false;busy=true;syncAppSave().finally(()=>{busy=false;update();});}if(!appVisible||!campaign)return;
  campaign.presentationRunning=isRunning();campaign.presentationStepMs=matchMedia('(prefers-reduced-motion: reduce)').matches?0:isRunning()?100:150;movement.tick(time,campaign.forcedDirection());
  if(!battle&&!storyActive&&dirty&&time-savedAt>30000&&!$('modal').open&&!busy){savedAt=time;busy=true;save().catch(e=>notice(`Autosave failed: ${e.message}. Export your save.`)).finally(()=>busy=false);}
  const m=campaign.map,tile=24,width=m.ground?480:624,height=m.ground?320:432;if(ctx.canvas.width!==width||ctx.canvas.height!==height){ctx.canvas.width=width;ctx.canvas.height=height;}ctx.imageSmoothingEnabled=false;
  if(m.ground){drawNative(ctx,campaign,pack,facing,time);}else{
  for(let y=0;y<m.height;y++)for(let x=0;x<m.width;x++){
    const t=m.tiles[y][x],px=x*tile,py=y*tile,n=(x*37+y*17)%6;
    rect(px,py,24,24,t==='b'?'#a79770':t==='f'?'#b9c5ab':'#82a45d');
    if(t==='p'||t==='d'){rect(px,py,24,24,'#c9b77e');rect(px+3+n,py+9,3,1,'#b3a06c');}
    if(t==='f'){rect(px,py,24,1,'#9ba991');rect(px,py,1,24,'#9ba991');}
    if(t==='#'){rect(px,py+14,24,10,'#416344');rect(px+9,py+13,6,11,'#695c37');rect(px+2,py+3,20,16,'#294d36');rect(px+5,py,14,18,'#396341');rect(px+7,py+2,9,5,'#597e4a');}
    if(t==='g'){rect(px,py,24,24,'#658e4f');for(let j=0;j<4;j++){const xx=px+3+j*5;rect(xx,py+8+(j%2)*7,1,6,'#3c6d40');rect(xx-1,py+7+(j%2)*7,3,1,'#b2c574');}}
    if(t==='~'){rect(px,py,24,24,'#477e83');rect(px+((Math.floor(time/400)+x)%5),py+7+n,13,1,'#82b3ac');rect(px+6,py+17,9,1,'#649d9a');}
    if(t==='h'){rect(px,py,24,24,m.outdoor?'#86634a':'#5e7a68');rect(px,py+17,24,2,m.outdoor?'#b38c60':'#8b9d7b');}
  }
  for(const e of m.events){const x=e.x*24,y=e.y*24;if(e.kind==='warp'){rect(x+2,y+4,20,18,'#344f42');rect(x+7,y+9,10,13,'#173a30');}else if(e.kind==='heal'){rect(x+2,y+8,20,6,'#b99259');rect(x+4,y+14,3,8,'#5b533b');rect(x+17,y+14,3,8,'#5b533b');}else person(x,y,e.kind==='trainer'?'#b65c4e':'#d9dcc2',false);}
  const p=campaign.state.position;person(p.x*24,p.y*24,'#d9b158',true);
  }
  const weather=fieldWeather(m,campaign.state.party[0]);if(campaign.state.options.weather){
    if(weather==='sun')rect(0,0,624,432,'#ecbd3722');
    if(weather==='rain'){rect(0,0,624,432,'#23537722');for(let i=0;i<70;i++){const x=(i*71+time*.04)%624,y=(i*47+time*.24)%432;rect(x,y,1,7,'#cae0dd77');}}
    if(weather==='sand'||weather==='snow'||weather==='wind'){rect(0,0,624,432,weather==='sand'?'#ccb56b33':'#dbebe322');for(let i=0;i<65;i++)rect((i*53+time*.07)%624,(i*37+time*.015)%432,weather==='wind'?8:2,2,weather==='sand'?'#e5cc98aa':'#f6f6dbaa');}
  }
}
function person(x,y,color,player){rect(x+5,y+19,14,3,'#193e3444');rect(x+8,y+16,3,5,'#293f3b');rect(x+14,y+16,3,5,'#293f3b');rect(x+6,y+9,13,9,color);rect(x+8,y+3,9,8,'#e2ba86');rect(x+6,y+1,13,5,player?'#a94f3c':'#6b6443');if(player)rect(x+(facing[0]<0?6:15),y+6,2,2,'#2c3631');}
async function syncAppSave(){
 const source=await activeAppSave();if(!source)return false;
 if(source.error){notice('Could not reopen your loaded save: '+source.error);return true;}
 try{
  notice('Resuming your loaded Brisk Emerald save…');gbaLayout??=await (await fetch('./gba-layout.json')).json();
  const result=await resumeAppSave(source.bytes,campaign,catalog,pack,gbaLayout);
  if(result.imported){await store.commit(result.campaign.snapshot());campaign=result.campaign;dirty=false;}
  if($('modal').open)close();update();notice(`Resumed ${campaign.state.trainer.name}’s journey from the app save.`);return true;
 }catch(error){notice('Your loaded save could not be resumed: '+error.message+'. The original save is unchanged.');return true;}
}
window.addEventListener('message',event=>{if(event.source===window.parent&&event.data?.type==='brisk-app-save-changed')appSavePending=true;});
async function boot(){
  const json=async url=>{const r=await fetch(url);if(!r.ok)throw new Error('Could not load '+url);return r.json();};
  const [data,content,native,scriptData,fieldData,storyData,wildSprites,metrics]=await Promise.all([json('../brisk-dex-data.json'),json('./content.json'),json('./native-catalog.json'),json('./script-data.json'),json('./field-data.json'),json('./story-data.json'),json('./wild-sprites.json'),json('./font-metrics.json')]);catalog=new Catalog(data,native);catalog.scriptData=scriptData;catalog.fieldData=fieldData;catalog.storyData=storyData;catalog.wildSprites=wildSprites;fontMetrics=metrics;pack=content;storySource=(pack.sharedScripts||'')+'\n'+Object.values(pack.maps).map(m=>m.scriptText||'').join('\n');
  try{const saved=await store.load();if(saved)campaign=migrateCampaign(saved,pack,catalog);}catch(e){notice(`Could not load the saved journey: ${e.message}. Use Restore backup or Import save.`);}
  const resumed=await syncAppSave();
  if(campaign){refreshWildlife(campaign);if(!resumed)notice('Welcome back to your Brisk journey.');update();}else if(!resumed)startSelection();
  // Exposes only a read-only snapshot/disabled bridge for developer integration tests.
  window.BriskNative=Object.freeze({capabilities:bridge.capabilities,snapshot:()=>campaign?bridge.prepareBattle(campaign):null});
  requestAnimationFrame(draw);
}
boot().catch(e=>notice(`Unable to start: ${e.message}`));

$('travel').onclick=()=>{if(!campaign||battle||busy||storyActive)return;modal('Development travel', [...(pack.travel||[]).map(t=>button(pack.maps[t.map].name,()=>{campaign.travel(t.map,t.x,t.y);dirty=true;close();update();})),button('Original field station',()=>{campaign.travel('field',12,10);dirty=true;close();update();})]);};
function openOptions(){
 if(!campaign||battle||busy||storyActive)return;const nodes=[];
 for(const [key,label,values] of [['textSpeed','Text speed',['instant','fast','normal']],['runMode','Running controls',['hold','toggle','always']],['theme','Menu theme',['dark','light']],['trainersTalkOnly','Trainers battle on talk only',[false,true]],['encounters','Wild encounters',[true,false]],['weather','Weather effects',[true,false]],['overworldEncounters','Visible overworld encounters',[true,false]],['wildlifeDensity','Visible Pokémon density',[3,6,9]],['shinyHunt','Fast shiny hunting despawns',[true,false]],['difficulty','Difficulty',['easy','normal','hard','extreme']],['expShare','Modern EXP Share',[true,false]],['battleBag','Battle Bag',[true,false]],['orangeShinies','Orange Islands 1/50',[true,false]],['shinyOdds','Shiny odds',[50,100,128,256,512,1024,2048,4096,8192]]]){
  const row=document.createElement('label');row.textContent=label+' ';const select=document.createElement('select');select.setAttribute('aria-label',label);
  const defaults={textSpeed:'instant',runMode:'hold',theme:'dark',trainersTalkOnly:false,wildlifeDensity:6,shinyHunt:false};for(const value of values){const option=document.createElement('option');option.value=String(value);option.textContent=typeof value==='boolean'?(value?'On':'Off'):String(value);option.selected=(campaign.state.options[key]??defaults[key])===value;select.append(option);}
  select.onchange=()=>{campaign.state.options[key]=values.find(v=>String(v)===select.value);runLatch=false;dirty=true;update();};row.append(select);nodes.push(row);
 }
 nodes.push(button('Rename trainer',async()=>{const name=await textInput('Trainer name',campaign.state.trainer.name);if(name?.trim()){campaign.state.trainer.name=name.trim().slice(0,24);dirty=true;update();openOptions();}}));nodes.push(button('Save options',async()=>{close();await save();}));modal('Options',nodes);
}
function openGameMenu(){if(!campaign||battle||storyActive||busy)return;modal('BRISK EMERALD',[button('Pokémon',()=>modal('Pokémon',campaign.state.party.map(mon=>button(mon.nickname,()=>partyDetails(mon))))),button('Bag',()=>modal('Bag',Object.entries(campaign.state.inventory).filter(([,n])=>n>0).map(([id,n])=>Object.assign(document.createElement('p'),{textContent:`${catalog.data.items[id]} × ${n}`})))),button('Save',async()=>{close();await save();}),button('Options',openOptions),button('Fullscreen',toggleFullscreen),button('Close menu',close)]);$('modal').classList.add('pause');}
async function toggleFullscreen(){
 const surface=document.querySelector('.play');if($('modal').open&&$('modal').classList.contains('pause'))close();if(surface.classList.contains('expanded')){surface.classList.remove('expanded');$('fullscreen').textContent='Fullscreen';return;}if(document.fullscreenElement){await document.exitFullscreen();return;}
 if(surface.requestFullscreen){try{await surface.requestFullscreen();return;}catch{}}
 surface.classList.toggle('expanded');$('fullscreen').textContent=surface.classList.contains('expanded')?'Exit fullscreen':'Fullscreen';
}
function isRunning(){return !!campaign&&campaign.mode==='land'&&(campaign.state.options.runMode==='always'||runLatch||keys.has('Shift')||keys.has('b'));}
$('run').onclick=()=>{runLatch=!runLatch;update(true);$('world').focus();};$('settings').onclick=openOptions;$('pause-menu').onclick=openGameMenu;$('fullscreen').onclick=()=>guard(toggleFullscreen);
document.addEventListener('fullscreenchange',()=>{$('fullscreen').textContent=document.fullscreenElement?'Exit fullscreen':'Fullscreen';});


$('gba-import').onchange=event=>guard(async()=>{
  const file=event.target.files[0];event.target.value='';if(!file)return;if(battle||storyActive||busy)throw new Error('Finish the active interaction first');
  const response=await fetch('./gba-layout.json');if(!response.ok)throw new Error('GBA layout metadata is unavailable');
  notice('Checking GBA save and Pokémon checksums…');const {campaign:candidate,report}=await importGbaSave(new Uint8Array(await file.arrayBuffer()),catalog,pack,await response.json());
  const summary=`Import ${report.party} party Pokémon, ${report.stored} stored Pokémon and the supported bag?\n\n${report.archived.length} entries require archive-only preservation. ${report.adjustments.length} adjustments.\n\n${report.warnings.join('\n\n')}\n\nThe original .sav is retained byte-for-byte. This creates a separate native save. Any current native save becomes its backup.`;
  if(!confirm(summary)){notice('GBA import cancelled. No save was changed.');return;}
  await store.commit(candidate.snapshot());campaign=candidate;dirty=false;update();if($('modal').open)close();modal('GBA import report',summary+(report.archived.length?'\n\nArchive-only entries:\n'+report.archived.map(entry=>JSON.stringify(entry)).join('\n'):''));notice('GBA save imported. Keep your original file.');
});
$('gba-original').onclick=()=>guard(async()=>{if(!campaign)throw new Error('No campaign is loaded');const bytes=await originalGbaBytes(campaign.state),url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'})),a=document.createElement('a');a.href=url;a.download=campaign.state.gbaSource?.report?.container?.compression==='gzip'?'brisk-original-gba.sav.gz':'brisk-original-gba.sav';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});

$('field-moves').onclick=()=>guard(()=>{
 if(!campaign||battle||storyActive||busy)return;
 const nodes=[],state=campaign.state;
 const available=name=>fieldMoveUser(catalog,state,'FIELD_MOVE_'+name)>=0;
 if(available('FLASH')&&campaign.storyInfo.requiresFlash)nodes.push(button('Flash',()=>{state.flashLevel=0;dirty=true;close();notice('The cavern brightened!');}));
 if(available('DIG')&&campaign.storyInfo.allowEscaping&&state.escapeOrigin)nodes.push(button('Dig',async()=>{campaign.enterMap(structuredClone(state.escapeOrigin));dirty=true;close();await enterMap();update();}));
 if(available('TELEPORT')&&campaign.map.outdoor&&state.respawn)nodes.push(button('Teleport',async()=>{campaign.enterMap(structuredClone(state.respawn));dirty=true;close();await enterMap();update();}));
 if(available('FLY')&&campaign.map.outdoor){const destinations=Object.values(pack.maps).filter(m=>/^map_(?:littleroot_town|oldale_town|petalburg_city|rustboro_city|dewford_town|slateport_city|mauville_city|verdanturf_town|fallarbor_town|lavaridge_town|fortree_city|lilycove_city|mossdeep_city|sootopolis_city|pacifidlog_town|ever_grande_city)$/.test(m.id)&&state.flags['FLAG_VISITED_'+m.id.replace('map_','').toUpperCase()]);nodes.push(button('Fly',()=>{close();modal('Fly to a visited town',destinations.map(m=>button(m.name,async()=>{const sourceLanding=Object.values(catalog.storyData.healLocations||{}).find(t=>t.map===m.id),landing=sourceLanding&&campaign.tile(sourceLanding.x,sourceLanding.y,m)!=='~'&&campaign.canOccupy(sourceLanding.x,sourceLanding.y,m,'land')?sourceLanding:pack.travel.find(t=>t.map===m.id);if(!landing)throw Error('No landing here');campaign.enterMap({map:landing.map,x:landing.x,y:landing.y});dirty=true;close();await enterMap();update();})));}));}
 if(!nodes.length){notice('No field moves can be used here yet. Face a tree, rock or boulder and use Interact.');return;}modal('Field moves',nodes);
});
