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
    volatile:{protect:false,flinch:false,confusion:0,seeded:false,taunt:0,encore:0,encoreMove:null,substitute:0},
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
    transformed:mon.transformed,transformedKind:mon.transformedKind,choiceLock:mon.choiceLock,transformations:mon.transformations,
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
    p.side={stealthRock:false,spikes:0,toxicSpikes:0,stickyWeb:false,reflect:0,lightScreen:0,tailwind:0}; p.usedMega=false;p.usedGmax=false;p.usedTera=false;
    p.team.forEach(mon=>{ mon.hp=mon.maxHP; mon.status=null; mon.choiceLock=null;mon.lastMoveIndex=null;mon.transformed=false;mon.transformedKind=null;mon.originalTypes=null; mon.statusTurns=0; mon.toxicCounter=0; mon.stages={atk:0,def:0,spa:0,spd:0,spe:0,acc:0,eva:0}; mon.volatile={protect:false,flinch:false,confusion:0,seeded:false,taunt:0,encore:0,encoreMove:null,substitute:0}; });
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
  let power=move.power;
  const an=normalizeName(attacker.ability), item=normalizeName(attacker.item), mn=normalizeName(move.name);
  if((an==='hugepower'||an==='purepower')&&move.category==='Physical') attack*=2;
  if(an==='guts'&&attacker.status&&move.category==='Physical') attack=Math.floor(attack*1.5);
  if(an==='technician'&&power<=60) power=Math.floor(power*1.5);
  if(an==='sheerforce' && SECONDARY_MOVES.has(mn)) power=Math.floor(power*1.3);
  if(item==='choiceband'&&move.category==='Physical') attack=Math.floor(attack*1.5);
  if(item==='choicespecs'&&move.category==='Special') attack=Math.floor(attack*1.5);
  if(item==='lifeorb') power=Math.floor(power*1.3);
  if(mn==='knockoff'&&defender.item) power=Math.floor(power*1.5);
  if(item==='muscleband'&&move.category==='Physical') power=Math.floor(power*1.1);
  if(item==='wiseglasses'&&move.category==='Special') power=Math.floor(power*1.1);
  let base=Math.floor((((2*attacker.level/5+2)*power*attack/Math.max(1,defense))/50)+2);
  let stab=1;
  if(attacker.transformedKind==='Tera'){
    const wasOriginal=(attacker.originalTypes||[]).includes(move.type), isTera=attacker.teraType===move.type;
    if(isTera) stab=wasOriginal?2:1.5;
    else if(wasOriginal) stab=1.5;
  }else if(hasType(attacker,move.type)) stab=(an==='adaptability'?2:1.5);
  let eff=effectiveness(move.type,defender.types);
  if(hasAbility(defender,'Levitate')&&move.type==='Ground') eff=0;
  if(hasAbility(defender,'Flash Fire')&&move.type==='Fire') eff=0;
  if((hasAbility(defender,'Water Absorb')||hasAbility(defender,'Storm Drain'))&&move.type==='Water') eff=0;
  if((hasAbility(defender,'Volt Absorb')||hasAbility(defender,'Lightning Rod'))&&move.type==='Electric') eff=0;
  if(hasAbility(defender,'Sap Sipper')&&move.type==='Grass') eff=0;
  if(hasAbility(defender,'Wonder Guard')&&eff<=1) eff=0;
  const crit=chance(critChance(move));
  let modifier=stab*eff*weatherBoost(room,move)*terrainBoost(room,attacker,move)*(crit?1.5:1)*((85+Math.floor(Math.random()*16))/100);
  if(move.category==='Physical'&&attacker.status==='burn'&&!hasAbility(attacker,'Guts')) modifier*=.5;
  const side=defenderPlayer.side||{};
  if(!crit && ((move.category==='Physical'&&side.reflect>0)||(move.category==='Special'&&side.lightScreen>0))) modifier*=.5;
  if(hasAbility(defender,'Multiscale')&&defender.hp===defender.maxHP) modifier*=.5;
  if(hasAbility(defender,'Filter')||hasAbility(defender,'Solid Rock')) if(eff>1) modifier*=.75;
  let amount=Math.max(eff===0?0:1,Math.floor(base*modifier));
  if(hasItem(defender,'Focus Sash')&&defender.hp===defender.maxHP&&amount>=defender.hp) amount=defender.hp-1;
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
  const before=mon.stages[statName]||0, after=clamp(before+amount,-6,6); mon.stages[statName]=after;
  if(after===before) return;
  const names={atk:'Attack',def:'Defense',spa:'Sp. Atk',spd:'Sp. Def',spe:'Speed',acc:'accuracy',eva:'evasion'};
  log(room,mon.name+"'s "+names[statName]+' '+(amount>0?'rose':'fell')+(Math.abs(amount)>=2?' sharply':'')+'!');
}
function canStatus(mon,status){
  if(mon.status) return false;
  if(status==='burn'&&hasType(mon,'Fire')) return false;
  if(status==='poison'&&(hasType(mon,'Poison')||hasType(mon,'Steel'))) return false;
  if(status==='paralysis'&&hasType(mon,'Electric')) return false;
  if(status==='freeze'&&hasType(mon,'Ice')) return false;
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
function applyHazards(room,pi){
  const p=room.players[pi], mon=active(p), side=p.side;
  if(!mon||!side) return;
  if(side.stealthRock){
    const mult=effectiveness('Rock',mon.types);
    if(mult>0) hurt(room,mon,Math.max(1,Math.floor(mon.maxHP/8*mult)),'Stealth Rock');
  }
  if(side.spikes>0 && !hasType(mon,'Flying') && !hasAbility(mon,'Levitate')){
    const frac=side.spikes===1?1/8:side.spikes===2?1/6:1/4;
    hurt(room,mon,Math.max(1,Math.floor(mon.maxHP*frac)),'Spikes');
  }
  if(side.toxicSpikes>0 && !hasType(mon,'Flying') && !hasAbility(mon,'Levitate')){
    if(hasType(mon,'Poison')) side.toxicSpikes=0;
    else setStatus(room,mon,side.toxicSpikes>=2?'toxic':'poison');
  }
  if(side.stickyWeb && !hasType(mon,'Flying') && !hasAbility(mon,'Levitate')) boost(room,mon,'spe',-1);
}
function onSwitchIn(room,pi){
  const mon=active(room.players[pi]), foe=active(room.players[other(pi)]);
  if(!mon) return;
  applyHazards(room,pi);
  if(mon.hp<=0){ faintCheck(room,pi); return; }
  if(hasAbility(mon,'Intimidate')&&foe) boost(room,foe,'atk',-1);
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
  if(PROTECT_MOVES.has(n)){ mon.volatile.protect=true; log(room,mon.name+' protected itself!'); return; }
  if(HEAL_MOVES.has(n)){ heal(room,mon,Math.floor(mon.maxHP/2),move.name); return; }
  if(SETUP[n]){ SETUP[n].forEach(x=>boost(room,mon,x[0],x[1])); return; }
  if(n==='bellydrum'){ if(mon.hp>mon.maxHP/2){ hurt(room,mon,Math.floor(mon.maxHP/2),'Belly Drum');mon.stages.atk=6;log(room,mon.name+' maximized its Attack!'); } return; }
  if(n==='rest'){ mon.status='sleep';mon.statusTurns=0;heal(room,mon,mon.maxHP,'Rest');log(room,mon.name+' went to sleep!');return; }
  if(n==='substitute'){ const cost=Math.floor(mon.maxHP/4); if(mon.hp>cost){hurt(room,mon,cost,'Substitute');mon.volatile.substitute=cost;log(room,mon.name+' put in a substitute!');}return; }
  if(n==='leechseed'){ if(!hasType(target,'Grass')){target.volatile.seeded=true;log(room,target.name+' was seeded!');} return; }
  if(n==='toxic'){setStatus(room,target,'toxic');return;} if(n==='willowisp'){setStatus(room,target,'burn');return;} if(n==='thunderwave'){setStatus(room,target,'paralysis');return;}
  if(n==='spore'||n==='sleeppowder'||n==='hypnosis'||n==='sing'){setStatus(room,target,'sleep');return;}
  if(n==='confuseray'||n==='supersonic'){target.volatile.confusion=2+Math.floor(Math.random()*4);log(room,target.name+' became confused!');return;}
  if(n==='taunt'){target.volatile.taunt=3;log(room,target.name+' fell for the taunt!');return;}
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
  if(move.pp<=0){log(room,move.name+' has no PP left!');return;} move.pp--; mon.lastMoveIndex=choice.moveIndex;
  if((hasItem(mon,'Choice Band')||hasItem(mon,'Choice Specs')||hasItem(mon,'Choice Scarf'))&&mon.choiceLock===null) mon.choiceLock=choice.moveIndex;
  if(mon.volatile.taunt>0&&move.category==='Status'){log(room,mon.name+" can't use "+move.name+' after the taunt!');return;}
  if(!canAct(room,mon)){faintCheck(room,pi);return;}
  let accuracy=move.accuracy;
  if(accuracy>0){
    accuracy*=accuracyMultiplier(mon.stages.acc||0)/accuracyMultiplier(target.stages.eva||0);
    if(hasAbility(mon,'Compound Eyes')) accuracy*=1.3;
    if(!chance(clamp(accuracy,1,100))){log(room,mon.name+' used '+move.name+', but it missed!');return;}
  }
  if(move.category==='Status'||move.power<=0){
    log(room,mon.name+' used '+move.name+'!');
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
  if(target.volatile.protect){log(room,target.name+' protected itself from '+move.name+'!');return;}
  const n=normalizeName(move.name), hits=moveHitCount(move.name);
  let dealt=0,lastResult=null,landed=0;
  for(let hitNo=0;hitNo<hits&&target.hp>0;hitNo++){
    const result=damage(room,mon,target,move,foe);lastResult=result;
    if(result.eff===0){
      if(hitNo===0){log(room,mon.name+' used '+move.name+'!');log(room,"It doesn't affect "+target.name+'...');
        if(hasAbility(target,'Water Absorb')&&move.type==='Water')heal(room,target,target.maxHP/4,'Water Absorb');
        if(hasAbility(target,'Volt Absorb')&&move.type==='Electric')heal(room,target,target.maxHP/4,'Volt Absorb');
        if(hasAbility(target,'Sap Sipper')&&move.type==='Grass')boost(room,target,'atk',1);}
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
  if(n==='knockoff'&&target.item){log(room,target.name+"'s "+target.item+' was knocked off!');target.item='';}
  if(n==='rapidspin'){clearHazards(p.side);boost(room,mon,'spe',1);log(room,mon.name+" cleared its side's hazards!");}
  if(n==='defog'){clearHazards(p.side);clearHazards(foe.side);foe.side.reflect=0;foe.side.lightScreen=0;log(room,'Defog cleared hazards and screens!');}
  if(n==='uturn'||n==='voltswitch'||n==='flipturn')pivotSwitch(room,pi,false);
  if(n==='dragontail'||n==='circlethrow'){const slot=randomBenchSlot(foe);if(slot>=0&&target.hp>0)doSwitch(room,other(pi),slot);}
  if(dealt>0&&(n.includes('drain')||['gigadrain','megadrain','leechlife','drainingkiss','hornleech'].includes(n))) heal(room,mon,Math.max(1,Math.floor(dealt/2)),move.name);
  if(dealt>0&&['doubleedge','bravebird','flareblitz','wildcharge','headsmash','woodhammer'].includes(n)) hurt(room,mon,Math.max(1,Math.floor(dealt/3)),'recoil');
  if(hasItem(mon,'Life Orb')&&dealt>0&&mon.hp>0) hurt(room,mon,Math.max(1,Math.floor(mon.maxHP/10)),'Life Orb');
  if(n==='closecombat'){boost(room,mon,'def',-1);boost(room,mon,'spd',-1);}
  if(n==='superpower'){boost(room,mon,'atk',-1);boost(room,mon,'def',-1);}
  if(n==='overheat'||n==='dracometeor'||n==='leafstorm') boost(room,mon,'spa',-2);
  if(n==='vcreate'){boost(room,mon,'def',-1);boost(room,mon,'spd',-1);boost(room,mon,'spe',-1);}
  if(n==='rapidspin') mon.volatile.seeded=false;
  faintCheck(room,other(pi)); faintCheck(room,pi);
}
function effectiveSpeed(room,pi){
  const p=room.players[pi], mon=active(p); if(!mon)return 0;
  let s=stat(mon,'spe');
  if(mon.status==='paralysis') s=Math.floor(s/2);
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
  if(outgoing){ outgoing.choiceLock=null;outgoing.lastMoveIndex=null;outgoing.stages={atk:0,def:0,spa:0,spd:0,spe:0,acc:0,eva:0}; outgoing.volatile={protect:false,flinch:false,confusion:0,seeded:outgoing.volatile.seeded,taunt:0,encore:0,encoreMove:null,substitute:0}; }
  p.active=slot; log(room,p.name+' switched to '+active(p).name+'!'); onSwitchIn(room,pi);
}
function endTurn(room){
  for(let i=0;i<2;i++){
    const p=room.players[i], mon=active(p); if(!alive(mon)) continue;
    if(mon.status==='burn') hurt(room,mon,Math.max(1,Math.floor(mon.maxHP/16)),'its burn');
    else if(mon.status==='poison') hurt(room,mon,Math.max(1,Math.floor(mon.maxHP/8)),'poison');
    else if(mon.status==='toxic'){hurt(room,mon,Math.max(1,Math.floor(mon.maxHP*(mon.toxicCounter||1)/16)),'bad poison');mon.toxicCounter=clamp((mon.toxicCounter||1)+1,1,15);}
    if(mon.volatile.seeded){
      const dmg=Math.max(1,Math.floor(mon.maxHP/8)); const actual=hurt(room,mon,dmg,'Leech Seed');
      const foe=active(room.players[other(i)]); if(foe&&alive(foe)) heal(room,foe,actual,'Leech Seed');
    }
    if(hasItem(mon,'Leftovers')) heal(room,mon,Math.max(1,Math.floor(mon.maxHP/16)),'Leftovers');
    if(hasItem(mon,'Black Sludge')) hasType(mon,'Poison')?heal(room,mon,Math.max(1,Math.floor(mon.maxHP/16)),'Black Sludge'):hurt(room,mon,Math.max(1,Math.floor(mon.maxHP/8)),'Black Sludge');
    if(room.terrain==='grassy') heal(room,mon,Math.max(1,Math.floor(mon.maxHP/16)),'Grassy Terrain');
    if(room.weather==='sand'&&!hasType(mon,'Rock')&&!hasType(mon,'Ground')&&!hasType(mon,'Steel')&&!hasAbility(mon,'Magic Guard')) hurt(room,mon,Math.max(1,Math.floor(mon.maxHP/16)),'the sandstorm');
    p.side.reflect=Math.max(0,p.side.reflect-1);p.side.lightScreen=Math.max(0,p.side.lightScreen-1);p.side.tailwind=Math.max(0,p.side.tailwind-1);
    if(mon.volatile.taunt>0) mon.volatile.taunt--;
    if(mon.volatile.encore>0 && --mon.volatile.encore===0) mon.volatile.encoreMove=null;
  }
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
      const pa=Number(ma.priority)||0,pb=Number(mb.priority)||0;
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
    if(req.method==='GET'&&url.pathname==='/health') return json(res,200,{ok:true,rooms:rooms.size,engine:'advanced-v3'});
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
        const gimmick=['Mega','Gigantamax','Tera'].includes(body.gimmick)?body.gimmick:null;
        p.choice={type:'move',moveIndex:idx,gimmick:gimmick,formIndex:Number(body.formIndex)||0}; resolveTurn(room);
      }else if(body.type==='switch'&&room.phase==='battle'){
        if(p.choice) return json(res,409,{error:'You already selected an action this turn.'});
        const slot=Number(body.slot);
        if(!Number.isInteger(slot)||!p.team[slot]||p.team[slot].hp<=0||slot===p.active) return json(res,400,{error:'Invalid switch.'});
        p.choice={type:'switch',slot}; resolveTurn(room);
      }else return json(res,400,{error:'That action is not available right now.'});
      return json(res,200,{room:publicRoom(room),playerIndex:pi});
    }
    return json(res,405,{error:'Method not allowed'});
  }catch(err){ return json(res,400,{error:err.message||String(err)}); }
});
server.listen(PORT,HOST,()=>console.log('Brisk battle relay listening on http://'+HOST+':'+PORT+' (advanced-v3)'));
