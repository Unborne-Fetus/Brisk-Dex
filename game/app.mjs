import {Catalog} from './model.mjs';
import {Campaign,fieldWeather,migrateCampaign} from './world.mjs';
import {LocalBattle,supportedMove} from './battle.mjs';
import {SaveStore,encodeSave,decodeSave} from './storage.mjs';
import {loadSprite} from './media.mjs';
import {runInteractiveScript} from './scripts.mjs';
import {drawNative} from './renderer.mjs';
import {IntegrationBridge} from './integrations.mjs';
const $=id=>document.getElementById(id),ctx=$('world').getContext('2d'),store=new SaveStore();
let campaign,battle,battleEvent,pack,catalog,facing=[0,1],lastMove=0,busy=false,dirty=false,savedAt=0,saving=null,storyActive=false,choiceCancel=null;
const keys=new Set(),bridge=new IntegrationBridge();
const notice=text=>$('notice').textContent=text;
const button=(text,fn)=>{const b=document.createElement('button');b.textContent=text;b.onclick=()=>guard(fn);return b;};
async function guard(fn){try{await fn();}catch(e){notice(e.message);}}
function sprite(mon,back=false){const s=catalog.species(mon.species);return '../'+(mon.shiny?(back?s.backShinySprite:s.frontShinySprite):(back?s.backSprite:s.frontSprite));}
function modal(title,content){$('modal-title').textContent=title;$('modal-content').replaceChildren();if(typeof content==='string'){const p=document.createElement('p');p.textContent=content;$('modal-content').append(p);}else $('modal-content').append(...content);$('modal').showModal();}
function close(){ $('modal').close();$('world').focus(); }
$('modal-close').onclick=()=>{if(choiceCancel){const cancel=choiceCancel;choiceCancel=null;close();cancel(null);}else close();};
$('modal').addEventListener('cancel',()=>{if(choiceCancel){const cancel=choiceCancel;choiceCancel=null;cancel(null);}});
function update(){
  if(!campaign)return;
  const s=campaign.state;$('map-name').textContent=campaign.map.name;$('money').textContent=`₽ ${s.money.toLocaleString()}`;
  $('weather').textContent=fieldWeather(campaign.map,s.party[0]).toUpperCase()+(campaign.map.weatherLocked?' · PROTECTED':'');
  $('encounters').checked=s.options.encounters;$('weather-effects').checked=s.options.weather;
  $('party').replaceChildren(...s.party.map((mon,index)=>{
    const row=document.createElement('div');row.className='party-mon';const img=document.createElement('img');loadSprite(img,sprite(mon));img.alt='';
    const info=document.createElement('div'),name=document.createElement('strong');name.textContent=mon.nickname+(mon.shiny?' ✦':'');const sub=document.createElement('small');sub.textContent=`Lv. ${mon.level} · ${mon.ability}`;const hp=document.createElement('progress');hp.value=mon.hp;hp.max=catalog.stats(mon)[0];hp.setAttribute('aria-label',`${mon.hp} of ${hp.max} HP`);info.append(name,sub,hp);
    const action=button('Lead',()=>{if(battle||storyActive)throw new Error('Finish the active interaction first');campaign.setLead(index);dirty=true;update();});action.disabled=index===0||!!battle;const controls=document.createElement('div');controls.className='party-controls';controls.append(action,button('Info',()=>{if(!battle&&!storyActive)partyDetails(mon);}));row.append(img,info,controls);
    row.ondblclick=()=>{if(!battle&&!storyActive)partyDetails(mon);};return row;
  }));
  $('bag').replaceChildren(...Object.entries(s.inventory).filter(([,n])=>n>0).map(([id,n])=>{const p=document.createElement('div');const usable=[28,29,30,31,32,33,34].includes(Number(id))||/^ITEM_EXP_CANDY_/.test(catalog.data.itemDetails[id]?.constant||'');if(usable){p.append(button(`${catalog.data.items[id]} × ${n}`,()=>{if(battle||storyActive)throw new Error('Finish the active interaction first');modal('Use on which Pokémon?',s.party.map(mon=>button(mon.nickname,()=>{const candy=/^ITEM_EXP_CANDY_/.test(catalog.data.itemDetails[id]?.constant||'');let amount=1;if(candy){const input=prompt(`How many? (1–${Math.min(n,99)})`,'1');if(input===null)return;amount=Number(input);}campaign.useFieldItem(Number(id),mon.uid,amount);dirty=true;close();update();growthPrompts();})));}));}else p.textContent=`${catalog.data.items[id]} × ${n}`;return p;}));
  $('world').hidden=!!battle;$('battle').hidden=!battle;
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
function beginBattle(mon,trainer=null,eventId=null){battleEvent=eventId;battle=new LocalBattle(campaign,mon,{trainer});dirty=true;update();}
function renderBattle(){
  for(const [id,mon,back] of [['enemy-card',battle.enemy,false],['player-card',battle.playerView||battle.player,true]]){
    const card=$(id),img=document.createElement('img');loadSprite(img,sprite(mon,back));img.alt=mon.nickname;
    const d=document.createElement('div'),name=document.createElement('strong');name.textContent=`${mon.nickname} · Lv. ${mon.level}`;const hp=document.createElement('progress');hp.max=mon.battleMaxHP||catalog.stats(mon)[0];hp.value=mon.hp;const text=document.createElement('small');text.textContent=`${mon.hp} / ${hp.max} HP`;d.append(name,hp,text);card.replaceChildren(d,img);
  }
  $('battle-log').replaceChildren(...battle.log.slice(-5).map(line=>{const p=document.createElement('div');p.textContent=line;return p;}));$('battle-log').scrollTop=10000;
  const actions=[];
  if(battle.phase!=='battle')actions.push(button('Return to the field',async()=>{
    if(battle.phase==='lost'){campaign.heal();campaign.state.position=structuredClone(campaign.state.respawn||pack.start);notice('Returned to the field station and healed your party.');}
    if(battle.phase==='won'&&battle.trainer&&battleEvent)campaign.state.flags[battleEvent]=true;
    battle=null;update();await save();growthPrompts();
  }));
  else{
    battle.player.moves.forEach((m,i)=>{const move=catalog.move(m.id),b=button(`${move.name} · ${m.pp}/${move.pp}`,()=>act({type:'move',index:i}));b.disabled=!m.pp||!supportedMove(move);actions.push(b);});
    if(!battle.available(battle.player).length)actions.push(button('Struggle',()=>act({type:'move',index:-1})));
    for(const form of battle.gimmicks())actions.push(button(`${form.kind}: ${form.name}`,()=>{const choices=battle.available(battle.player);if(!choices.length)throw new Error('No PP remains');modal('Choose a move',choices.map(index=>button(catalog.move(battle.player.moves[index].id).name,()=>{close();act({type:'move',index,gimmick:form.kind,formIndex:form.index});})));}));
    actions.push(button(`Potion (${campaign.state.inventory[28]||0})`,()=>act({type:'potion'})));
    if(!battle.trainer){actions.push(button(`Poké Ball (${campaign.state.inventory[1]||0})`,()=>act({type:'catch'})),button('Run',()=>act({type:'run'})));}
    campaign.state.party.forEach((mon,i)=>{if(i!==battle.active&&mon.hp>0)actions.push(button(`Switch: ${mon.nickname}`,()=>act({type:'switch',index:i})));});
  }
  $('battle-actions').replaceChildren(...actions);
}
function act(action){battle.act(action);dirty=true;update();}
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
  const e=campaign.interact(...facing);if(!e){notice('Nothing to interact with here. Use a party member’s Info button for details.');return;}
  if(e.kind==='heal'){campaign.heal();if(campaign.map.sourceMap?.includes('POKEMON_CENTER'))campaign.state.respawn=structuredClone(campaign.state.position);dirty=true;notice(e.text);update();await save();}
  else if(e.kind==='dialogue'){
    if(campaign.map.scriptText&&e.sourceScript){try{storyActive=true;const lines=await runInteractiveScript(campaign,campaign.map.scriptText,e.sourceScript,{choose:request=>new Promise(resolve=>{choiceCancel=resolve;modal('Choose',[Object.assign(document.createElement('p'),{textContent:request.message}),...['Yes','No'].map((label,i)=>button(label,()=>{choiceCancel=null;close();resolve(i===0?1:0);}))]);})});storyActive=false;dirty=true;modal('Conversation',lines.join('\n\n')||'There is nothing more to say.');update();}catch(error){storyActive=false;modal('Event awaiting port',e.text+'\n\n'+error.message+'. No story effects were applied.');}}
    else modal('Field notes',e.text);
  }
  else if(e.kind==='trainer'){
    if(campaign.state.flags[e.id]){modal('Rival','Nice battle! Keep exploring while we prepare the rest of Hoenn.');return;}
    modal('A friendly battle',[Object.assign(document.createElement('p'),{textContent:e.text}),button('Battle',()=>{close();beginBattle(e.team?campaign.trainerTeam(e.team):campaign.createMon(e.species,e.level),e.trainerName||'Rival',e.id);})]);
  }else if(e.kind==='shop')modal('Field supplies',e.stock.map(stock=>button(`${catalog.data.items[stock.item]} · ₽${stock.price*({easy:1,normal:2,hard:4,extreme:10}[campaign.state.options.difficulty]||1)}`,()=>{campaign.buy(stock.item,1,e);dirty=true;update();notice(`Bought ${catalog.data.items[stock.item]}.`);})));
}
function move(dx,dy){
  if(!campaign||battle||storyActive||$('modal').open||busy)return;facing=[dx,dy];const result=campaign.move(dx,dy);
  if(result.kind==='encounter'){
    if(campaign.state.party.some(m=>m.hp>0))beginBattle(result.mon);else notice('Your party needs healing. Visit a bench or the lab.');
  }else if(result.kind==='warp')notice(`Entered ${result.map}.`);
  if(result.kind!=='blocked')dirty=true;update();
}
function startSelection(){
  const nodes=['TREECKO','TORCHIC','MUDKIP'].map(constant=>{const id=catalog.id(constant),s=catalog.species(id);const b=button(s.name,async()=>{campaign=Campaign.start(catalog,pack,constant);battle=null;dirty=true;close();update();await save();});b.className='starter';const img=document.createElement('img');loadSprite(img,'../'+s.frontSprite);img.alt='';b.prepend(img);return b;});
  modal('Choose your first partner',nodes);
}
$('save').onclick=()=>guard(save);$('interact').onclick=()=>guard(interact);
$('encounters').onchange=e=>{if(campaign){campaign.state.options.encounters=e.target.checked;dirty=true;}};
$('weather-effects').onchange=e=>{if(campaign){campaign.state.options.weather=e.target.checked;dirty=true;}};
$('export').onclick=()=>guard(async()=>{
  if(!campaign||battle||storyActive)throw new Error('Finish the active interaction before exporting');const envelope=await encodeSave(campaign.snapshot()),url=URL.createObjectURL(new Blob([JSON.stringify(envelope)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='brisk-standalone-save.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('import').onchange=e=>guard(async()=>{
  const file=e.target.files[0];e.target.value='';if(!file)return;if(battle||storyActive)throw new Error('Finish the active interaction before importing');if(file.size>17000000)throw new Error('Save file is too large');
  const candidate=migrateCampaign(await decodeSave(JSON.parse(await file.text())),pack,catalog);
  if(campaign&&!confirm('Replace this journey with the imported save? Your existing saved journey will become the backup.'))return;
  await store.commit(candidate.snapshot());campaign=candidate;dirty=false;update();close();notice('Imported standalone campaign.');
});
$('restore').onclick=()=>guard(async()=>{if(battle||storyActive)throw new Error('Finish the active interaction first');const previous=await store.load('backup');if(!previous)throw new Error('No backup is available yet');const candidate=migrateCampaign(previous,pack,catalog);if(!confirm('Restore the previous saved journey?'))return;await store.commit(candidate.snapshot());campaign=candidate;dirty=false;update();notice('Previous save restored.');});
$('new-game').onclick=()=>{if(battle||storyActive){notice('Finish the active interaction first.');return;}if(!campaign||confirm('Start a new journey? Your current saved journey will become the backup.'))startSelection();};
const directions={ArrowUp:[0,-1],w:[0,-1],ArrowDown:[0,1],s:[0,1],ArrowLeft:[-1,0],a:[-1,0],ArrowRight:[1,0],d:[1,0]};
window.addEventListener('keydown',e=>{if($('modal').open||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;if(directions[e.key]){e.preventDefault();if(!e.repeat){guard(()=>move(...directions[e.key]));lastMove=performance.now();}keys.add(e.key);}if(['e','Enter',' '].includes(e.key)&&e.target.tagName!=='BUTTON'){e.preventDefault();guard(interact);}});
window.addEventListener('keyup',e=>keys.delete(e.key));window.addEventListener('blur',()=>keys.clear());
for(const b of document.querySelectorAll('[data-dir]')){const key={up:'ArrowUp',down:'ArrowDown',left:'ArrowLeft',right:'ArrowRight'}[b.dataset.dir];b.onpointerdown=e=>{e.preventDefault();b.setPointerCapture(e.pointerId);guard(()=>move(...directions[key]));lastMove=performance.now();keys.add(key);};b.onpointerup=b.onpointercancel=b.onlostpointercapture=()=>keys.delete(key);}
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
function rect(x,y,w,h,color){ctx.fillStyle=color;ctx.fillRect(x,y,w,h);}
function draw(time){
  requestAnimationFrame(draw);if(!campaign)return;
  if(time-lastMove>150&&keys.size){const key=[...keys].find(k=>directions[k]);if(key){guard(()=>move(...directions[key]));lastMove=time;}}
  if(!battle&&!storyActive&&dirty&&time-savedAt>30000&&!$('modal').open&&!busy){savedAt=time;busy=true;save().catch(e=>notice(`Autosave failed: ${e.message}. Export your save.`)).finally(()=>busy=false);}
  const m=campaign.map,tile=24;ctx.imageSmoothingEnabled=false;
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
async function boot(){
  const json=async url=>{const r=await fetch(url);if(!r.ok)throw new Error('Could not load '+url);return r.json();};
  const [data,content,native]=await Promise.all([json('../brisk-dex-data.json'),json('./content.json'),json('./native-catalog.json')]);catalog=new Catalog(data,native);pack=content;
  try{const saved=await store.load();if(saved)campaign=migrateCampaign(saved,pack,catalog);}catch(e){notice(`Could not load the saved journey: ${e.message}. Use Restore backup or Import save.`);}
  if(campaign){notice('Welcome back to your Brisk journey.');update();}else startSelection();
  // Exposes only a read-only snapshot/disabled bridge for developer integration tests.
  window.BriskNative=Object.freeze({capabilities:bridge.capabilities,snapshot:()=>campaign?bridge.prepareBattle(campaign):null});
  requestAnimationFrame(draw);
}
boot().catch(e=>notice(`Unable to start: ${e.message}`));

$('travel').onclick=()=>{if(!campaign||battle||busy||storyActive)return;modal('Development travel', [...(pack.travel||[]).map(t=>button(pack.maps[t.map].name,()=>{campaign.travel(t.map,t.x,t.y);dirty=true;close();update();})),button('Original field station',()=>{campaign.travel('field',12,10);dirty=true;close();update();})]);};
$('settings').onclick=()=>{if(!campaign||battle||busy||storyActive)return;const nodes=[];for(const [key,label,values] of [['difficulty','Difficulty',['easy','normal','hard','extreme']],['expShare','Modern EXP Share',[true,false]],['battleBag','Battle Bag',[true,false]],['orangeShinies','Orange Islands 1/50',[true,false]],['shinyOdds','Shiny odds',[50,100,512,1024,4096,8192]]]){const row=document.createElement('label');row.textContent=label+' ';const select=document.createElement('select');for(const value of values){const option=document.createElement('option');option.value=String(value);option.textContent=typeof value==='boolean'?(value?'On':'Off'):String(value);option.selected=campaign.state.options[key]===value;select.append(option);}select.onchange=()=>{const value=values.find(v=>String(v)===select.value);campaign.state.options[key]=value;dirty=true;};row.append(select);nodes.push(row);}nodes.push(button('Rename trainer',()=>{const name=prompt('Trainer name',campaign.state.trainer.name);if(name?.trim()){campaign.state.trainer.name=name.trim().slice(0,24);dirty=true;}}));modal('Journey options',nodes);};
