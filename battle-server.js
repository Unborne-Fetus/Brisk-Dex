const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const rooms = new Map();

function json(res, status, body){
  res.writeHead(status, {
    'Content-Type':'application/json; charset=utf-8',
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'Content-Type',
    'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
    'Cache-Control':'no-store'
  });
  res.end(JSON.stringify(body));
}
function readBody(req){
  return new Promise((resolve,reject)=>{
    let data='';
    req.on('data',chunk=>{
      data += chunk;
      if(data.length > 1024*1024){ reject(new Error('Request too large')); req.destroy(); }
    });
    req.on('end',()=>{ try{ resolve(data ? JSON.parse(data) : {}); }catch(err){ reject(err); } });
    req.on('error',reject);
  });
}
function roomCode(){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out='';
  do{
    out='';
    const bytes=crypto.randomBytes(6);
    for(let i=0;i<6;i++) out += chars[bytes[i] % chars.length];
  }while(rooms.has(out));
  return out;
}
function id(){ return crypto.randomBytes(16).toString('hex'); }
function cleanText(value,max=64){ return String(value||'').replace(/[<>]/g,'').slice(0,max); }
function clamp(n,min,max){ return Math.max(min,Math.min(max,n)); }
function chance(percent){ return Math.random()*100 < percent; }
function choose(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function normalizeName(v){ return String(v||'').toLowerCase().replace(/[^a-z0-9]/g,''); }

function cleanTeam(team){
  if(!Array.isArray(team)) return [];
  return team.slice(0,6).map((mon,index)=>({
    slot:index,
    species:Number(mon.species)||0,
    name:cleanText(mon.name,40)||('Pokémon '+(index+1)),
    level:clamp(Number(mon.level)||50,1,100),
    types:Array.isArray(mon.types)?mon.types.slice(0,2).map(x=>cleanText(x,20)):[],
    ability:cleanText(mon.ability,60),
    item:cleanText(mon.item,60),
    teraType:cleanText(mon.teraType,20),
    transformations:(Array.isArray(mon.transformations)?mon.transformations:[]).slice(0,3).map(form=>({
      kind:['Mega','Gigantamax'].includes(form.kind)?form.kind:'Mega',
      species:Number(form.species)||0,
      name:cleanText(form.name,40),
      types:Array.isArray(form.types)?form.types.slice(0,2).map(x=>cleanText(x,20)):[],
      ability:cleanText(form.ability,60),
      maxHP:Math.max(1,Number(form.maxHP)||1),
      atk:Math.max(1,Number(form.atk)||1),
      def:Math.max(1,Number(form.def)||1),
      speed:Math.max(1,Number(form.speed)||1),
      spAtk:Math.max(1,Number(form.spAtk)||1),
      spDef:Math.max(1,Number(form.spDef)||1)
    })).filter(form=>form.species>0),
    transformed:false, transformedKind:null, originalTypes:null,
    choiceLock:null,lastMoveIndex:null,
    maxHP:Math.max(1,Number(mon.maxHP)||100),
    atk:Math.max(1,Number(mon.atk)||50),
    def:Math.max(1,Number(mon.def)||50),
    speed:Math.max(1,Number(mon.speed)||50),
    spAtk:Math.max(1,Number(mon.spAtk)||50),
    spDef:Math.max(1,Number(mon.spDef)||50),
    status:null,
    statusTurns:0,
    toxicCounter:0,
    stages:{atk:0,def:0,spa:0,spd:0,spe:0,acc:0,eva:0},
    volatile:{protect:false,protectCounter:0,flinch:false,confusion:0,seeded:false,taunt:0,encore:0,encoreMove:null,substitute:0,
      disabledMove:null,disableTurns:0,torment:false,trapped:false,recharge:false,charging:null,destinyBond:false,perish:0,yawn:0,
      aquaRing:false,ingrain:false,healBlock:0,saltCure:false},
    moves:(Array.isArray(mon.moves)?mon.moves:[]).slice(0,4).map(move=>({
      id:Number(move.id)||0,
      name:cleanText(move.name,60)||'Move',
      type:cleanText(move.type,20)||'Normal',
      category:['Physical','Special','Status'].includes(move.category)?move.category:'Status',
      power:Math.max(0,Number(move.power)||0),
      accuracy:clamp(Number(move.accuracy)||100,0,100),
      priority:clamp(Number(move.priority)||0,-7,7),
      pp:Math.max(1,Number(move.pp)||16),
      maxPP:Math.max(1,Number(move.pp)||16)
    }))
  })).filter(mon=>mon.species>0);
}

const TYPE_CHART = {
  Normal:{Rock:.5,Ghost:0,Steel:.5},
  Fire:{Fire:.5,Water:.5,Grass:2,Ice:2,Bug:2,Rock:.5,Dragon:.5,Steel:2},
  Water:{Fire:2,Water:.5,Grass:.5,Ground:2,Rock:2,Dragon:.5},
  Electric:{Water:2,Electric:.5,Grass:.5,Ground:0,Flying:2,Dragon:.5},
  Grass:{Fire:.5,Water:2,Grass:.5,Poison:.5,Ground:2,Flying:.5,Bug:.5,Rock:2,Dragon:.5,Steel:.5},
  Ice:{Fire:.5,Water:.5,Grass:2,Ice:.5,Ground:2,Flying:2,Dragon:2,Steel:.5},
  Fighting:{Normal:2,Ice:2,Poison:.5,Flying:.5,Psychic:.5,Bug:.5,Rock:2,Ghost:0,Dark:2,Steel:2,Fairy:.5},
  Poison:{Grass:2,Poison:.5,Ground:.5,Rock:.5,Ghost:.5,Steel:0,Fairy:2},
  Ground:{Fire:2,Electric:2,Grass:.5,Poison:2,Flying:0,Bug:.5,Rock:2,Steel:2},
  Flying:{Electric:.5,Grass:2,Fighting:2,Bug:2,Rock:.5,Steel:.5},
  Psychic:{Fighting:2,Poison:2,Psychic:.5,Dark:0,Steel:.5},
  Bug:{Fire:.5,Grass:2,Fighting:.5,Poison:.5,Flying:.5,Psychic:2,Ghost:.5,Dark:2,Steel:.5,Fairy:.5},
  Rock:{Fire:2,Ice:2,Fighting:.5,Ground:.5,Flying:2,Bug:2,Steel:.5},
  Ghost:{Normal:0,Psychic:2,Ghost:2,Dark:.5},
  Dragon:{Dragon:2,Steel:.5,Fairy:0},
  Dark:{Fighting:.5,Psychic:2,Ghost:2,Dark:.5,Fairy:.5},
  Steel:{Fire:.5,Water:.5,Electric:.5,Ice:2,Rock:2,Steel:.5,Fairy:2},
  Fairy:{Fire:.5,Fighting:2,Poison:.5,Dragon:2,Dark:2,Steel:.5}
};
function effectiveness(type,types){
  return (types||[]).reduce((m,t)=>m*((TYPE_CHART[type]&&TYPE_CHART[type][t]!==undefined)?TYPE_CHART[type][t]:1),1);
}
function stageMultiplier(stage){
  stage=clamp(Number(stage)||0,-6,6);
  return stage>=0 ? (2+stage)/2 : 2/(2-stage);
}
function accuracyMultiplier(stage){
  stage=clamp(Number(stage)||0,-6,6);
  return stage>=0 ? (3+stage)/3 : 3/(3-stage);
}
function stat(mon,key){
  const map={atk:'atk',def:'def',spa:'spAtk',spd:'spDef',spe:'speed'};
  return Math.max(1,Math.floor((mon[map[key]]||1)*stageMultiplier(mon.stages[key]||0)));
}
function active(player){ return player.team[player.active]; }
function alive(mon){ return !!mon && mon.hp>0; }
function nextAlive(player){ return player.team.findIndex(mon=>mon.hp>0); }
function other(i){ return i===0?1:0; }
function playerIndex(room,playerId){ return room.players.findIndex(p=>p.id===playerId); }
function hasType(mon,type){ return (mon.types||[]).includes(type); }
function hasAbility(mon,name){ return normalizeName(mon.ability)===normalizeName(name); }
function hasItem(mon,name){ return normalizeName(mon.item)===normalizeName(name); }
function log(room,msg){ room.log.push(msg); if(room.log.length>250) room.log.splice(0,room.log.length-250); }

function publicMon(mon){
  return {
    species:mon.species,name:mon.name,level:mon.level,types:mon.types,maxHP:mon.maxHP,hp:mon.hp,
    ability:mon.ability,item:mon.item,teraType:mon.teraType,status:mon.status,stages:mon.stages,volatile:mon.volatile,
    transformed:mon.transformed,transformedKind:mon.transformedKind,choiceLock:mon.choiceLock,lastMoveIndex:mon.lastMoveIndex,transformations:mon.transformations,
    moves:mon.moves.map(m=>({id:m.id,name:m.name,type:m.type,category:m.category,power:m.power,accuracy:m.accuracy,priority:m.priority,pp:m.pp,maxPP:m.maxPP}))
  };
}
function publicRoom(room){
  return {
    code:room.code, phase:room.phase, rules:room.rules, turn:room.turn, winner:room.winner,
    weather:room.weather, weatherTurns:room.weatherTurns, terrain:room.terrain, terrainTurns:room.terrainTurns,
    trickRoom:room.trickRoom, trickRoomTurns:room.trickRoomTurns,
    log:room.log.slice(-100),
    players:room.players.map(p=>({
      name:p.name,ready:p.ready,connected:true,active:p.active,hasChoice:!!p.choice,
      usedMega:p.usedMega,usedGmax:p.usedGmax,usedTera:p.usedTera,
      side:p.side, team:p.team.map(publicMon)
    }))
  };
}

function resetTurnVolatiles(room){
  room.players.forEach(p=>{
    const mon=active(p);
    if(mon){ mon.volatile.protect=false; mon.volatile.flinch=false; }
  });
}
function beginBattle(room){
  room.phase='battle'; room.turn=1; room.weather=null; room.weatherTurns=0; room.terrain=null; room.terrainTurns=0; room.trickRoom=false; room.trickRoomTurns=0;
  room.players.forEach(p=>{
    p.side={stealthRock:false,spikes:0,toxicSpikes:0,stickyWeb:false,reflect:0,lightScreen:0,tailwind:0,wish:null,futureSight:null}; p.usedMega=false;p.usedGmax=false;p.usedTera=false;
    p.team.forEach(mon=>{ mon.hp=mon.maxHP; mon.status=null; mon.choiceLock=null;mon.lastMoveIndex=null;mon.transformed=false;mon.transformedKind=null;mon.originalTypes=null; mon.statusTurns=0; mon.toxicCounter=0; mon.stages={atk:0,def:0,spa:0,spd:0,spe:0,acc:0,eva:0}; mon.volatile={protect:false,protectCounter:0,flinch:false,confusion:0,seeded:false,taunt:0,encore:0,encoreMove:null,substitute:0,
      disabledMove:null,disableTurns:0,torment:false,trapped:false,recharge:false,charging:null,destinyBond:false,perish:0,yawn:0,
      aquaRing:false,ingrain:false,healBlock:0,saltCure:false}; });
    p.active=Math.max(0,p.team.findIndex(mon=>mon.hp>0)); p.choice=null;
  });
  log(room,'Battle started!');
  for(let i=0;i<2;i++) onSwitchIn(room,i);
}
function weatherBoost(room,move){
  if(room.weather==='sun') return move.type==='Fire'?1.5:move.type==='Water'?.5:1;
  if(room.weather==='rain') return move.type==='Water'?1.5:move.type==='Fire'?.5:1;
  return 1;
}
function terrainBoost(room,attacker,move){
  if(room.terrain==='electric' && move.type==='Electric') return 1.3;
  if(room.terrain==='grassy' && move.type==='Grass') return 1.3;
  if(room.terrain==='psychic' && move.type==='Psychic') return 1.3;
  if(room.terrain==='misty' && move.type==='Dragon') return .5;
  return 1;
}
function critChance(move){
  const n=normalizeName(move.name);
  if(['slash','nightslash','leafblade','stoneedge','crosschop','aircutter','crabhammer','razorleaf','psychocut'].includes(n)) return 12.5;
  return 4.167;
}
function damage(room,attacker,defender,move,defenderPlayer){
  if(!move || move.power<=0 || move.category==='Status') return {amount:0,eff:1,crit:false};
  const attackKey=move.category==='Special'?'spa':'atk', defenseKey=move.category==='Special'?'spd':'def';
  let attack=stat(attacker,attackKey), defense=stat(defender,defenseKey);
  if(hasAbility(defender,'Unaware')) attack=attacker[attackKey==='atk'?'atk':'spAtk']||attack;
  if(hasAbility(attacker,'Unaware')) defense=defender[defenseKey==='def'?'def':'spDef']||defense;
  if(move.category==='Physical'&&hasAbility(defender,'Fur Coat'))defense*=2;
  if(move.category==='Physical'&&defender.status&&hasAbility(defender,'Marvel Scale'))defense=Math.floor(defense*1.5);
  if(move.category==='Special'&&hasAbility(defender,'Ice Scales'))defense*=2;
  if(move.category==='Physical'&&attacker.status==='poison'&&hasAbility(attacker,'Toxic Boost'))attack=Math.floor(attack*1.5);
  if(move.category==='Special'&&attacker.status==='burn'&&hasAbility(attacker,'Flare Boost'))attack=Math.floor(attack*1.5);
  let power=move.power;
  const an=normalizeName(attacker.ability), item=normalizeName(attacker.item), mn=normalizeName(move.name);
  let effectiveType=move.type;
  if(an==='normalize')effectiveType='Normal';
  else if(move.type==='Normal'&&an==='aerilate'){effectiveType='Flying';power=Math.floor(power*1.2);}
  else if(move.type==='Normal'&&an==='pixilate'){effectiveType='Fairy';power=Math.floor(power*1.2);}
  else if(move.type==='Normal'&&an==='refrigerate'){effectiveType='Ice';power=Math.floor(power*1.2);}
  else if(move.type==='Normal'&&an==='galvanize'){effectiveType='Electric';power=Math.floor(power*1.2);}
  if((an==='hugepower'||an==='purepower')&&move.category==='Physical') attack*=2;
  if(an==='guts'&&attacker.status&&move.category==='Physical') attack=Math.floor(attack*1.5);
  if(an==='technician'&&power<=60) power=Math.floor(power*1.5);
  if(an==='ironfist'&&PUNCH_MOVES.has(mn))power=Math.floor(power*1.2);
  if(an==='strongjaw'&&BITE_MOVES.has(mn))power=Math.floor(power*1.5);
  if(an==='sharpness'&&SLICING_MOVES.has(mn))power=Math.floor(power*1.5);
  if(an==='megalauncher'&&PULSE_MOVES.has(mn))power=Math.floor(power*1.5);
  if(an==='punkrock'&&SOUND_MOVES.has(mn))power=Math.floor(power*1.3);
  if(an==='toughclaws'&&CONTACT_MOVES.has(mn))power=Math.floor(power*1.3);
  if(an==='reckless'&&RECOIL_MOVES.has(mn))power=Math.floor(power*1.2);
  if((an==='blaze'&&effectiveType==='Fire'||an==='torrent'&&effectiveType==='Water'||an==='overgrow'&&effectiveType==='Grass'||an==='swarm'&&effectiveType==='Bug')&&attacker.hp<=attacker.maxHP/3)power=Math.floor(power*1.5);
  if(an==='sheerforce' && SECONDARY_MOVES.has(mn)) power=Math.floor(power*1.3);
  if(item==='choiceband'&&move.category==='Physical') attack=Math.floor(attack*1.5);
  if(item==='choicespecs'&&move.category==='Special') attack=Math.floor(attack*1.5);
  if(normalizeName(defender.item)==='assaultvest'&&move.category==='Special') defense=Math.floor(defense*1.5);
  if(item==='lifeorb') power=Math.floor(power*1.3);
  if(mn==='knockoff'&&defender.item) power=Math.floor(power*1.5);
  if(item==='muscleband'&&move.category==='Physical') power=Math.floor(power*1.1);
  if(item==='wiseglasses'&&move.category==='Special') power=Math.floor(power*1.1);
  let base=Math.floor((((2*attacker.level/5+2)*power*attack/Math.max(1,defense))/50)+2);
  let stab=1;
  if(attacker.transformedKind==='Tera'){
    const wasOriginal=(attacker.originalTypes||[]).includes(effectiveType), isTera=attacker.teraType===effectiveType;
    if(isTera) stab=wasOriginal?2:1.5;
    else if(wasOriginal) stab=1.5;
  }else if(hasType(attacker,effectiveType)) stab=(an==='adaptability'?2:1.5);
  let eff=effectiveness(effectiveType,defender.types);
  if(!ignoresAbility(attacker)&&hasAbility(defender,'Levitate')&&effectiveType==='Ground') eff=0;
  if(!ignoresAbility(attacker)&&hasAbility(defender,'Flash Fire')&&effectiveType==='Fire') eff=0;
  if(!ignoresAbility(attacker)&&(hasAbility(defender,'Water Absorb')||hasAbility(defender,'Storm Drain'))&&effectiveType==='Water') eff=0;
  if(!ignoresAbility(attacker)&&(hasAbility(defender,'Volt Absorb')||hasAbility(defender,'Lightning Rod'))&&effectiveType==='Electric') eff=0;
  if(!ignoresAbility(attacker)&&hasAbility(defender,'Sap Sipper')&&effectiveType==='Grass') eff=0;
  if(!ignoresAbility(attacker)&&hasAbility(defender,'Earth Eater')&&effectiveType==='Ground')eff=0;
  if(!ignoresAbility(attacker)&&hasAbility(defender,'Well-Baked Body')&&effectiveType==='Fire')eff=0;
  if(!ignoresAbility(attacker)&&hasAbility(defender,'Bulletproof')&&BALL_BOMB_MOVES.has(mn))eff=0;
  if(!ignoresAbility(attacker)&&hasAbility(defender,'Soundproof')&&SOUND_MOVES.has(mn))eff=0;
  if(!ignoresAbility(attacker)&&hasAbility(defender,'Wonder Guard')&&eff<=1) eff=0;
  if(hasAbility(attacker,'Tinted Lens')&&eff>0&&eff<1) eff*=2;
  const crit=chance(critChance(move));
  let modifier=stab*eff*weatherBoost(room,Object.assign({},move,{type:effectiveType}))*terrainBoost(room,attacker,Object.assign({},move,{type:effectiveType}))*(crit?(hasAbility(attacker,'Sniper')?2.25:1.5):1)*((85+Math.floor(Math.random()*16))/100);
  if(item==='expertbelt'&&eff>1)modifier*=1.2;
  if(move.category==='Physical'&&attacker.status==='burn'&&!hasAbility(attacker,'Guts')) modifier*=.5;
  const side=defenderPlayer.side||{};
  if(!crit && ((move.category==='Physical'&&side.reflect>0)||(move.category==='Special'&&side.lightScreen>0))) modifier*=.5;
  if(!ignoresAbility(attacker)&&hasAbility(defender,'Multiscale')&&defender.hp===defender.maxHP) modifier*=.5;
  if(!ignoresAbility(attacker)&&hasAbility(defender,'Thick Fat')&&(effectiveType==='Fire'||effectiveType==='Ice'))modifier*=.5;
  if(!ignoresAbility(attacker)&&hasAbility(defender,'Punk Rock')&&SOUND_MOVES.has(mn))modifier*=.5;
  if(!ignoresAbility(attacker)&&(hasAbility(defender,'Filter')||hasAbility(defender,'Solid Rock')||hasAbility(defender,'Prism Armor'))) if(eff>1) modifier*=.75;
  let amount=Math.max(eff===0?0:1,Math.floor(base*modifier));
  if(hasItem(defender,'Focus Sash')&&defender.hp===defender.maxHP&&amount>=defender.hp){amount=defender.hp-1;defender.item='';}
  if(!ignoresAbility(attacker)&&hasAbility(defender,'Sturdy')&&defender.hp===defender.maxHP&&amount>=defender.hp)amount=defender.hp-1;
  return {amount,eff,crit};
}
function heal(room,mon,amount,source){
  const before=mon.hp; mon.hp=clamp(mon.hp+Math.max(0,Math.floor(amount)),0,mon.maxHP);
  const gained=mon.hp-before;
  if(gained>0) log(room,mon.name+' restored '+gained+' HP'+(source?' with '+source:'')+'.');
  return gained;
}
function hurt(room,mon,amount,source){
  amount=Math.max(0,Math.floor(amount));
  if(amount<=0||mon.hp<=0) return 0;
  mon.hp=Math.max(0,mon.hp-amount);
  log(room,mon.name+' lost '+amount+' HP'+(source?' from '+source:'')+'.');
  return amount;
}
function boost(room,mon,statName,amount){
  if(hasAbility(mon,'Contrary')) amount=-amount;
  if(hasAbility(mon,'Simple')) amount*=2;
  const before=mon.stages[statName]||0, after=clamp(before+amount,-6,6); mon.stages[statName]=after;
  if(after===before) return;
  const names={atk:'Attack',def:'Defense',spa:'Sp. Atk',spd:'Sp. Def',spe:'Speed',acc:'accuracy',eva:'evasion'};
  log(room,mon.name+"'s "+names[statName]+' '+(amount>0?'rose':'fell')+(Math.abs(amount)>=2?' sharply':'')+'!');
  if(amount<0){
    if(hasAbility(mon,'Defiant')){const b=mon.stages.atk;mon.stages.atk=clamp(b+2,-6,6);log(room,mon.name+"'s Defiant sharply raised its Attack!");}
    if(hasAbility(mon,'Competitive')){const b=mon.stages.spa;mon.stages.spa=clamp(b+2,-6,6);log(room,mon.name+"'s Competitive sharply raised its Sp. Atk!");}
  }
}
function canStatus(mon,status){
  if(mon.status) return false;
  if(status==='burn'&&hasType(mon,'Fire')) return false;
  if(status==='poison'&&(hasType(mon,'Poison')||hasType(mon,'Steel'))) return false;
  if(status==='paralysis'&&hasType(mon,'Electric')) return false;
  if(status==='freeze'&&hasType(mon,'Ice')) return false;
  if(hasAbility(mon,'Comatose')) return false;
  if((status==='burn'&&hasAbility(mon,'Water Veil'))||(status==='paralysis'&&hasAbility(mon,'Limber'))||
     ((status==='poison'||status==='toxic')&&hasAbility(mon,'Immunity'))||(status==='sleep'&&(hasAbility(mon,'Insomnia')||hasAbility(mon,'Vital Spirit')))||
     (status==='freeze'&&hasAbility(mon,'Magma Armor'))) return false;
  return true;
}
function setStatus(room,mon,status){
  if(!canStatus(mon,status)) return false;
  mon.status=status; mon.statusTurns=0; if(status==='toxic') mon.toxicCounter=1;
  const label={burn:'burned',poison:'poisoned',toxic:'badly poisoned',paralysis:'paralyzed',sleep:'put to sleep',freeze:'frozen'}[status]||status;
  log(room,mon.name+' was '+label+'!'); return true;
}
function faintCheck(room,pi){
  const p=room.players[pi], mon=active(p);
  if(mon&&mon.hp<=0){
    log(room,mon.name+' fainted!');
    const next=nextAlive(p);
    if(next<0){
      room.phase='finished'; room.winner=other(pi); log(room,room.players[other(pi)].name+' won the battle!');
      return true;
    }
    p.active=next; log(room,p.name+' sent out '+active(p).name+'!'); onSwitchIn(room,pi);
  }
  return false;
}

const CONTACT_MOVES=new Set(['tackle','bodyslam','doubleedge','quickattack','extremespeed','machpunch','bulletpunch','fakeout','closecombat','drainpunch','firepunch','icepunch','thunderpunch','poisonjab','ironhead','zenheadbutt','headbutt','waterfall','aquajet','bravebird','flareblitz','wildcharge','woodhammer','uturn','flipturn','knockoff','crunch','bite','playrough','leafblade','nightslash','suckerpunch','shadowclaw','dragonclaw','outrage','earthquake','highhorsepower','iciclecrash','rockslide','stoneedge']);
const RECHARGE_MOVES=new Set(['hyperbeam','gigaimpact','blastburn','hydrocannon','frenzyplant','rockwrecker','roaroftime','meteorassault','eternabeam']);
const CHARGE_MOVES=new Set(['fly','dig','bounce','phantomforce','shadowforce','skullbash','razorwind','skyattack','solarblade','solarbeam','meteorbeam','electroshot']);
const PUNCH_MOVES=new Set(['bulletpunch','cometpunch','dizzypunch','drainpunch','dynamicpunch','firepunch','focuspunch','hammerarm','icehammer','icepunch','machpunch','megapunch','meteormash','plasmafists','poweruppunch','shadowpunch','skyuppercut','surgingstrikes','thunderpunch','wickedblow']);
const BITE_MOVES=new Set(['bite','crunch','firefang','fishiousrend','hyperfang','icefang','jawlock','poisonfang','psychicfangs','thunderfang']);
const SLICING_MOVES=new Set(['aerialace','aircutter','airslash','bitterblade','ceaselessedge','crosspoison','cut','falseswipe','furycutter','kowtowcleave','leafblade','nightslash','populationbomb','psychocut','razorshell','sacredsword','slash','solarblade','stoneaxe','xscissor']);
const PULSE_MOVES=new Set(['aurasphere','darkpulse','dragonpulse','healpulse','originpulse','terrainpulse','waterpulse']);
const SOUND_MOVES=new Set(['boomburst','bugbuzz','clangingscales','disarmingvoice','echoedvoice','hypervoice','overdrive','partingshot','perishsong','round','snarl','sparklingaria','uproar']);
const BALL_BOMB_MOVES=new Set(['acid spray','aerosol','aurasphere','bulletseed','eggbomb','electroball','energyball','focusblast','gyroball','iceball','magnetbomb','mistball','mudbomb','octazooka','pollenpuff','rockblast','searing shot','seedbomb','shadowball','sludgebomb','weatherball','zapcannon'].map(normalizeName));
const POWDER_MOVES=new Set(['cottonspore','poisonpowder','powder','ragepowder','sleeppowder','spore','stunspore']);
const RECOIL_MOVES=new Set(['doubleedge','bravebird','flareblitz','wildcharge','headsmash','woodhammer','volt tackle','wavecrash','chloroblast'].map(normalizeName));
const BOUNCEABLE_MOVES=new Set(['toxic','willowisp','thunderwave','spore','sleeppowder','hypnosis','sing','confuseray','supersonic','taunt','disable','torment','yawn','healblock','meanlook','block','spiderweb','stealthrock','spikes','toxicspikes','stickyweb','leechseed','charm','growl','leer','screech','tailwhip','metalsound','faketears','scaryface','stringshot']);
function ignoresAbility(attacker){return hasAbility(attacker,'Mold Breaker')||hasAbility(attacker,'Teravolt')||hasAbility(attacker,'Turboblaze');}
function isGrounded(mon){return !hasType(mon,'Flying')&&!hasAbility(mon,'Levitate')&&!hasItem(mon,'Air Balloon');}
function consumeItem(room,mon,reason){if(mon.item){const item=mon.item;mon.item='';log(room,mon.name+' consumed its '+item+(reason?' '+reason:'')+'!');return item;}return '';}
function checkConsumable(room,mon){
  if(!mon||mon.hp<=0||!mon.item)return;
  const item=normalizeName(mon.item);
  if(item==='sitrusberry'&&mon.hp<=mon.maxHP/2){consumeItem(room,mon);heal(room,mon,Math.max(1,Math.floor(mon.maxHP/4)),'Sitrus Berry');}
  else if(item==='oranberry'&&mon.hp<=mon.maxHP/2){consumeItem(room,mon);heal(room,mon,10,'Oran Berry');}
  else if(item==='lumberry'&&(mon.status||mon.volatile.confusion>0)){consumeItem(room,mon);mon.status=null;mon.volatile.confusion=0;log(room,mon.name+' was cured!');}
  else if(item==='cheriberry'&&mon.status==='paralysis'){consumeItem(room,mon);mon.status=null;log(room,mon.name+' was cured of paralysis!');}
  else if(item==='chestoberry'&&mon.status==='sleep'){consumeItem(room,mon);mon.status=null;log(room,mon.name+' woke up!');}
  else if(item==='pechaberry'&&(mon.status==='poison'||mon.status==='toxic')){consumeItem(room,mon);mon.status=null;log(room,mon.name+' was cured of poison!');}
  else if(item==='rawstberry'&&mon.status==='burn'){consumeItem(room,mon);mon.status=null;log(room,mon.name+' was cured of its burn!');}
  else if(item==='aspearberry'&&mon.status==='freeze'){consumeItem(room,mon);mon.status=null;log(room,mon.name+' thawed out!');}
  else if(item==='persimberry'&&mon.volatile.confusion>0){consumeItem(room,mon);mon.volatile.confusion=0;log(room,mon.name+' snapped out of confusion!');}
}
function switchBlocked(room,pi){
  const p=room.players[pi], mon=active(p), foe=active(room.players[other(pi)]);
  if(!mon||!foe)return false;
  if(mon.volatile.trapped||mon.volatile.ingrain)return true;
  if(hasAbility(foe,'Shadow Tag')&&!hasAbility(mon,'Shadow Tag'))return true;
  if(hasAbility(foe,'Arena Trap')&&isGrounded(mon))return true;
  if(hasAbility(foe,'Magnet Pull')&&hasType(mon,'Steel'))return true;
  return false;
}
function effectivePriority(room,pi,move){
  let pr=Number(move.priority)||0;const mon=active(room.players[pi]);
  if(move.category==='Status'&&hasAbility(mon,'Prankster'))pr+=1;
  if(hasAbility(mon,'Gale Wings')&&move.type==='Flying'&&mon.hp===mon.maxHP)pr+=1;
  if(hasAbility(mon,'Triage')&&/heal|drain|kiss|pollenpuff|recover|roost|synthesis|moonlight|morningsun/.test(normalizeName(move.name)))pr+=3;
  return pr;
}
function priorityBlocked(attacker,defender,priority,room){
  if(priority<=0)return false;
  if(room&&room.terrain==='psychic'&&isGrounded(defender))return true;
  return hasAbility(defender,'Dazzling')||hasAbility(defender,'Queenly Majesty')||hasAbility(defender,'Armor Tail');
}
function contactReaction(room,attacker,defender,move,dealt){
  if(hasAbility(attacker,'Long Reach')||!CONTACT_MOVES.has(normalizeName(move.name))||dealt<=0)return;
  if(hasAbility(defender,'Rough Skin')||hasAbility(defender,'Iron Barbs'))hurt(room,attacker,Math.max(1,Math.floor(attacker.maxHP/8)),defender.ability);
  if(hasItem(defender,'Rocky Helmet'))hurt(room,attacker,Math.max(1,Math.floor(attacker.maxHP/6)),'Rocky Helmet');
  if(hasAbility(defender,'Static')&&chance(30))setStatus(room,attacker,'paralysis');
  if(hasAbility(defender,'Flame Body')&&chance(30))setStatus(room,attacker,'burn');
  if(hasAbility(defender,'Poison Point')&&chance(30))setStatus(room,attacker,'poison');
  if(hasAbility(defender,'Effect Spore')&&chance(30)){const st=choose(['paralysis','poison','sleep']);setStatus(room,attacker,st);}
  if(hasAbility(defender,'Cute Charm')&&chance(30)){attacker.volatile.confusion=Math.max(attacker.volatile.confusion,2);log(room,attacker.name+' became infatuated/confused by Cute Charm!');}
}
function onKnockout(room,killer){
  if(!killer||killer.hp<=0)return;
  if(hasAbility(killer,'Moxie'))boost(room,killer,'atk',1);
  if(hasAbility(killer,'Chilling Neigh'))boost(room,killer,'atk',1);
  if(hasAbility(killer,'Grim Neigh'))boost(room,killer,'spa',1);
  if(hasAbility(killer,'Soul-Heart'))boost(room,killer,'spa',1);
  if(hasAbility(killer,'Beast Boost')){
    const stats=[['atk',stat(killer,'atk')],['def',stat(killer,'def')],['spa',stat(killer,'spa')],['spd',stat(killer,'spd')],['spe',stat(killer,'spe')]].sort((a,b)=>b[1]-a[1]);
    boost(room,killer,stats[0][0],1);
  }
}

function applyHazards(room,pi){
  const p=room.players[pi], mon=active(p), side=p.side;
  if(!mon||!side) return;
  if(hasItem(mon,'Heavy-Duty Boots')) return;
  if(side.stealthRock){
    const mult=effectiveness('Rock',mon.types);
    if(mult>0) hurt(room,mon,Math.max(1,Math.floor(mon.maxHP/8*mult)),'Stealth Rock');
  }
  if(side.spikes>0 && isGrounded(mon)){
    const frac=side.spikes===1?1/8:side.spikes===2?1/6:1/4;
    hurt(room,mon,Math.max(1,Math.floor(mon.maxHP*frac)),'Spikes');
  }
  if(side.toxicSpikes>0 && isGrounded(mon)){
    if(hasType(mon,'Poison')) side.toxicSpikes=0;
    else setStatus(room,mon,side.toxicSpikes>=2?'toxic':'poison');
  }
  if(side.stickyWeb && isGrounded(mon)) boost(room,mon,'spe',-1);
}
function onSwitchIn(room,pi){
  const mon=active(room.players[pi]), foe=active(room.players[other(pi)]);
  if(!mon) return;
  applyHazards(room,pi);
  if(mon.hp<=0){ faintCheck(room,pi); return; }
  if(hasAbility(mon,'Intimidate')&&foe&&!hasAbility(foe,'Inner Focus')&&!hasAbility(foe,'Own Tempo')&&!hasAbility(foe,'Oblivious')&&!hasAbility(foe,'Scrappy')) boost(room,foe,'atk',-1);
  if(hasAbility(mon,'Download')&&foe){if(stat(foe,'def')<stat(foe,'spd'))boost(room,mon,'atk',1);else boost(room,mon,'spa',1);}
  if(hasAbility(mon,'Dauntless Shield'))boost(room,mon,'def',1);
  if(hasAbility(mon,'Intrepid Sword'))boost(room,mon,'atk',1);
  if(hasAbility(mon,'Slow Start')){boost(room,mon,'atk',-1);boost(room,mon,'spe',-1);}
  if(hasAbility(mon,'Screen Cleaner')){room.players.forEach(pl=>{pl.side.reflect=0;pl.side.lightScreen=0;});log(room,'Screen Cleaner removed the screens!');}
  if(hasAbility(mon,'Drizzle')){ room.weather='rain';room.weatherTurns=5;log(room,'It started to rain!'); }
  if(hasAbility(mon,'Drought')){ room.weather='sun';room.weatherTurns=5;log(room,'The sunlight turned harsh!'); }
  if(hasAbility(mon,'Sand Stream')){ room.weather='sand';room.weatherTurns=5;log(room,'A sandstorm kicked up!'); }
  if(hasAbility(mon,'Snow Warning')){ room.weather='snow';room.weatherTurns=5;log(room,'It started to snow!'); }
  if(hasAbility(mon,'Electric Surge')){ room.terrain='electric';room.terrainTurns=5;log(room,'Electric Terrain spread across the field!'); }
  if(hasAbility(mon,'Grassy Surge')){ room.terrain='grassy';room.terrainTurns=5;log(room,'Grassy Terrain spread across the field!'); }
  if(hasAbility(mon,'Psychic Surge')){ room.terrain='psychic';room.terrainTurns=5;log(room,'Psychic Terrain spread across the field!'); }
  if(hasAbility(mon,'Misty Surge')){ room.terrain='misty';room.terrainTurns=5;log(room,'Misty Terrain spread across the field!'); }
}
function canAct(room,mon){
  if(mon.volatile.recharge){mon.volatile.recharge=false;log(room,mon.name+' must recharge!');return false;}
  if(mon.volatile.flinch){ log(room,mon.name+' flinched!'); return false; }
  if(mon.status==='sleep'){
    mon.statusTurns++;
    if(mon.statusTurns>=2+Math.floor(Math.random()*3)){ mon.status=null;mon.statusTurns=0;log(room,mon.name+' woke up!'); }
    else { log(room,mon.name+' is fast asleep.'); return false; }
  }
  if(mon.status==='freeze'){
    if(chance(20)){ mon.status=null;log(room,mon.name+' thawed out!'); }
    else { log(room,mon.name+' is frozen solid!'); return false; }
  }
  if(mon.status==='paralysis'&&chance(25)){ log(room,mon.name+' is fully paralyzed!'); return false; }
  if(mon.volatile.confusion>0){
    mon.volatile.confusion--;
    if(mon.volatile.confusion<=0) log(room,mon.name+' snapped out of confusion!');
    else if(chance(33)){
      const self=Math.max(1,Math.floor((((2*mon.level/5+2)*40*stat(mon,'atk')/Math.max(1,stat(mon,'def')))/50)+2));
      hurt(room,mon,self,'confusion'); return false;
    }
  }
  return true;
}
const SECONDARY_MOVES=new Set(['flamethrower','thunderbolt','icebeam','scald','sludgebomb','shadowball','psychic','crunch','ironhead','rockslide','airslash','waterfall','darkpulse','bugbuzz','energyball','flashcannon','moonblast']);
const PROTECT_MOVES=new Set(['protect','detect','kingsshield','spikyshield','banefulbunker','silktrap','burningbulwark']);
const HEAL_MOVES=new Set(['recover','roost','slackoff','softboiled','milkdrink','shoreup','healorder']);
const SETUP={
  swordsdance:[['atk',2]],dragondance:[['atk',1],['spe',1]],nastyplot:[['spa',2]],calmmind:[['spa',1],['spd',1]],
  bulkup:[['atk',1],['def',1]],quiverdance:[['spa',1],['spd',1],['spe',1]],agility:[['spe',2]],rockpolish:[['spe',2]],
  irondefense:[['def',2]],acidarmor:[['def',2]],amnesia:[['spd',2]],workup:[['atk',1],['spa',1]],coil:[['atk',1],['def',1],['acc',1]]
};
function applyStatusMove(room,pi,move){
  const p=room.players[pi], foe=room.players[other(pi)], mon=active(p), target=active(foe), n=normalizeName(move.name);
  if(PROTECT_MOVES.has(n)){
    const success=mon.volatile.protectCounter===0||chance(100/Math.pow(3,mon.volatile.protectCounter));
    if(success){mon.volatile.protect=true;mon.volatile.protectCounter++;log(room,mon.name+' protected itself!');}
    else{mon.volatile.protect=false;mon.volatile.protectCounter=0;log(room,mon.name+"'s protection failed!");}
    return;
  }
  if(HEAL_MOVES.has(n)){ if(mon.volatile.healBlock>0)log(room,mon.name+' is prevented from healing!');else heal(room,mon,Math.floor(mon.maxHP/2),move.name); return; }
  if(SETUP[n]){ SETUP[n].forEach(x=>boost(room,mon,x[0],x[1])); return; }
  if(n==='bellydrum'){ if(mon.hp>mon.maxHP/2){ hurt(room,mon,Math.floor(mon.maxHP/2),'Belly Drum');mon.stages.atk=6;log(room,mon.name+' maximized its Attack!'); } return; }
  if(n==='rest'){ mon.status='sleep';mon.statusTurns=0;heal(room,mon,mon.maxHP,'Rest');log(room,mon.name+' went to sleep!');return; }
  if(n==='substitute'){ const cost=Math.floor(mon.maxHP/4); if(mon.hp>cost){hurt(room,mon,cost,'Substitute');mon.volatile.substitute=cost;log(room,mon.name+' put in a substitute!');}return; }
  if(n==='leechseed'){ if(!hasType(target,'Grass')){target.volatile.seeded=true;log(room,target.name+' was seeded!');} return; }
  if(n==='toxic'){setStatus(room,target,'toxic');return;} if(n==='willowisp'){setStatus(room,target,'burn');return;} if(n==='thunderwave'){setStatus(room,target,'paralysis');return;}
  if(n==='spore'||n==='sleeppowder'||n==='hypnosis'||n==='sing'){setStatus(room,target,'sleep');return;}
  if(n==='confuseray'||n==='supersonic'){target.volatile.confusion=2+Math.floor(Math.random()*4);log(room,target.name+' became confused!');return;}
  if(n==='taunt'){target.volatile.taunt=3;log(room,target.name+' fell for the taunt!');return;}
  if(n==='disable'&&target.lastMoveIndex!==null){target.volatile.disabledMove=target.lastMoveIndex;target.volatile.disableTurns=4;log(room,target.name+"'s last move was disabled!");return;}
  if(n==='torment'){target.volatile.torment=true;log(room,target.name+' was subjected to torment!');return;}
  if(n==='yawn'){target.volatile.yawn=2;log(room,target.name+' grew drowsy!');return;}
  if(n==='destinybond'){mon.volatile.destinyBond=true;log(room,mon.name+' is trying to take its foe down with it!');return;}
  if(n==='perishsong'){mon.volatile.perish=3;target.volatile.perish=3;log(room,'Both Pokémon heard the Perish Song!');return;}
  if(n==='wish'){p.side.wish={turns:2,amount:Math.max(1,Math.floor(mon.maxHP/2))};log(room,mon.name+' made a wish!');return;}
  if(n==='aquaring'){mon.volatile.aquaRing=true;log(room,mon.name+' surrounded itself with a veil of water!');return;}
  if(n==='ingrain'){mon.volatile.ingrain=true;log(room,mon.name+' planted its roots!');return;}
  if(n==='healblock'){target.volatile.healBlock=5;log(room,target.name+" can't heal!");return;}
  if(n==='haze'){[mon,target].forEach(x=>x.stages={atk:0,def:0,spa:0,spd:0,spe:0,acc:0,eva:0});log(room,'All stat changes were eliminated!');return;}
  if(n==='painsplit'){const avg=Math.floor((mon.hp+target.hp)/2);mon.hp=Math.min(mon.maxHP,avg);target.hp=Math.min(target.maxHP,avg);log(room,'The battlers shared their pain!');return;}
  if(n==='trick'||n==='switcheroo'){const tmp=mon.item;mon.item=target.item;target.item=tmp;mon.choiceLock=null;target.choiceLock=null;log(room,'The Pokémon swapped held items!');return;}
  if(n==='skillswap'){const tmp=mon.ability;mon.ability=target.ability;target.ability=tmp;log(room,'The Pokémon swapped abilities!');return;}
  if(n==='meanlook'||n==='block'||n==='spiderweb'){target.volatile.trapped=true;log(room,target.name+' can no longer escape!');return;}
  if(n==='stealthrock'){foe.side.stealthRock=true;log(room,"Pointed stones float around "+foe.name+"'s team!");return;}
  if(n==='spikes'){foe.side.spikes=clamp((foe.side.spikes||0)+1,0,3);log(room,'Spikes were scattered around the opposing team!');return;}
  if(n==='toxicspikes'){foe.side.toxicSpikes=clamp((foe.side.toxicSpikes||0)+1,0,2);log(room,'Toxic Spikes were scattered around the opposing team!');return;}
  if(n==='stickyweb'){foe.side.stickyWeb=true;log(room,'A sticky web was laid out around the opposing team!');return;}
  if(n==='reflect'){p.side.reflect=5;log(room,'Reflect raised '+p.name+"'s team's Defense!");return;}
  if(n==='lightscreen'){p.side.lightScreen=5;log(room,'Light Screen raised '+p.name+"'s team's Sp. Def!");return;}
  if(n==='tailwind'){p.side.tailwind=4;log(room,'The Tailwind blew behind '+p.name+"'s team!");return;}
  if(n==='raindance'){room.weather='rain';room.weatherTurns=5;log(room,'It started to rain!');return;}
  if(n==='sunnyday'){room.weather='sun';room.weatherTurns=5;log(room,'The sunlight turned harsh!');return;}
  if(n==='sandstorm'){room.weather='sand';room.weatherTurns=5;log(room,'A sandstorm kicked up!');return;}
  if(n==='snowscape'||n==='hail'){room.weather='snow';room.weatherTurns=5;log(room,'It started to snow!');return;}
  if(n==='electricterrain'){room.terrain='electric';room.terrainTurns=5;log(room,'Electric Terrain spread across the field!');return;}
  if(n==='grassyterrain'){room.terrain='grassy';room.terrainTurns=5;log(room,'Grassy Terrain spread across the field!');return;}
  if(n==='psychicterrain'){room.terrain='psychic';room.terrainTurns=5;log(room,'Psychic Terrain spread across the field!');return;}
  if(n==='mistyterrain'){room.terrain='misty';room.terrainTurns=5;log(room,'Misty Terrain spread across the field!');return;}
  const drops={growl:['atk',-1],charm:['atk',-2],leer:['def',-1],screech:['def',-2],tailwhip:['def',-1],metalsound:['spd',-2],fakeTears:['spd',-2],scaryFace:['spe',-2],stringshot:['spe',-2]};
  if(drops[n]){boost(room,target,drops[n][0],drops[n][1]);return;}
  log(room,mon.name+' used '+move.name+'. Its special effect is not implemented yet.');
}
function secondaryEffect(room,attacker,defender,move){
  const n=normalizeName(move.name);
  if(n==='flamethrower'&&chance(10)) setStatus(room,defender,'burn');
  else if(n==='thunderbolt'&&chance(10)) setStatus(room,defender,'paralysis');
  else if(n==='icebeam'&&chance(10)) setStatus(room,defender,'freeze');
  else if(n==='scald'&&chance(30)) setStatus(room,defender,'burn');
  else if(n==='sludgebomb'&&chance(30)) setStatus(room,defender,'poison');
  else if(n==='bodyslam'&&chance(30)) setStatus(room,defender,'paralysis');
  else if((n==='ironhead'||n==='rockslide'||n==='airslash'||n==='waterfall'||n==='darkpulse')&&chance(30)) defender.volatile.flinch=true;
  else if(n==='shadowball'&&chance(20)) boost(room,defender,'spd',-1);
  else if(n==='psychic'&&chance(10)) boost(room,defender,'spd',-1);
  else if(n==='crunch'&&chance(20)) boost(room,defender,'def',-1);
  else if(n==='moonblast'&&chance(30)) boost(room,defender,'spa',-1);
}

function clearHazards(side){
  side.stealthRock=false;side.spikes=0;side.toxicSpikes=0;side.stickyWeb=false;
}
function transformMon(room,pi,kind,formIndex){
  const p=room.players[pi], mon=active(p);
  if(!mon||mon.transformed) return false;
  if(kind==='Tera'){
    if(p.usedTera||!mon.teraType||mon.teraType==='None') return false;
    mon.originalTypes=mon.types.slice();
    mon.types=[mon.teraType];
    mon.transformed=true;mon.transformedKind='Tera';p.usedTera=true;
    log(room,mon.name+' Terastallized into the '+mon.teraType+' type!');
    return true;
  }
  const form=mon.transformations[Number(formIndex)||0];
  if(!form||form.kind!==kind) return false;
  if(kind==='Mega'&&p.usedMega) return false;
  if(kind==='Gigantamax'&&p.usedGmax) return false;
  const hpRatio=mon.hp/Math.max(1,mon.maxHP);
  mon.species=form.species; mon.name=form.name||mon.name; mon.types=form.types.length?form.types:mon.types;
  mon.ability=form.ability||mon.ability; mon.maxHP=form.maxHP;mon.atk=form.atk;mon.def=form.def;mon.speed=form.speed;mon.spAtk=form.spAtk;mon.spDef=form.spDef;
  mon.hp=Math.max(1,Math.floor(mon.maxHP*hpRatio));
  mon.transformed=true;mon.transformedKind=kind;
  if(kind==='Mega')p.usedMega=true;else p.usedGmax=true;
  log(room,mon.name+' '+(kind==='Mega'?'Mega Evolved!':'Gigantamaxed!'));
  return true;
}
function randomBenchSlot(player){
  const choices=player.team.map((m,i)=>({m,i})).filter(x=>x.i!==player.active&&x.m.hp>0);
  return choices.length?choose(choices).i:-1;
}
function pivotSwitch(room,pi,preserveStages){
  const p=room.players[pi], slot=randomBenchSlot(p); if(slot<0)return;
  const savedStages=Object.assign({},active(p).stages);
  doSwitch(room,pi,slot);
  if(preserveStages) active(p).stages=savedStages;
}
function moveHitCount(name){
  const n=normalizeName(name);
  if(['doublekick','bonemerang','doublehit','twineedle','dualwingbeat','doubleironbash'].includes(n)) return 2;
  if(['tripleaxel','tripledive'].includes(n)) return 3;
  if(['populationbomb'].includes(n)) return 10;
  if(['bulletseed','rockblast','iciclespear','furyattack','furryswipes','armthrust','pinmissile','watershuriken','tailslap','scaleshot'].includes(n)){
    const r=Math.random(); return r<.375?2:r<.75?3:r<.875?4:5;
  }
  return 1;
}

function resolveAttack(room,pi,choice){
  const p=room.players[pi], foe=room.players[other(pi)], mon=active(p), target=active(foe);
  if(!alive(mon)||!alive(target)) return;
  if(choice.gimmick) transformMon(room,pi,choice.gimmick,choice.formIndex);
  const move=mon.moves[choice.moveIndex]; if(!move){log(room,mon.name+' has no usable move there.');return;}
  if(mon.choiceLock!==null && mon.choiceLock!==choice.moveIndex){log(room,mon.name+" is locked into "+(mon.moves[mon.choiceLock]&&mon.moves[mon.choiceLock].name||'another move')+'!');return;}
  if(mon.volatile.encore>0 && mon.volatile.encoreMove!==null && mon.volatile.encoreMove!==choice.moveIndex){log(room,mon.name+" must repeat "+(mon.moves[mon.volatile.encoreMove]&&mon.moves[mon.volatile.encoreMove].name||'its encored move')+'!');return;}
  if(mon.volatile.disabledMove===choice.moveIndex&&mon.volatile.disableTurns>0){log(room,move.name+' is disabled!');return;}
  if(mon.volatile.torment&&mon.lastMoveIndex===choice.moveIndex){log(room,mon.name+" can't use the same move twice because of Torment!");return;}
  if(move.pp<=0){log(room,move.name+' has no PP left!');return;}
  move.pp=Math.max(0,move.pp-(hasAbility(target,'Pressure')?2:1)); mon.lastMoveIndex=choice.moveIndex;
  if((hasItem(mon,'Choice Band')||hasItem(mon,'Choice Specs')||hasItem(mon,'Choice Scarf'))&&mon.choiceLock===null) mon.choiceLock=choice.moveIndex;
  if(mon.volatile.taunt>0&&move.category==='Status'){log(room,mon.name+" can't use "+move.name+' after the taunt!');return;}
  const movePriority=effectivePriority(room,pi,move);
  if(priorityBlocked(mon,target,movePriority,room)){log(room,target.name+' blocked the priority move!');return;}
  const moveNameKey=normalizeName(move.name);
  if(!PROTECT_MOVES.has(moveNameKey))mon.volatile.protectCounter=0;
  if((hasAbility(mon,'Protean')||hasAbility(mon,'Libero'))&&!mon.transformed&&move.category!=='Status'){mon.types=[move.type];log(room,mon.name+' changed to the '+move.type+' type!');}
  if(CHARGE_MOVES.has(moveNameKey)){
    const instant=(moveNameKey==='solarbeam'||moveNameKey==='solarblade')&&room.weather==='sun';
    if(!instant&&mon.volatile.charging!==choice.moveIndex){mon.volatile.charging=choice.moveIndex;log(room,mon.name+' began charging '+move.name+'!');return;}
    mon.volatile.charging=null;
  }
  if(!canAct(room,mon)){faintCheck(room,pi);return;}
  let accuracy=move.accuracy;
  if(accuracy>0){
    accuracy*=accuracyMultiplier(mon.stages.acc||0)/accuracyMultiplier(target.stages.eva||0);
    if(hasAbility(mon,'Compound Eyes')) accuracy*=1.3;
    if(!chance(clamp(accuracy,1,100))){log(room,mon.name+' used '+move.name+', but it missed!');return;}
  }
  if(move.category==='Status'||move.power<=0){
    log(room,mon.name+' used '+move.name+'!');
    const statusKey=normalizeName(move.name);
    if(POWDER_MOVES.has(statusKey)&&(hasType(target,'Grass')||hasAbility(target,'Overcoat')||hasItem(target,'Safety Goggles'))){log(room,target.name+' is immune to powder moves!');return;}
    if(hasAbility(target,'Good as Gold')&&!ignoresAbility(mon)&&!['haze','trickroom','raindance','sunnyday','sandstorm','snowscape','hail','electricterrain','grassyterrain','psychicterrain','mistyterrain'].includes(statusKey)){log(room,target.name+" is protected by Good as Gold!");return;}
    if(hasAbility(mon,'Prankster')&&hasType(target,'Dark')&&effectivePriority(room,pi,move)>0){log(room,target.name+' is immune to the Prankster move!');return;}
    if(hasAbility(target,'Magic Bounce')&&!ignoresAbility(mon)&&BOUNCEABLE_MOVES.has(normalizeName(move.name))){
      log(room,target.name+' bounced the move back with Magic Bounce!');
      const originalActive=p.active, originalFoe=foe.active;
      applyStatusMove(room,other(pi),move);
      return;
    }
    const statusName=normalizeName(move.name);
    if(statusName==='trickroom'){
      room.trickRoom=!room.trickRoom;room.trickRoomTurns=room.trickRoom?5:0;log(room,'The dimensions twisted!');
    }else if(statusName==='encore'){
      if(target.lastMoveIndex!==null){target.volatile.encoreMove=target.lastMoveIndex;target.volatile.encore=3;log(room,target.name+' received an encore!');}
    }else if(statusName==='roar'||statusName==='whirlwind'||statusName==='dragontail'){
      const slot=randomBenchSlot(foe);if(slot>=0)doSwitch(room,other(pi),slot);
    }else if(statusName==='batonpass'){
      pivotSwitch(room,pi,true);
    }else if(statusName==='defog'){
      clearHazards(p.side);clearHazards(foe.side);foe.side.reflect=0;foe.side.lightScreen=0;log(room,'Defog cleared hazards and screens!');
    }else applyStatusMove(room,pi,move);
    return;
  }
  if(normalizeName(move.name)==='suckerpunch'){
    const foeChoice=foe.choice, foeMove=foeChoice&&foeChoice.type==='move'?target.moves[foeChoice.moveIndex]:null;
    if(!foeMove||foeMove.category==='Status'){log(room,mon.name+"'s Sucker Punch failed!");return;}
  }
  if(target.volatile.protect){log(room,target.name+' protected itself from '+move.name+'!');return;}
  const n=normalizeName(move.name);
  if(n==='futuresight'){
    foe.side.futureSight={turns:3,damage:Math.max(1,Math.floor((((2*mon.level/5+2)*120*stat(mon,'spa')/Math.max(1,stat(target,'spd')))/50)+2))};
    log(room,mon.name+' foresaw an attack!');return;
  }
  if(n==='seismictoss'||n==='nightshade'){const d=Math.min(target.hp,mon.level);target.hp-=d;log(room,mon.name+' used '+move.name+'! '+target.name+' lost '+d+' HP.');faintCheck(room,other(pi));return;}
  if(n==='superfang'||n==='naturesmadness'||n==='ruination'){const d=Math.max(1,Math.floor(target.hp/2));target.hp-=d;log(room,mon.name+' used '+move.name+'! '+target.name+' lost '+d+' HP.');faintCheck(room,other(pi));return;}
  if(n==='endeavor'&&target.hp>mon.hp){const d=target.hp-mon.hp;target.hp=mon.hp;log(room,mon.name+' used Endeavor! '+target.name+' lost '+d+' HP.');}
  const hits=moveHitCount(move.name);
  let dealt=0,lastResult=null,landed=0;
  for(let hitNo=0;hitNo<hits&&target.hp>0;hitNo++){
    const result=damage(room,mon,target,move,foe);lastResult=result;
    if(result.eff===0){
      if(hitNo===0){log(room,mon.name+' used '+move.name+'!');log(room,"It doesn't affect "+target.name+'...');
        if(hasAbility(target,'Water Absorb')&&move.type==='Water')heal(room,target,target.maxHP/4,'Water Absorb');
        if(hasAbility(target,'Dry Skin')&&move.type==='Water')heal(room,target,target.maxHP/4,'Dry Skin');
        if(hasAbility(target,'Volt Absorb')&&move.type==='Electric')heal(room,target,target.maxHP/4,'Volt Absorb');
        if(hasAbility(target,'Motor Drive')&&move.type==='Electric')boost(room,target,'spe',1);
        if(hasAbility(target,'Lightning Rod')&&move.type==='Electric')boost(room,target,'spa',1);
        if(hasAbility(target,'Storm Drain')&&move.type==='Water')boost(room,target,'spa',1);
        if(hasAbility(target,'Sap Sipper')&&move.type==='Grass')boost(room,target,'atk',1);
        if(hasAbility(target,'Earth Eater')&&move.type==='Ground')heal(room,target,target.maxHP/4,'Earth Eater');
        if(hasAbility(target,'Well-Baked Body')&&move.type==='Fire')boost(room,target,'def',2);}
      return;
    }
    let hitDamage=result.amount;
    if(target.volatile.substitute>0){
      const subHit=Math.min(hitDamage,target.volatile.substitute);target.volatile.substitute-=subHit;hitDamage=0;
      if(target.volatile.substitute<=0)log(room,target.name+"'s substitute faded!");
    }else{target.hp=Math.max(0,target.hp-hitDamage);dealt+=hitDamage;}
    landed++;
    if(result.crit)log(room,'A critical hit!');
  }
  log(room,mon.name+' used '+move.name+'! '+target.name+' lost '+dealt+' HP.'+(landed>1?' Hit '+landed+' times!':''));
  if(lastResult&&lastResult.eff>1)log(room,"It's super effective!");else if(lastResult&&lastResult.eff<1)log(room,"It's not very effective...");
  if(target.hp>0)secondaryEffect(room,mon,target,move);
  contactReaction(room,mon,target,move,dealt);
  if(dealt>0&&target.hp>0){
    if(hasAbility(target,'Stamina'))boost(room,target,'def',1);
    if(hasAbility(target,'Weak Armor')&&move.category==='Physical'){boost(room,target,'def',-1);boost(room,target,'spe',2);}
    if(hasAbility(target,'Water Compaction')&&move.type==='Water')boost(room,target,'def',2);
    if(hasAbility(target,'Steam Engine')&&(move.type==='Water'||move.type==='Fire'))boost(room,target,'spe',6);
    if(lastResult&&lastResult.crit&&hasAbility(target,'Anger Point')){target.stages.atk=6;log(room,target.name+"'s Anger Point maximized its Attack!");}
    if(hasAbility(target,'Berserk')&&target.hp<=target.maxHP/2&&target.hp+dealt>target.maxHP/2)boost(room,target,'spa',1);
    if(hasAbility(mon,'Poison Touch')&&CONTACT_MOVES.has(n)&&chance(30))setStatus(room,target,'poison');
  }
  checkConsumable(room,target);checkConsumable(room,mon);
  if(lastResult&&lastResult.eff>1&&hasItem(target,'Weakness Policy')&&target.hp>0){consumeItem(room,target);boost(room,target,'atk',2);boost(room,target,'spa',2);}
  if(RECHARGE_MOVES.has(n)&&mon.hp>0)mon.volatile.recharge=true;
  if(n==='knockoff'&&target.item){log(room,target.name+"'s "+target.item+' was knocked off!');target.item='';}
  if(n==='saltcure'&&target.hp>0){target.volatile.saltCure=true;log(room,target.name+' was salt cured!');}
  if(n==='clearsmog'&&target.hp>0){target.stages={atk:0,def:0,spa:0,spd:0,spe:0,acc:0,eva:0};log(room,target.name+"'s stat changes were eliminated!");}
  if(n==='mortalspin'){clearHazards(p.side);if(target.hp>0)setStatus(room,target,'poison');log(room,mon.name+" cleared its side's hazards!");}
  if(n==='rapidspin'){clearHazards(p.side);boost(room,mon,'spe',1);log(room,mon.name+" cleared its side's hazards!");}
  if(n==='defog'){clearHazards(p.side);clearHazards(foe.side);foe.side.reflect=0;foe.side.lightScreen=0;log(room,'Defog cleared hazards and screens!');}
  if(n==='uturn'||n==='voltswitch'||n==='flipturn')pivotSwitch(room,pi,false);
  if(n==='dragontail'||n==='circlethrow'){const slot=randomBenchSlot(foe);if(slot>=0&&target.hp>0)doSwitch(room,other(pi),slot);}
  if(dealt>0&&(n.includes('drain')||['gigadrain','megadrain','leechlife','drainingkiss','hornleech'].includes(n))) heal(room,mon,Math.max(1,Math.floor(dealt/2)),move.name);
  if(dealt>0&&RECOIL_MOVES.has(n)&&!hasAbility(mon,'Rock Head')&&!hasAbility(mon,'Magic Guard')) hurt(room,mon,Math.max(1,Math.floor(dealt/3)),'recoil');
  if(hasItem(mon,'Life Orb')&&dealt>0&&mon.hp>0&&!hasAbility(mon,'Magic Guard')) hurt(room,mon,Math.max(1,Math.floor(mon.maxHP/10)),'Life Orb');
  if(n==='closecombat'){boost(room,mon,'def',-1);boost(room,mon,'spd',-1);}
  if(n==='superpower'){boost(room,mon,'atk',-1);boost(room,mon,'def',-1);}
  if(n==='overheat'||n==='dracometeor'||n==='leafstorm') boost(room,mon,'spa',-2);
  if(n==='vcreate'){boost(room,mon,'def',-1);boost(room,mon,'spd',-1);boost(room,mon,'spe',-1);}
  if(n==='rapidspin') mon.volatile.seeded=false;
  const targetFainted=target.hp<=0;
  if(targetFainted){onKnockout(room,mon);if(target.volatile.destinyBond&&mon.hp>0){mon.hp=0;log(room,mon.name+' was taken down by Destiny Bond!');}}
  faintCheck(room,other(pi)); faintCheck(room,pi);
}
function effectiveSpeed(room,pi){
  const p=room.players[pi], mon=active(p); if(!mon)return 0;
  let s=stat(mon,'spe');
  if(mon.status==='paralysis'&&!hasAbility(mon,'Quick Feet')) s=Math.floor(s/2);
  if(mon.status&&hasAbility(mon,'Quick Feet'))s=Math.floor(s*1.5);
  if(hasItem(mon,'Choice Scarf')) s=Math.floor(s*1.5);
  if(p.side.tailwind>0) s*=2;
  if(room.weather==='rain'&&hasAbility(mon,'Swift Swim')) s*=2;
  if(room.weather==='sun'&&hasAbility(mon,'Chlorophyll')) s*=2;
  if(room.weather==='sand'&&hasAbility(mon,'Sand Rush')) s*=2;
  if(room.weather==='snow'&&hasAbility(mon,'Slush Rush')) s*=2;
  return s;
}
function doSwitch(room,pi,slot){
  const p=room.players[pi], outgoing=active(p);
  if(outgoing){
    if(hasAbility(outgoing,'Regenerator'))heal(room,outgoing,Math.max(1,Math.floor(outgoing.maxHP/3)),'Regenerator');
    if(hasAbility(outgoing,'Natural Cure')&&outgoing.status){outgoing.status=null;log(room,outgoing.name+"'s Natural Cure healed its status!");}
  }
  if(outgoing){ outgoing.choiceLock=null;outgoing.lastMoveIndex=null;outgoing.stages={atk:0,def:0,spa:0,spd:0,spe:0,acc:0,eva:0}; outgoing.volatile={protect:false,protectCounter:0,flinch:false,confusion:0,seeded:outgoing.volatile.seeded,taunt:0,encore:0,encoreMove:null,substitute:0,
      disabledMove:null,disableTurns:0,torment:false,trapped:false,recharge:false,charging:null,destinyBond:false,perish:0,yawn:0,
      aquaRing:false,ingrain:false,healBlock:0,saltCure:false}; }
  p.active=slot; log(room,p.name+' switched to '+active(p).name+'!'); onSwitchIn(room,pi);
}
function endTurn(room){
  for(let i=0;i<2;i++){
    const p=room.players[i], mon=active(p); if(!alive(mon)) continue;
    if(mon.status==='burn'&&!hasAbility(mon,'Magic Guard')) hurt(room,mon,Math.max(1,Math.floor(mon.maxHP/16)),'its burn');
    else if(mon.status==='poison'&&!hasAbility(mon,'Magic Guard')&&!hasAbility(mon,'Poison Heal')) hurt(room,mon,Math.max(1,Math.floor(mon.maxHP/8)),'poison');
    else if(mon.status==='toxic'&&!hasAbility(mon,'Magic Guard')&&!hasAbility(mon,'Poison Heal')){hurt(room,mon,Math.max(1,Math.floor(mon.maxHP*(mon.toxicCounter||1)/16)),'bad poison');mon.toxicCounter=clamp((mon.toxicCounter||1)+1,1,15);}
    if((mon.status==='poison'||mon.status==='toxic')&&hasAbility(mon,'Poison Heal'))heal(room,mon,Math.max(1,Math.floor(mon.maxHP/8)),'Poison Heal');
    if(mon.volatile.yawn>0&&--mon.volatile.yawn===0)setStatus(room,mon,'sleep');
    if(mon.volatile.perish>0){mon.volatile.perish--;log(room,mon.name+"'s perish count fell to "+mon.volatile.perish+'!');if(mon.volatile.perish===0)mon.hp=0;}
    if(mon.volatile.saltCure&&!hasAbility(mon,'Magic Guard'))hurt(room,mon,Math.max(1,Math.floor(mon.maxHP*(hasType(mon,'Water')||hasType(mon,'Steel')?1/4:1/8))),'Salt Cure');
    if(mon.volatile.seeded&&!hasAbility(mon,'Magic Guard')){
      const dmg=Math.max(1,Math.floor(mon.maxHP/8)); const actual=hurt(room,mon,dmg,'Leech Seed');
      const foe=active(room.players[other(i)]); if(foe&&alive(foe)) heal(room,foe,actual,'Leech Seed');
    }
    if(mon.volatile.aquaRing&&mon.volatile.healBlock<=0)heal(room,mon,Math.max(1,Math.floor(mon.maxHP/16)),'Aqua Ring');
    if(mon.volatile.ingrain&&mon.volatile.healBlock<=0)heal(room,mon,Math.max(1,Math.floor(mon.maxHP/16)),'Ingrain');
    if(hasItem(mon,'Leftovers')&&mon.volatile.healBlock<=0) heal(room,mon,Math.max(1,Math.floor(mon.maxHP/16)),'Leftovers');
    if(hasItem(mon,'Black Sludge')) hasType(mon,'Poison')?heal(room,mon,Math.max(1,Math.floor(mon.maxHP/16)),'Black Sludge'):hurt(room,mon,Math.max(1,Math.floor(mon.maxHP/8)),'Black Sludge');
    if(room.terrain==='grassy') heal(room,mon,Math.max(1,Math.floor(mon.maxHP/16)),'Grassy Terrain');
    if(room.weather==='sand'&&!hasType(mon,'Rock')&&!hasType(mon,'Ground')&&!hasType(mon,'Steel')&&!hasAbility(mon,'Magic Guard')&&!hasAbility(mon,'Overcoat')&&!hasAbility(mon,'Sand Force')&&!hasAbility(mon,'Sand Rush')&&!hasAbility(mon,'Sand Veil')) hurt(room,mon,Math.max(1,Math.floor(mon.maxHP/16)),'the sandstorm');
    if(room.weather==='rain'&&hasAbility(mon,'Rain Dish')&&mon.volatile.healBlock<=0)heal(room,mon,Math.max(1,Math.floor(mon.maxHP/16)),'Rain Dish');
    if(room.weather==='snow'&&hasAbility(mon,'Ice Body')&&mon.volatile.healBlock<=0)heal(room,mon,Math.max(1,Math.floor(mon.maxHP/16)),'Ice Body');
    if(room.weather==='sun'&&hasAbility(mon,'Solar Power'))hurt(room,mon,Math.max(1,Math.floor(mon.maxHP/8)),'Solar Power');
    if(hasAbility(mon,'Dry Skin')){
      if(room.weather==='rain'&&mon.volatile.healBlock<=0)heal(room,mon,Math.max(1,Math.floor(mon.maxHP/8)),'Dry Skin');
      else if(room.weather==='sun')hurt(room,mon,Math.max(1,Math.floor(mon.maxHP/8)),'Dry Skin');
    }
    if(hasAbility(mon,'Speed Boost'))boost(room,mon,'spe',1);
    if(hasAbility(mon,'Shed Skin')&&mon.status&&chance(33)){mon.status=null;log(room,mon.name+"'s Shed Skin cured its status!");}
    if(hasAbility(mon,'Hydration')&&mon.status&&room.weather==='rain'){mon.status=null;log(room,mon.name+"'s Hydration cured its status!");}
    p.side.reflect=Math.max(0,p.side.reflect-1);p.side.lightScreen=Math.max(0,p.side.lightScreen-1);p.side.tailwind=Math.max(0,p.side.tailwind-1);
    if(mon.volatile.taunt>0) mon.volatile.taunt--;
    if(mon.volatile.disableTurns>0&&--mon.volatile.disableTurns===0)mon.volatile.disabledMove=null;
    if(mon.volatile.healBlock>0)mon.volatile.healBlock--;
    mon.volatile.destinyBond=false;
    checkConsumable(room,mon);
    if(mon.volatile.encore>0 && --mon.volatile.encore===0) mon.volatile.encoreMove=null;
  }
  room.players.forEach((p,i)=>{
    if(p.side.wish&&--p.side.wish.turns===0){const m=active(p);if(m&&m.hp>0)heal(room,m,p.side.wish.amount,'Wish');p.side.wish=null;}
    if(p.side.futureSight&&--p.side.futureSight.turns===0){const foe=active(room.players[other(i)]);if(foe&&foe.hp>0)hurt(room,foe,p.side.futureSight.damage,'Future Sight');p.side.futureSight=null;}
  });
  faintCheck(room,0); if(room.phase==='battle') faintCheck(room,1);
  if(room.weatherTurns>0&&--room.weatherTurns===0){log(room,'The weather returned to normal.');room.weather=null;}
  if(room.terrainTurns>0&&--room.terrainTurns===0){log(room,'The terrain returned to normal.');room.terrain=null;}
  if(room.trickRoomTurns>0&&--room.trickRoomTurns===0){room.trickRoom=false;log(room,'The twisted dimensions returned to normal.');}
  resetTurnVolatiles(room);
}
function resolveTurn(room){
  const choices=room.players.map(p=>p.choice); if(choices.some(c=>!c)) return;
  const switchers=[0,1].filter(i=>choices[i].type==='switch');
  switchers.forEach(i=>{ if(room.phase==='battle') doSwitch(room,i,Number(choices[i].slot)); });
  if(room.phase==='battle'){
    const attackers=[0,1].filter(i=>choices[i].type==='move');
    attackers.sort((a,b)=>{
      const ma=active(room.players[a]).moves[choices[a].moveIndex]||{}, mb=active(room.players[b]).moves[choices[b].moveIndex]||{};
      const pa=effectivePriority(room,a,ma),pb=effectivePriority(room,b,mb);
      if(pa!==pb) return pb-pa;
      const sa=effectiveSpeed(room,a),sb=effectiveSpeed(room,b);
      return (room.trickRoom?sa-sb:sb-sa) || (Math.random()<.5?-1:1);
    });
    for(const i of attackers){ if(room.phase==='battle'&&alive(active(room.players[i]))) resolveAttack(room,i,choices[i]); }
  }
  room.players.forEach(p=>p.choice=null);
  if(room.phase==='battle'){ endTurn(room); if(room.phase==='battle') room.turn++; }
}

setInterval(()=>{
  const cutoff=Date.now()-6*60*60*1000;
  for(const [key,room] of rooms) if(room.updatedAt<cutoff) rooms.delete(key);
},15*60*1000).unref();

const server=http.createServer(async (req,res)=>{
  if(req.method==='OPTIONS') return json(res,204,{});
  const url=new URL(req.url,'http://localhost');
  try{
    if(req.method==='GET'&&url.pathname==='/health') return json(res,200,{ok:true,rooms:rooms.size,engine:'advanced-v6'});
    if(req.method==='POST'&&url.pathname==='/rooms'){
      const body=await readBody(req), code=roomCode(), playerId=id(), team=cleanTeam(body.team);
      if(!team.length) return json(res,400,{error:'Load a save with at least one party Pokémon first.'});
      const room={code,phase:'lobby',turn:0,winner:null,createdAt:Date.now(),updatedAt:Date.now(),log:[],weather:null,weatherTurns:0,terrain:null,terrainTurns:0,
        rules:{format:'singles',teamSize:Math.max(1,Math.min(6,Number(body.rules&&body.rules.teamSize)||6))},
        players:[{id:playerId,name:cleanText(body.name,24)||'Host',team,ready:false,active:0,choice:null,side:{}}]};
      rooms.set(code,room); return json(res,200,{code,playerId,playerIndex:0,room:publicRoom(room)});
    }
    const match=url.pathname.match(/^\/rooms\/([A-Z0-9]{6})(?:\/(join|action))?$/);
    if(!match) return json(res,404,{error:'Not found'});
    const room=rooms.get(match[1]); if(!room) return json(res,404,{error:'Room not found or expired.'});
    room.updatedAt=Date.now();
    if(req.method==='GET'&&!match[2]){
      const playerId=url.searchParams.get('playerId'); const pi=playerIndex(room,playerId);
      if(pi<0) return json(res,403,{error:'Invalid player token.'});
      return json(res,200,{room:publicRoom(room),playerIndex:pi});
    }
    if(req.method==='POST'&&match[2]==='join'){
      if(room.players.length>=2) return json(res,409,{error:'This room is full.'});
      if(room.phase!=='lobby') return json(res,409,{error:'This battle already started.'});
      const body=await readBody(req), team=cleanTeam(body.team); if(!team.length) return json(res,400,{error:'Load a save with at least one party Pokémon first.'});
      const playerId=id(); room.players.push({id:playerId,name:cleanText(body.name,24)||'Challenger',team,ready:false,active:0,choice:null,side:{}});
      log(room,room.players[1].name+' joined the room.'); return json(res,200,{code:room.code,playerId,playerIndex:1,room:publicRoom(room)});
    }
    if(req.method==='POST'&&match[2]==='action'){
      const body=await readBody(req), pi=playerIndex(room,body.playerId); if(pi<0) return json(res,403,{error:'Invalid player token.'});
      const p=room.players[pi];
      if(body.type==='forfeit'&&room.phase==='battle'){
        room.phase='finished';room.winner=other(pi);log(room,p.name+' forfeited. '+room.players[other(pi)].name+' won the battle!');room.players.forEach(x=>x.choice=null);
      }else if(body.type==='ready'&&room.phase==='lobby'){
        p.ready=!!body.ready; if(room.players.length===2&&room.players.every(x=>x.ready)) beginBattle(room);
      }else if(body.type==='move'&&room.phase==='battle'){
        if(p.choice) return json(res,409,{error:'You already selected an action this turn.'});
        const idx=Number(body.moveIndex); const mon=active(p);
        if(!Number.isInteger(idx)||idx<0||idx>=mon.moves.length) return json(res,400,{error:'Invalid move.'});
        if(mon.moves[idx].pp<=0) return json(res,400,{error:'That move has no PP left.'});
        if(mon.choiceLock!==null&&mon.choiceLock!==idx) return json(res,400,{error:'That Pokémon is locked into another move.'});
        if(mon.volatile.encore>0&&mon.volatile.encoreMove!==null&&mon.volatile.encoreMove!==idx) return json(res,400,{error:'That Pokémon must repeat its encored move.'});
        if(mon.volatile.disabledMove===idx&&mon.volatile.disableTurns>0)return json(res,400,{error:'That move is disabled.'});
        if(mon.volatile.torment&&mon.lastMoveIndex===idx)return json(res,400,{error:'Torment prevents repeating that move.'});
        const gimmick=['Mega','Gigantamax','Tera'].includes(body.gimmick)?body.gimmick:null;
        p.choice={type:'move',moveIndex:idx,gimmick:gimmick,formIndex:Number(body.formIndex)||0}; resolveTurn(room);
      }else if(body.type==='switch'&&room.phase==='battle'){
        if(p.choice) return json(res,409,{error:'You already selected an action this turn.'});
        const slot=Number(body.slot);
        if(switchBlocked(room,pi))return json(res,400,{error:'This Pokémon is trapped and cannot switch.'});
        if(!Number.isInteger(slot)||!p.team[slot]||p.team[slot].hp<=0||slot===p.active) return json(res,400,{error:'Invalid switch.'});
        p.choice={type:'switch',slot}; resolveTurn(room);
      }else return json(res,400,{error:'That action is not available right now.'});
      return json(res,200,{room:publicRoom(room),playerIndex:pi});
    }
    return json(res,405,{error:'Method not allowed'});
  }catch(err){ return json(res,400,{error:err.message||String(err)}); }
});
server.listen(PORT,HOST,()=>console.log('Brisk battle relay listening on http://'+HOST+':'+PORT+' (advanced-v6)'));
