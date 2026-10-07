const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let BRISK_DATA={moveDetails:{},moves:{},movePP:{}};
try{BRISK_DATA=JSON.parse(fs.readFileSync(path.join(__dirname,'brisk-dex-data.json'),'utf8'));}catch(err){console.warn('Battle server could not load brisk-dex-data.json:',err.message);}

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const rooms = new Map();

function json(res, status, body){
  res.writeHead(status, {
    'Content-Type':'application/json; charset=utf-8',
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Private-Network':'true',
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
function catalogMove(id){
  const d=(BRISK_DATA.moveDetails||{})[String(id)]||{};
  if(!d.name&&!BRISK_DATA.moves[String(id)])return null;
  return {id:Number(id),name:d.name||BRISK_DATA.moves[String(id)]||('Move '+id),type:d.type||'Normal',category:d.category||'Status',
    power:Number(d.power)||0,accuracy:Number(d.accuracy)||100,priority:Number(d.priority)||0,pp:Number(d.pp||(BRISK_DATA.movePP||{})[String(id)]||16),
    maxPP:Number(d.pp||(BRISK_DATA.movePP||{})[String(id)]||16),effect:d.effect||'',target:d.target||'',flags:Array.isArray(d.flags)?d.flags:[],
    criticalHitStage:Number(d.criticalHitStage)||0,multiHit:!!d.multiHit,moveEffects:Array.isArray(d.moveEffects)?d.moveEffects:[]};
}
function randomCatalogMove(filterFn){
  const ids=Object.keys(BRISK_DATA.moveDetails||{}).filter(id=>Number(id)>0);
  const candidates=ids.map(catalogMove).filter(Boolean).filter(filterFn||(()=>true));
  return candidates.length?choose(candidates):null;
}

function cleanRewardRaw80(value){
  if(typeof value!=='string'||value.length>256) return '';
  try{const bytes=Buffer.from(value,'base64');return bytes.length===80?bytes.toString('base64'):'';}catch(e){return '';}
}
function cleanTeam(team){
  if(!Array.isArray(team)) return [];
  return team.slice(0,6).map((mon,index)=>({
    slot:index,
    rewardRaw80:cleanRewardRaw80(mon.rewardRaw80),
    species:Number(mon.species)||0,
    name:cleanText(mon.name,40)||('Pokémon '+(index+1)),
    level:clamp(Number(mon.level)||50,1,100),
    friendship:clamp(Number(mon.friendship)||0,0,255),weight:Math.max(0,Number(mon.weight)||0),
    ivs:{hp:clamp(Number(mon.ivs&&mon.ivs.hp)||0,0,31),atk:clamp(Number(mon.ivs&&mon.ivs.atk)||0,0,31),def:clamp(Number(mon.ivs&&mon.ivs.def)||0,0,31),spd:clamp(Number(mon.ivs&&mon.ivs.spd)||0,0,31),spa:clamp(Number(mon.ivs&&mon.ivs.spa)||0,0,31),spdef:clamp(Number(mon.ivs&&mon.ivs.spdef)||0,0,31)},
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
      aquaRing:false,ingrain:false,healBlock:0,saltCure:false,rageFistHits:0,lastDamageTaken:0,lastDamagedTurn:0,noRetreat:false,focusEnergy:0,lockOn:false,magnetRise:0,tarShot:false,octolock:false,recycledItem:'',actedTurn:0,statsLoweredTurn:0,smackedDown:false,endure:false,laserFocus:0,nightmare:false,infatuated:false,stockpile:0,rollout:0,uproar:0,throatChop:0,grudge:false,embargo:0,telekinesis:0,switchInTurn:0,beakBlast:false,magicCoat:false,imprison:false,usedMoves:[],lastDamageCategory:null,bideTurns:0,bideDamage:0,identified:false,miracleEye:false,snatch:false,skyDrop:false,glaiveRush:0},
    moves:(Array.isArray(mon.moves)?mon.moves:[]).slice(0,4).map(move=>({
      id:Number(move.id)||0,
      name:cleanText(move.name,60)||'Move',
      type:cleanText(move.type,20)||'Normal',
      category:['Physical','Special','Status'].includes(move.category)?move.category:'Status',
      power:Math.max(0,Number(move.power)||0),
      accuracy:clamp(Number(move.accuracy)||100,0,100),
      priority:clamp(Number(move.priority)||0,-7,7),
      pp:Math.max(1,Number(move.pp)||16),
      maxPP:Math.max(1,Number(move.pp)||16),effect:cleanText(move.effect,80),target:cleanText(move.target,50),flags:(Array.isArray(move.flags)?move.flags:[]).slice(0,32).map(x=>cleanText(x,50)),criticalHitStage:clamp(Number(move.criticalHitStage)||0,0,4),multiHit:!!move.multiHit,moveEffects:(Array.isArray(move.moveEffects)?move.moveEffects:[]).slice(0,12).map(x=>({effect:cleanText(x.effect,60),chance:clamp(Number(x.chance)||100,0,100),self:!!x.self}))
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
function hasItem(mon,name){ return !(mon.volatile&&mon.volatile.embargo>0) && normalizeName(mon.item)===normalizeName(name); }
function log(room,msg){ room.log.push(msg); if(room.log.length>250) room.log.splice(0,room.log.length-250); }

function publicMon(mon){
  return {
    species:mon.species,name:mon.name,level:mon.level,types:mon.types,maxHP:mon.maxHP,hp:mon.hp,
    ability:mon.ability,item:mon.item,teraType:mon.teraType,status:mon.status,stages:mon.stages,volatile:mon.volatile,friendship:mon.friendship,weight:mon.weight,
    transformed:mon.transformed,transformedKind:mon.transformedKind,choiceLock:mon.choiceLock,lastMoveIndex:mon.lastMoveIndex,transformations:mon.transformations,
    moves:mon.moves.map(m=>({id:m.id,name:m.name,type:m.type,category:m.category,power:m.power,accuracy:m.accuracy,priority:m.priority,pp:m.pp,maxPP:m.maxPP,effect:m.effect,target:m.target,flags:m.flags,criticalHitStage:m.criticalHitStage,multiHit:m.multiHit,moveEffects:m.moveEffects}))
  };
}
function publicRoom(room,viewerIndex){
  const reward=(room.phase==='finished'&&room.reward&&room.reward.winner===viewerIndex)
    ? {id:room.reward.id,species:room.reward.species,name:room.reward.name,level:room.reward.level,sourceTrainer:room.reward.sourceTrainer,raw80:room.reward.raw80}
    : null;
  return {
    code:room.code, phase:room.phase, rules:room.rules, turn:room.turn, winner:room.winner, reward:reward,
    weather:room.weather, weatherTurns:room.weatherTurns, terrain:room.terrain, terrainTurns:room.terrainTurns,
    trickRoom:room.trickRoom, trickRoomTurns:room.trickRoomTurns,gravity:room.gravity,gravityTurns:room.gravityTurns,
    magicRoom:room.magicRoom,magicRoomTurns:room.magicRoomTurns,wonderRoom:room.wonderRoom,wonderRoomTurns:room.wonderRoomTurns,
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
    if(mon){ mon.volatile.protect=false; mon.volatile.flinch=false; mon.volatile.endure=false;mon.volatile.magicCoat=false; }
  });
}
function beginBattle(room){
  room.phase='battle'; room.turn=1; room.lastMove=null; room.fairyLock=0;room.ionDeluge=false;room.waterSport=0;room.mudSport=0; room.weather=null; room.weatherTurns=0; room.terrain=null; room.terrainTurns=0; room.trickRoom=false; room.trickRoomTurns=0; room.gravity=false;room.gravityTurns=0;room.magicRoom=false;room.magicRoomTurns=0;room.wonderRoom=false;room.wonderRoomTurns=0;
  room.players.forEach(p=>{
    p.side={stealthRock:false,spikes:0,toxicSpikes:0,stickyWeb:false,reflect:0,lightScreen:0,auroraVeil:0,safeguard:0,mist:0,luckyChant:0,tailwind:0,wish:null,futureSight:null,healingWish:null}; p.usedMega=false;p.usedGmax=false;p.usedTera=false;p.lastFaintTurn=0;
    p.team.forEach(mon=>{ mon.hp=mon.maxHP; mon.status=null; mon.choiceLock=null;mon.lastMoveIndex=null;mon.transformed=false;mon.transformedKind=null;mon.originalTypes=null; mon.statusTurns=0; mon.toxicCounter=0; mon.stages={atk:0,def:0,spa:0,spd:0,spe:0,acc:0,eva:0}; mon.volatile={protect:false,protectCounter:0,flinch:false,confusion:0,seeded:false,taunt:0,encore:0,encoreMove:null,substitute:0,
      disabledMove:null,disableTurns:0,torment:false,trapped:false,recharge:false,charging:null,destinyBond:false,perish:0,yawn:0,
      aquaRing:false,ingrain:false,healBlock:0,saltCure:false,rageFistHits:0,lastDamageTaken:0,lastDamagedTurn:0,noRetreat:false,focusEnergy:0,lockOn:false,magnetRise:0,tarShot:false,octolock:false,recycledItem:'',actedTurn:0,statsLoweredTurn:0,smackedDown:false,endure:false,laserFocus:0,nightmare:false,infatuated:false,stockpile:0,rollout:0,uproar:0,throatChop:0,grudge:false,embargo:0,telekinesis:0,switchInTurn:0,beakBlast:false,magicCoat:false,imprison:false,usedMoves:[],lastDamageCategory:null,bideTurns:0,bideDamage:0,identified:false,miracleEye:false,snatch:false,skyDrop:false,glaiveRush:0}; });
    p.active=Math.max(0,p.team.findIndex(mon=>mon.hp>0)); p.choice=null; active(p).volatile.switchInTurn=room.turn;
  });
  log(room,'Battle started!');
  for(let i=0;i<2;i++) onSwitchIn(room,i);
}
function weatherBoost(room,move){
  if(room.weather==='sun'){
    if(normalizeName(move.name)==='hydrosteam')return 1.5;
    return move.type==='Fire'?1.5:move.type==='Water'?.5:1;
  }
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
function critChance(move,attacker){
  const n=normalizeName(move.name),stage=clamp(Number(move.criticalHitStage)||0,0,4);
  let base=stage>=3?100:stage===2?50:stage===1?12.5:['slash','nightslash','leafblade','stoneedge','crosschop','aircutter','crabhammer','razorleaf','psychocut'].includes(n)?12.5:4.167;
  if(attacker&&attacker.volatile.laserFocus>0)return 100;
  if(attacker&&attacker.volatile.focusEnergy>0)base=base<12.5?12.5:50;
  return base;
}
function effectKey(move){return normalizeName(move.effect||'');}
function positiveStageSum(mon){return Object.values(mon.stages||{}).reduce((s,v)=>s+Math.max(0,Number(v)||0),0);}
function negativeStageSum(mon){return Object.values(mon.stages||{}).reduce((s,v)=>s+Math.max(0,-(Number(v)||0)),0);}
function itemMoveType(item){
  const n=normalizeName(item);
  const map=[
    ['fistplate','Fighting'],['skyplate','Flying'],['toxicplate','Poison'],['earthplate','Ground'],['stoneplate','Rock'],['insectplate','Bug'],['spookyplate','Ghost'],['ironplate','Steel'],['flameplate','Fire'],['splashplate','Water'],['meadowplate','Grass'],['zapplate','Electric'],['mindplate','Psychic'],['icicleplate','Ice'],['dracoplate','Dragon'],['dreadplate','Dark'],['pixieplate','Fairy'],
    ['burndrive','Fire'],['dousedrive','Water'],['shockdrive','Electric'],['chilldrive','Ice'],
    ['fightingmemory','Fighting'],['flyingmemory','Flying'],['poisonmemory','Poison'],['groundmemory','Ground'],['rockmemory','Rock'],['bugmemory','Bug'],['ghostmemory','Ghost'],['steelmemory','Steel'],['firememory','Fire'],['watermemory','Water'],['grassmemory','Grass'],['electricmemory','Electric'],['psychicmemory','Psychic'],['icememory','Ice'],['dragonmemory','Dragon'],['darkmemory','Dark'],['fairymemory','Fairy']
  ];
  const found=map.find(x=>n.includes(x[0]));
  return found?found[1]:null;
}
function dynamicMovePower(room,attacker,defender,move){
  let power=Number(move.power)||0,n=normalizeName(move.name),e=effectKey(move);
  if(n==='facade'&&attacker.status)power*=2;
  if((n==='hex'||e==='doublepowerontargetstatus')&&defender.status)power*=2;
  if(n==='venoshock'&&(defender.status==='poison'||defender.status==='toxic'))power*=2;
  if(n==='brine'&&defender.hp<=defender.maxHP/2)power*=2;
  if(n==='acrobatics'&&!attacker.item)power*=2;
  if(n==='storedpower'||n==='powertrip')power=20+20*positiveStageSum(attacker);
  if(n==='punishment')power=Math.min(200,60+20*positiveStageSum(defender));
  if(n==='electroball'){
    const r=(attacker.speed||1)/Math.max(1,defender.speed||1);power=r>=4?150:r>=3?120:r>=2?80:r>=1?60:40;
  }
  if(n==='gyroball')power=Math.min(150,Math.max(1,Math.floor(25*(defender.speed||1)/Math.max(1,attacker.speed||1))+1));
  if(n==='eruption'||n==='waterspout')power=Math.max(1,Math.floor(150*attacker.hp/attacker.maxHP));
  if(n==='flail'||n==='reversal'){
    const q=Math.floor(48*attacker.hp/attacker.maxHP);
    power=q<=1?200:q<=4?150:q<=9?100:q<=16?80:q<=32?40:20;
  }
  if(n==='return')power=Math.max(1,Math.floor(attacker.friendship*10/25));
  if(n==='frustration')power=Math.max(1,Math.floor((255-attacker.friendship)*10/25));
  if(n==='ragefist')power=Math.min(350,50+50*(attacker.volatile.rageFistHits||0));
  if(n==='lastrespects'){
    const p=room.players.find(x=>x.team.includes(attacker));const fainted=p?p.team.filter(m=>m.hp<=0).length:0;power=Math.min(5050,50+50*fainted);
  }
  if(n==='lowkick'||n==='grassknot'){
    const w=defender.weight||0;power=w>=2000?120:w>=1000?100:w>=500?80:w>=250?60:w>=100?40:20;
  }
  if(n==='heavyslam'||n==='heatcrash'){
    const r=(attacker.weight||1)/Math.max(1,defender.weight||1);power=r>=5?120:r>=4?100:r>=3?80:r>=2?60:40;
  }
  if(n==='magnitude'){
    const roll=Math.random(),mag=roll<.05?4:roll<.15?5:roll<.35?6:roll<.65?7:roll<.85?8:roll<.95?9:10;
    power={4:10,5:30,6:50,7:70,8:90,9:110,10:150}[mag];log(room,'Magnitude '+mag+'!');
  }
  if(n==='stompingtantrum'&&attacker.volatile.lastMoveFailed)power*=2;
  const owner=room.players.find(p=>p.team.includes(attacker)),foe=room.players.find(p=>p.team.includes(defender));
  const targetActed=defender.volatile.actedTurn===room.turn;
  if((n==='boltbeak'||n==='fishiousrend')&&!targetActed)power*=2;
  if((n==='payback'||effectKey(move)==='payback'||effectKey(move)==='revenge')&&targetActed)power*=2;
  if(effectKey(move)==='doublepoweronargstatus'&&defender.status)power*=2;
  if(effectKey(move)==='powerbasedontargethp')power=Math.max(1,Math.floor(120*defender.hp/defender.maxHP));
  if(effectKey(move)==='powerbasedonuserhp')power=Math.max(1,Math.floor(150*attacker.hp/attacker.maxHP));
  if(effectKey(move)==='statchangehalfhp'&&attacker.hp<=attacker.maxHP/2)power*=2;
  if((n==='assurance'||effectKey(move)==='assurance')&&defender.volatile.lastDamagedTurn===room.turn)power*=2;
  if((n==='retaliate'||effectKey(move)==='retaliate')&&owner&&owner.lastFaintTurn===room.turn-1)power*=2;
  if((n==='lashout'||effectKey(move)==='lashout')&&attacker.volatile.statsLoweredTurn===room.turn)power*=2;
  if(n==='weatherball'&&room.weather)power*=2;
  if(n==='trumpcard'){const pp=Math.max(0,Number(move.pp)||0);power=pp===0?200:pp===1?80:pp===2?60:pp===3?50:40;}
  if(n==='spitup')power=100*Math.max(1,attacker.volatile.stockpile||0);
  if(n==='fling'&&attacker.item){const item=normalizeName(attacker.item);power=/ironball/.test(item)?130:/hardstone|plate/.test(item)?90:/berry/.test(item)?10:30;}
  if(n==='present'){const r=Math.random();power=r<.4?40:r<.7?80:r<.8?120:0;}
  if(n==='beatup'){power=10;}
  if(n==='rollout'||n==='iceball')power=Math.min(480,(Number(move.power)||30)*Math.pow(2,attacker.volatile.rollout||0));
  if(n==='terrainpulse'&&room.terrain)power*=2;
  if(e==='ficklebeam'&&chance(30))power*=2;
  if(e==='dynamaxdoubledmg'&&defender.transformedKind==='Gigantamax')power*=2;
  if(e==='fusioncombo'&&room.lastMove&&['fusionbolt','fusionflare'].includes(normalizeName(room.lastMove.name))&&normalizeName(room.lastMove.name)!==n)power*=2;
  if(e==='triplekick')power=Math.max(10,Number(move.power)||10);
  return Math.max(0,power);
}

function hiddenPowerType(mon){
  const iv=mon.ivs||{},bits=[iv.hp,iv.atk,iv.def,iv.spd,iv.spa,iv.spdef].map(v=>(Number(v)||0)&1);
  const value=Math.floor((bits[0]+2*bits[1]+4*bits[2]+8*bits[3]+16*bits[4]+32*bits[5])*15/63);
  return ['Fighting','Flying','Poison','Ground','Rock','Bug','Ghost','Steel','Fire','Water','Grass','Electric','Psychic','Ice','Dragon','Dark'][value]||'Dark';
}
function itemGrantedType(item){
  const n=normalizeName(item),map={fistplate:'Fighting',skyplate:'Flying',toxicplate:'Poison',earthplate:'Ground',stoneplate:'Rock',insectplate:'Bug',spookyplate:'Ghost',ironplate:'Steel',flameplate:'Fire',splashplate:'Water',meadowplate:'Grass',zapplate:'Electric',mindplate:'Psychic',icicleplate:'Ice',dracoplate:'Dragon',dreadplate:'Dark',pixieplate:'Fairy',fightingmemory:'Fighting',flyingmemory:'Flying',poisonmemory:'Poison',groundmemory:'Ground',rockmemory:'Rock',bugmemory:'Bug',ghostmemory:'Ghost',steelmemory:'Steel',firememory:'Fire',watermemory:'Water',grassmemory:'Grass',electricmemory:'Electric',psychicmemory:'Psychic',icememory:'Ice',dragonmemory:'Dragon',darkmemory:'Dark',fairymemory:'Fairy',burndrive:'Fire',dousedrive:'Water',shockdrive:'Electric',chilldrive:'Ice'};
  return map[n]||null;
}
function damage(room,attacker,defender,move,defenderPlayer){
  if(!move || move.power<=0 || move.category==='Status') return {amount:0,eff:1,crit:false};
  const specialName=normalizeName(move.name);
  let effectiveCategory=move.category;
  if((specialName==='terablast'||specialName==='photongeyser')&&stat(attacker,'atk')>stat(attacker,'spa'))effectiveCategory='Physical';
  if(specialName==='shellsidearm'){
    const physicalScore=stat(attacker,'atk')/Math.max(1,stat(defender,'def'));
    const specialScore=stat(attacker,'spa')/Math.max(1,stat(defender,'spd'));
    effectiveCategory=physicalScore>specialScore?'Physical':'Special';
  }
  let attackKey=effectiveCategory==='Special'?'spa':'atk', defenseKey=effectiveCategory==='Special'?'spd':'def';
  if(specialName==='bodypress')attackKey='def';
  if(specialName==='foulplay')attackKey='atk';
  if(specialName==='psyshock'||specialName==='psystrike'||specialName==='secretsword')defenseKey='def';
  let attack=specialName==='foulplay'?stat(defender,'atk'):stat(attacker,attackKey), defense=stat(defender,defenseKey);
  if(room.wonderRoom) defense=stat(defender,defenseKey==='def'?'spd':'def');
  if(hasAbility(defender,'Unaware')) attack=attacker[attackKey==='atk'?'atk':'spAtk']||attack;
  if(hasAbility(attacker,'Unaware')) defense=defender[defenseKey==='def'?'def':'spDef']||defense;
  if(effectiveCategory==='Physical'&&hasAbility(defender,'Fur Coat'))defense*=2;
  if(effectiveCategory==='Physical'&&defender.status&&hasAbility(defender,'Marvel Scale'))defense=Math.floor(defense*1.5);
  if(effectiveCategory==='Special'&&hasAbility(defender,'Ice Scales'))defense*=2;
  if(effectiveCategory==='Physical'&&attacker.status==='poison'&&hasAbility(attacker,'Toxic Boost'))attack=Math.floor(attack*1.5);
  if(effectiveCategory==='Special'&&attacker.status==='burn'&&hasAbility(attacker,'Flare Boost'))attack=Math.floor(attack*1.5);
  let power=dynamicMovePower(room,attacker,defender,move);
  const an=normalizeName(attacker.ability), item=room.magicRoom?'':normalizeName(attacker.item), mn=normalizeName(move.name);
  let effectiveType=move.type;
  if(mn==='hiddenpower')effectiveType=hiddenPowerType(attacker);
  if(['judgment','technoblast','multiattack'].includes(mn)){const granted=itemGrantedType(attacker.item);if(granted)effectiveType=granted;}
  if(mn==='aurawheel')effectiveType=/hangry/i.test(attacker.name)?'Dark':'Electric';
  if(mn==='ivycudgel'){const it=normalizeName(attacker.item);effectiveType=it.includes('hearthflame')?'Fire':it.includes('wellspring')?'Water':it.includes('cornerstone')?'Rock':'Grass';}
  if(mn==='terastarstorm'&&attacker.transformedKind==='Tera')effectiveType='Stellar';
  if(room.ionDeluge&&effectiveType==='Normal')effectiveType='Electric';
  if(mn==='weatherball'&&room.weather)effectiveType=room.weather==='sun'?'Fire':room.weather==='rain'?'Water':room.weather==='sand'?'Rock':'Ice';
  if(mn==='terrainpulse'&&room.terrain)effectiveType=room.terrain==='electric'?'Electric':room.terrain==='grassy'?'Grass':room.terrain==='psychic'?'Psychic':'Fairy';
  if(mn==='revelationdance'&&attacker.types&&attacker.types.length)effectiveType=attacker.types[0];
  if(mn==='terablast'&&attacker.transformedKind==='Tera'&&attacker.teraType)effectiveType=attacker.teraType;
  if(effectKey(move)==='changetypeonitem'){const t=itemMoveType(attacker.item);if(t)effectiveType=t;}
  if(effectKey(move)==='naturalgift'){const t=itemMoveType(attacker.item);if(t)effectiveType=t;}
  if(effectKey(move)==='aurawheel')effectiveType=/hangry/i.test(attacker.name)?'Dark':'Electric';
  if(effectKey(move)==='terastarstorm'&&attacker.transformedKind==='Tera')effectiveType='Stellar';
  if(attacker.volatile.electrified){effectiveType='Electric';attacker.volatile.electrified=false;}
  if(an==='normalize')effectiveType='Normal';
  else if(move.type==='Normal'&&an==='aerilate'){effectiveType='Flying';power=Math.floor(power*1.2);}
  else if(move.type==='Normal'&&an==='pixilate'){effectiveType='Fairy';power=Math.floor(power*1.2);}
  else if(move.type==='Normal'&&an==='refrigerate'){effectiveType='Ice';power=Math.floor(power*1.2);}
  else if(move.type==='Normal'&&an==='galvanize'){effectiveType='Electric';power=Math.floor(power*1.2);}
  if((an==='hugepower'||an==='purepower')&&move.category==='Physical') attack*=2;
  if(an==='guts'&&attacker.status&&move.category==='Physical') attack=Math.floor(attack*1.5);
  if(an==='technician'&&power<=60) power=Math.floor(power*1.5);
  if(an==='ironfist'&&isPunchMove(move))power=Math.floor(power*1.2);
  if(an==='strongjaw'&&isBiteMove(move))power=Math.floor(power*1.5);
  if(an==='sharpness'&&isSlicingMove(move))power=Math.floor(power*1.5);
  if(an==='megalauncher'&&isPulseMove(move))power=Math.floor(power*1.5);
  if(an==='punkrock'&&isSoundMove(move))power=Math.floor(power*1.3);
  if(an==='toughclaws'&&isContactMove(move))power=Math.floor(power*1.3);
  if(an==='reckless'&&RECOIL_MOVES.has(mn))power=Math.floor(power*1.2);
  if((an==='blaze'&&effectiveType==='Fire'||an==='torrent'&&effectiveType==='Water'||an==='overgrow'&&effectiveType==='Grass'||an==='swarm'&&effectiveType==='Bug')&&attacker.hp<=attacker.maxHP/3)power=Math.floor(power*1.5);
  if(attacker.volatile.charged&&effectiveType==='Electric'){power*=2;attacker.volatile.charged=false;}
  if(an==='sheerforce' && SECONDARY_MOVES.has(mn)) power=Math.floor(power*1.3);
  if(item==='choiceband'&&effectiveCategory==='Physical') attack=Math.floor(attack*1.5);
  if(item==='choicespecs'&&effectiveCategory==='Special') attack=Math.floor(attack*1.5);
  if(!room.magicRoom&&normalizeName(defender.item)==='assaultvest'&&effectiveCategory==='Special') defense=Math.floor(defense*1.5);
  if(item==='lifeorb') power=Math.floor(power*1.3);
  if(mn==='knockoff'&&defender.item) power=Math.floor(power*1.5);
  if(item==='muscleband'&&effectiveCategory==='Physical') power=Math.floor(power*1.1);
  if(item==='wiseglasses'&&effectiveCategory==='Special') power=Math.floor(power*1.1);
  let base=Math.floor((((2*attacker.level/5+2)*power*attack/Math.max(1,defense))/50)+2);
  let stab=1;
  if(attacker.transformedKind==='Tera'){
    const wasOriginal=(attacker.originalTypes||[]).includes(effectiveType), isTera=attacker.teraType===effectiveType;
    if(isTera) stab=wasOriginal?2:1.5;
    else if(wasOriginal) stab=1.5;
  }else if(hasType(attacker,effectiveType)) stab=(an==='adaptability'?2:1.5);
  let eff=effectiveness(effectiveType,defender.types);if(defender.volatile.tarShot&&effectiveType==='Fire')eff*=2;
  if(defender.volatile.identified&&hasType(defender,'Ghost')&&(effectiveType==='Normal'||effectiveType==='Fighting')&&eff===0)eff=1;
  if(defender.volatile.miracleEye&&hasType(defender,'Dark')&&effectiveType==='Psychic'&&eff===0)eff=1;
  if(effectKey(move)==='supereffectiveonarg'&&hasType(defender,'Water'))eff=Math.max(2,eff);
  if(effectKey(move)==='twotypedmove')eff*=effectiveness('Flying',defender.types);
  if(hasItem(defender,'Air Balloon')&&effectiveType==='Ground')eff=0;
  if(!ignoresAbility(attacker)&&hasAbility(defender,'Levitate')&&effectiveType==='Ground') eff=0;
  if(!ignoresAbility(attacker)&&hasAbility(defender,'Flash Fire')&&effectiveType==='Fire') eff=0;
  if(!ignoresAbility(attacker)&&(hasAbility(defender,'Water Absorb')||hasAbility(defender,'Storm Drain'))&&effectiveType==='Water') eff=0;
  if(!ignoresAbility(attacker)&&(hasAbility(defender,'Volt Absorb')||hasAbility(defender,'Lightning Rod'))&&effectiveType==='Electric') eff=0;
  if(!ignoresAbility(attacker)&&hasAbility(defender,'Sap Sipper')&&effectiveType==='Grass') eff=0;
  if(!ignoresAbility(attacker)&&hasAbility(defender,'Earth Eater')&&effectiveType==='Ground')eff=0;
  if(!ignoresAbility(attacker)&&hasAbility(defender,'Well-Baked Body')&&effectiveType==='Fire')eff=0;
  if(!ignoresAbility(attacker)&&hasAbility(defender,'Bulletproof')&&BALL_BOMB_MOVES.has(mn))eff=0;
  if(!ignoresAbility(attacker)&&hasAbility(defender,'Soundproof')&&isSoundMove(move))eff=0;
  if(!ignoresAbility(attacker)&&hasAbility(defender,'Wonder Guard')&&eff<=1) eff=0;
  if(hasAbility(attacker,'Tinted Lens')&&eff>0&&eff<1) eff*=2;
  const crit=(defenderPlayer.side&&defenderPlayer.side.luckyChant>0)?false:chance(critChance(move,attacker));
  let modifier=stab*eff*weatherBoost(room,Object.assign({},move,{type:effectiveType}))*terrainBoost(room,attacker,Object.assign({},move,{type:effectiveType}))*(crit?(hasAbility(attacker,'Sniper')?2.25:1.5):1)*((85+Math.floor(Math.random()*16))/100);
  if(item==='expertbelt'&&eff>1)modifier*=1.2;
  if(room.waterSport>0&&effectiveType==='Fire')modifier/=3;
  if(room.mudSport>0&&effectiveType==='Electric')modifier/=3;
  if((specialName==='collisioncourse'||specialName==='electrodrift')&&eff>1)modifier*=4/3;
  if(effectiveCategory==='Physical'&&attacker.status==='burn'&&!hasAbility(attacker,'Guts')) modifier*=.5;
  const side=defenderPlayer.side||{};
  if(!crit && ((effectiveCategory==='Physical'&&side.reflect>0)||(effectiveCategory==='Special'&&side.lightScreen>0)||side.auroraVeil>0)) modifier*=.5;
  if(!ignoresAbility(attacker)&&hasAbility(defender,'Multiscale')&&defender.hp===defender.maxHP) modifier*=.5;
  if(!ignoresAbility(attacker)&&hasAbility(defender,'Thick Fat')&&(effectiveType==='Fire'||effectiveType==='Ice'))modifier*=.5;
  if(!ignoresAbility(attacker)&&hasAbility(defender,'Punk Rock')&&isSoundMove(move))modifier*=.5;
  if(!ignoresAbility(attacker)&&(hasAbility(defender,'Filter')||hasAbility(defender,'Solid Rock')||hasAbility(defender,'Prism Armor'))) if(eff>1) modifier*=.75;
  let amount=Math.max(eff===0?0:1,Math.floor(base*modifier));
  if(hasItem(defender,'Focus Sash')&&defender.hp===defender.maxHP&&amount>=defender.hp){amount=defender.hp-1;defender.item='';}
  if(!ignoresAbility(attacker)&&hasAbility(defender,'Sturdy')&&defender.hp===defender.maxHP&&amount>=defender.hp)amount=defender.hp-1;
  if(defender.volatile.endure&&amount>=defender.hp)amount=Math.max(0,defender.hp-1);
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
  const owner=room.players.find(p=>p.team.includes(mon));
  if(amount<0&&owner&&owner.side.mist>0){log(room,mon.name+' is protected by Mist!');return;}
  if(hasAbility(mon,'Contrary')) amount=-amount;
  if(hasAbility(mon,'Simple')) amount*=2;
  const before=mon.stages[statName]||0, after=clamp(before+amount,-6,6); mon.stages[statName]=after;
  if(after===before) return;
  const names={atk:'Attack',def:'Defense',spa:'Sp. Atk',spd:'Sp. Def',spe:'Speed',acc:'accuracy',eva:'evasion'};
  log(room,mon.name+"'s "+names[statName]+' '+(amount>0?'rose':'fell')+(Math.abs(amount)>=2?' sharply':'')+'!');
  if(amount<0){const ownerTurn=room&&room.turn||0;mon.volatile.statsLoweredTurn=ownerTurn;
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
  const owner=room.players.find(p=>p.team.includes(mon));
  if(owner&&owner.side.safeguard>0){log(room,mon.name+' is protected by Safeguard!');return false;}
  if(!canStatus(mon,status)) return false;
  mon.status=status; mon.statusTurns=0; if(status==='toxic') mon.toxicCounter=1;
  const label={burn:'burned',poison:'poisoned',toxic:'badly poisoned',paralysis:'paralyzed',sleep:'put to sleep',freeze:'frozen'}[status]||status;
  log(room,mon.name+' was '+label+'!'); return true;
}
function createBattleReward(room,winnerIndex){
  if(room.reward||winnerIndex<0||winnerIndex>1||room.players.length<2) return room.reward||null;
  const loserIndex=other(winnerIndex), loser=room.players[loserIndex];
  const eligible=(loser.team||[]).filter(mon=>cleanRewardRaw80(mon.rewardRaw80));
  if(!eligible.length) return null;
  const mon=eligible[Math.floor(Math.random()*eligible.length)];
  room.reward={
    id:room.code+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9),
    winner:winnerIndex,loser:loserIndex,sourceTrainer:loser.name,
    species:mon.species,name:mon.name,level:mon.level,raw80:mon.rewardRaw80
  };
  return room.reward;
}
function finishBattle(room,winnerIndex,message){
  if(room.phase==='finished') return;
  room.phase='finished';room.winner=winnerIndex;room.players.forEach(x=>x.choice=null);
  createBattleReward(room,winnerIndex);
  if(message)log(room,message);
}
function faintCheck(room,pi){
  const p=room.players[pi], mon=active(p);
  if(mon&&mon.hp<=0){
    log(room,mon.name+' fainted!');p.lastFaintTurn=room.turn;
    const next=nextAlive(p);
    if(next<0){
      const winner=other(pi);finishBattle(room,winner,room.players[winner].name+' won the battle!');
      return true;
    }
    p.active=next; log(room,p.name+' sent out '+active(p).name+'!'); onSwitchIn(room,pi);
  }
  return false;
}

const CONTACT_MOVES=new Set(['tackle','bodyslam','doubleedge','quickattack','extremespeed','machpunch','bulletpunch','fakeout','closecombat','drainpunch','firepunch','icepunch','thunderpunch','poisonjab','ironhead','zenheadbutt','headbutt','waterfall','aquajet','bravebird','flareblitz','wildcharge','woodhammer','uturn','flipturn','knockoff','crunch','bite','playrough','leafblade','nightslash','suckerpunch','shadowclaw','dragonclaw','outrage','earthquake','highhorsepower','iciclecrash','rockslide','stoneedge']);
const RECHARGE_MOVES=new Set(['hyperbeam','gigaimpact','blastburn','hydrocannon','frenzyplant','rockwrecker','roaroftime','meteorassault','eternabeam']);
const CHARGE_MOVES=new Set(['fly','dig','bounce','phantomforce','shadowforce','skullbash','razorwind','skyattack','solarblade','solarbeam','meteorbeam','electroshot','geomancy']);
const PUNCH_MOVES=new Set(['bulletpunch','cometpunch','dizzypunch','drainpunch','dynamicpunch','firepunch','focuspunch','hammerarm','icehammer','icepunch','machpunch','megapunch','meteormash','plasmafists','poweruppunch','shadowpunch','skyuppercut','surgingstrikes','thunderpunch','wickedblow']);
const BITE_MOVES=new Set(['bite','crunch','firefang','fishiousrend','hyperfang','icefang','jawlock','poisonfang','psychicfangs','thunderfang']);
const SLICING_MOVES=new Set(['aerialace','aircutter','airslash','bitterblade','ceaselessedge','crosspoison','cut','falseswipe','furycutter','kowtowcleave','leafblade','nightslash','populationbomb','psychocut','razorshell','sacredsword','slash','solarblade','stoneaxe','xscissor']);
const PULSE_MOVES=new Set(['aurasphere','darkpulse','dragonpulse','healpulse','originpulse','terrainpulse','waterpulse']);
const SOUND_MOVES=new Set(['boomburst','bugbuzz','clangingscales','disarmingvoice','echoedvoice','hypervoice','overdrive','partingshot','perishsong','round','snarl','sparklingaria','uproar']);
const BALL_BOMB_MOVES=new Set(['acid spray','aerosol','aurasphere','bulletseed','eggbomb','electroball','energyball','focusblast','gyroball','iceball','magnetbomb','mistball','mudbomb','octazooka','pollenpuff','rockblast','searing shot','seedbomb','shadowball','sludgebomb','weatherball','zapcannon'].map(normalizeName));
const POWDER_MOVES=new Set(['cottonspore','poisonpowder','powder','ragepowder','sleeppowder','spore','stunspore']);
const RECOIL_MOVES=new Set(['doubleedge','bravebird','flareblitz','wildcharge','headsmash','woodhammer','volt tackle','wavecrash','chloroblast'].map(normalizeName));
const BOUNCEABLE_MOVES=new Set(['toxic','willowisp','thunderwave','spore','sleeppowder','hypnosis','sing','confuseray','supersonic','taunt','disable','torment','yawn','healblock','meanlook','block','spiderweb','stealthrock','spikes','toxicspikes','stickyweb','leechseed','charm','growl','leer','screech','tailwhip','metalsound','faketears','scaryface','stringshot']);
function moveHasFlag(move,flag){
  const wanted=normalizeName(flag);
  return (move.flags||[]).some(f=>normalizeName(f).includes(wanted));
}
function isContactMove(move){return moveHasFlag(move,'contact')||CONTACT_MOVES.has(normalizeName(move.name));}
function isSoundMove(move){return moveHasFlag(move,'sound')||SOUND_MOVES.has(normalizeName(move.name));}
function isPunchMove(move){return moveHasFlag(move,'punch')||PUNCH_MOVES.has(normalizeName(move.name));}
function isBiteMove(move){return moveHasFlag(move,'bite')||BITE_MOVES.has(normalizeName(move.name));}
function isSlicingMove(move){return moveHasFlag(move,'slicing')||moveHasFlag(move,'slice')||SLICING_MOVES.has(normalizeName(move.name));}
function isPulseMove(move){return moveHasFlag(move,'pulse')||PULSE_MOVES.has(normalizeName(move.name));}
function isPowderMove(move){return moveHasFlag(move,'powder')||POWDER_MOVES.has(normalizeName(move.name));}
function ignoresAbility(attacker){return hasAbility(attacker,'Mold Breaker')||hasAbility(attacker,'Teravolt')||hasAbility(attacker,'Turboblaze');}
function isGrounded(mon,room){
  if(room&&room.gravity)return true;
  if(mon.volatile&&mon.volatile.smackedDown)return true;
  if(mon.volatile&&mon.volatile.magnetRise>0)return false;
  return !hasType(mon,'Flying')&&!hasAbility(mon,'Levitate')&&!hasItem(mon,'Air Balloon');
}
function consumeItem(room,mon,reason){if(mon.item){const item=mon.item;mon.volatile.recycledItem=item;mon.item='';log(room,mon.name+' consumed its '+item+(reason?' '+reason:'')+'!');return item;}return '';}
function checkConsumable(room,mon){
  if(!mon||mon.hp<=0||!mon.item)return;
  const item=normalizeName(mon.item);
  if(item==='whiteherb'&&Object.keys(mon.stages||{}).some(k=>mon.stages[k]<0)){consumeItem(room,mon);Object.keys(mon.stages).forEach(k=>{if(mon.stages[k]<0)mon.stages[k]=0;});log(room,mon.name+"'s lowered stats were restored!");return;}
  if(item==='sitrusberry'&&mon.hp<=mon.maxHP/2){consumeItem(room,mon);heal(room,mon,Math.max(1,Math.floor(mon.maxHP/4)),'Sitrus Berry');}
  else if(item==='oranberry'&&mon.hp<=mon.maxHP/2){consumeItem(room,mon);heal(room,mon,10,'Oran Berry');}
  else if(item==='lumberry'&&(mon.status||mon.volatile.confusion>0)){consumeItem(room,mon);mon.status=null;mon.volatile.confusion=0;log(room,mon.name+' was cured!');}
  else if(item==='cheriberry'&&mon.status==='paralysis'){consumeItem(room,mon);mon.status=null;log(room,mon.name+' was cured of paralysis!');}
  else if(item==='chestoberry'&&mon.status==='sleep'){consumeItem(room,mon);mon.status=null;log(room,mon.name+' woke up!');}
  else if(item==='pechaberry'&&(mon.status==='poison'||mon.status==='toxic')){consumeItem(room,mon);mon.status=null;log(room,mon.name+' was cured of poison!');}
  else if(item==='rawstberry'&&mon.status==='burn'){consumeItem(room,mon);mon.status=null;log(room,mon.name+' was cured of its burn!');}
  else if(item==='aspearberry'&&mon.status==='freeze'){consumeItem(room,mon);mon.status=null;log(room,mon.name+' thawed out!');}
  else if(item==='persimberry'&&mon.volatile.confusion>0){consumeItem(room,mon);mon.volatile.confusion=0;log(room,mon.name+' snapped out of confusion!');}
  else if(item==='mentalherb'&&(mon.volatile.taunt>0||mon.volatile.encore>0||mon.volatile.disableTurns>0)){consumeItem(room,mon);mon.volatile.taunt=0;mon.volatile.encore=0;mon.volatile.encoreMove=null;mon.volatile.disableTurns=0;mon.volatile.disabledMove=null;log(room,mon.name+' recovered from its move restriction!');}
}
function switchBlocked(room,pi){
  const p=room.players[pi], mon=active(p), foe=active(room.players[other(pi)]);
  if(!mon||!foe)return false;
  if(room.fairyLock>0)return true;
  if(hasItem(mon,'Shed Shell'))return false;
  if(mon.volatile.trapped||mon.volatile.ingrain)return true;
  if(hasAbility(foe,'Shadow Tag')&&!hasAbility(mon,'Shadow Tag'))return true;
  if(hasAbility(foe,'Arena Trap')&&isGrounded(mon,room))return true;
  if(hasAbility(foe,'Magnet Pull')&&hasType(mon,'Steel'))return true;
  return false;
}
function effectivePriority(room,pi,move){
  let pr=Number(move.priority)||0;const mon=active(room.players[pi]);
  if(move.category==='Status'&&hasAbility(mon,'Prankster'))pr+=1;
  if(hasAbility(mon,'Gale Wings')&&move.type==='Flying'&&mon.hp===mon.maxHP)pr+=1;
  if(hasAbility(mon,'Triage')&&/heal|drain|kiss|pollenpuff|recover|roost|synthesis|moonlight|morningsun/.test(normalizeName(move.name)))pr+=3;
  if(normalizeName(move.name)==='grassyglide'&&room.terrain==='grassy')pr+=1;
  return pr;
}
function priorityBlocked(attacker,defender,priority,room){
  if(priority<=0)return false;
  if(room&&room.terrain==='psychic'&&isGrounded(defender,room))return true;
  return hasAbility(defender,'Dazzling')||hasAbility(defender,'Queenly Majesty')||hasAbility(defender,'Armor Tail');
}
function contactReaction(room,attacker,defender,move,dealt){
  if(hasAbility(attacker,'Long Reach')||!isContactMove(move)||dealt<=0)return;
  if(hasAbility(defender,'Rough Skin')||hasAbility(defender,'Iron Barbs'))hurt(room,attacker,Math.max(1,Math.floor(attacker.maxHP/8)),defender.ability);
  if(hasItem(defender,'Rocky Helmet'))hurt(room,attacker,Math.max(1,Math.floor(attacker.maxHP/6)),'Rocky Helmet');
  if(hasAbility(defender,'Static')&&chance(30))setStatus(room,attacker,'paralysis');
  if(hasAbility(defender,'Flame Body')&&chance(30))setStatus(room,attacker,'burn');
  if(hasAbility(defender,'Poison Point')&&chance(30))setStatus(room,attacker,'poison');
  if(hasAbility(defender,'Effect Spore')&&chance(30)){const st=choose(['paralysis','poison','sleep']);setStatus(room,attacker,st);}
  if(defender.volatile.beakBlast)setStatus(room,attacker,'burn');
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
  if(side.spikes>0 && isGrounded(mon,room)){
    const frac=side.spikes===1?1/8:side.spikes===2?1/6:1/4;
    hurt(room,mon,Math.max(1,Math.floor(mon.maxHP*frac)),'Spikes');
  }
  if(side.toxicSpikes>0 && isGrounded(mon,room)){
    if(hasType(mon,'Poison')) side.toxicSpikes=0;
    else setStatus(room,mon,side.toxicSpikes>=2?'toxic':'poison');
  }
  if(side.stickyWeb && isGrounded(mon,room)) boost(room,mon,'spe',-1);
}
function onSwitchIn(room,pi){
  const mon=active(room.players[pi]), foe=active(room.players[other(pi)]);
  if(!mon) return;
  applyHazards(room,pi);
  if(room.players[pi].side.healingWish&&mon.hp>0){mon.hp=mon.maxHP;mon.status=null;if(room.players[pi].side.healingWish==='lunar')mon.moves.forEach(m=>m.pp=m.maxPP);log(room,mon.name+' was restored by '+(room.players[pi].side.healingWish==='lunar'?'Lunar Dance':'Healing Wish')+'!');room.players[pi].side.healingWish=null;}
  if(mon.hp<=0){ faintCheck(room,pi); return; }
  if(hasAbility(mon,'Imposter')&&foe&&!mon.transformed)transformInto(room,mon,foe);
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
  if(mon.volatile.infatuated&&chance(50)){log(room,mon.name+' is immobilized by love!');return false;}
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
function transformInto(room,mon,target){
  const keepHp=mon.hp,keepMax=mon.maxHP,keepStatus=mon.status,keepItem=mon.item,keepTera=mon.teraType;
  mon.species=target.species;mon.name=target.name;mon.types=target.types.slice();mon.ability=target.ability;
  mon.atk=target.atk;mon.def=target.def;mon.speed=target.speed;mon.spAtk=target.spAtk;mon.spDef=target.spDef;
  mon.stages=Object.assign({},target.stages);mon.moves=target.moves.map(m=>Object.assign({},m,{pp:Math.min(5,m.maxPP||m.pp||5),maxPP:Math.min(5,m.maxPP||m.pp||5)}));
  mon.hp=keepHp;mon.maxHP=keepMax;mon.status=keepStatus;mon.item=keepItem;mon.teraType=keepTera;
  mon.transformed=true;mon.transformedKind='Transform';log(room,mon.name+' transformed!');
}
function applyPrimaryMetadataStatus(room,pi,move){
  const p=room.players[pi],foe=room.players[other(pi)],mon=active(p),target=active(foe),e=effectKey(move);
  if(!e)return false;
  if(['afteryou','allyswitch','followme','helpinghand','quash','celebrate','happyhour','holdhands','donothing'].includes(e)){
    log(room,move.name+' has no additional effect in a singles battle.');return true;
  }
  if(e==='acupressure'){boost(room,mon,choose(['atk','def','spa','spd','spe','acc','eva']),2);return true;}
  if(e==='attract'){target.volatile.infatuated=true;log(room,target.name+' became infatuated!');return true;}
  if(e==='autotomize'){boost(room,mon,'spe',2);return true;}
  if(e==='captivate'){boost(room,target,'spa',-2);return true;}
  if(e==='defensecurl'){boost(room,mon,'def',1);return true;}
  if(e==='dragoncheer'){mon.volatile.focusEnergy=Math.min(2,(mon.volatile.focusEnergy||0)+1);return true;}
  if(e==='endure'){mon.volatile.endure=true;log(room,mon.name+' braced itself!');return true;}
  if(e==='extremeevoboost'){['atk','def','spa','spd','spe'].forEach(k=>boost(room,mon,k,2));return true;}
  if(e==='flower shield'||e==='flowershield'){[mon,target].filter(x=>hasType(x,'Grass')).forEach(x=>boost(room,x,'def',1));return true;}
  if(e==='focusenergy'){mon.volatile.focusEnergy=Math.min(2,(mon.volatile.focusEnergy||0)+1);return true;}
  if(e==='growth'){boost(room,mon,'atk',room.weather==='sun'?2:1);boost(room,mon,'spa',room.weather==='sun'?2:1);return true;}
  if(e==='guard split'||e==='guardsplit'){const d=Math.floor((mon.def+target.def)/2),sd=Math.floor((mon.spDef+target.spDef)/2);mon.def=target.def=d;mon.spDef=target.spDef=sd;return true;}
  if(e==='laserfocus'){mon.volatile.laserFocus=2;return true;}
  if(e==='luckychant'){p.side.luckyChant=5;log(room,'The opposing team was shielded from critical hits!');return true;}
  if(e==='minimize'){boost(room,mon,'eva',2);return true;}
  if(e==='mist'){p.side.mist=5;return true;}
  if(e==='mudsport'){room.mudSport=5;return true;}
  if(e==='powersplit'){const a=Math.floor((mon.atk+target.atk)/2),sa=Math.floor((mon.spAtk+target.spAtk)/2);mon.atk=target.atk=a;mon.spAtk=target.spAtk=sa;return true;}
  if(e==='rototiller'){[mon,target].filter(x=>hasType(x,'Grass')&&isGrounded(x)).forEach(x=>{boost(room,x,'atk',1);boost(room,x,'spa',1);});return true;}
  if(e==='safeguard'){p.side.safeguard=5;return true;}
  if(e==='stockpile'){if(mon.volatile.stockpile<3){mon.volatile.stockpile++;boost(room,mon,'def',1);boost(room,mon,'spd',1);}return true;}
  if(e==='stuffcheeks'){if(mon.item&&/berry/i.test(mon.item)){consumeItem(room,mon);boost(room,mon,'def',2);}return true;}
  if(e==='swagger'){boost(room,target,'atk',2);target.volatile.confusion=2+Math.floor(Math.random()*4);return true;}
  if(e==='teatime'){[mon,target].forEach(x=>{if(x.item&&/berry/i.test(x.item)){consumeItem(room,x);checkConsumable(room,x);}});return true;}
  if(e==='teleport'){pivotSwitch(room,pi,false);return true;}
  if(e==='thirdtype'){if(!target.types.includes('Ghost'))target.types=target.types.concat('Ghost').slice(-3);return true;}
  if(e==='toxicthread'){setStatus(room,target,'poison');boost(room,target,'spe',-1);return true;}
  if(e==='watersport'){room.waterSport=5;return true;}
  if(e==='conversion'){const m=mon.moves.find(x=>x.type);if(m)mon.types=[m.type];return true;}
  if(e==='conversion2'){const choices=['Normal','Fire','Water','Electric','Grass','Ice','Fighting','Poison','Ground','Flying','Psychic','Bug','Rock','Ghost','Dragon','Dark','Steel','Fairy'];mon.types=[choose(choices)];return true;}
  if(e==='overwriteability'||e==='doodle'){target.ability=mon.ability;return true;}
  if(e==='restorehp'){if(mon.volatile.healBlock<=0)heal(room,mon,Math.floor(mon.maxHP/2),move.name);return true;}
  if(e==='statchange magnetic'||e==='statchangemagnetic'){boost(room,mon,'def',1);boost(room,mon,'spd',1);return true;}
  if(e==='nonvolatilestatus'){setStatus(room,target,'paralysis');return true;}
  if(e==='darkvoid'){setStatus(room,target,'sleep');return true;}
  if(e==='foresight'){target.volatile.identified=true;log(room,target.name+' was identified!');return true;}
  if(e==='miracleeye'){target.volatile.miracleEye=true;log(room,target.name+' was exposed by Miracle Eye!');return true;}
  if(e==='geomancy'){boost(room,mon,'spa',2);boost(room,mon,'spd',2);boost(room,mon,'spe',2);return true;}
  if(e==='matblock'){if(mon.volatile.switchInTurn===room.turn){mon.volatile.protect=true;log(room,mon.name+' protected its side with Mat Block!');}else log(room,'Mat Block failed!');return true;}
  if(e==='snatch'){mon.volatile.snatch=true;log(room,mon.name+' is waiting to snatch a move!');return true;}
  if(e==='instruct'){log(room,'Instruct has no reliable extra target in this singles simulator and is treated as a singles no-op.');return true;}
  if(e==='hitenemyhealally'){log(room,move.name+' has no ally-heal component in singles.');return true;}
  return false;
}

function applyStatusMove(room,pi,move){
  const p=room.players[pi], foe=room.players[other(pi)], mon=active(p), target=active(foe), n=normalizeName(move.name);
  const metadataHandled=applyPrimaryMetadataStatus(room,pi,move);
  if(n==='endure'){mon.volatile.endure=true;log(room,mon.name+' braced itself!');return;}
  if(metadataHandled)return;
  if(PROTECT_MOVES.has(n)){
    const success=mon.volatile.protectCounter===0||chance(100/Math.pow(3,mon.volatile.protectCounter));
    if(success){mon.volatile.protect=true;mon.volatile.protectCounter++;log(room,mon.name+' protected itself!');}
    else{mon.volatile.protect=false;mon.volatile.protectCounter=0;log(room,mon.name+"'s protection failed!");}
    return;
  }
  if(HEAL_MOVES.has(n)){ if(mon.volatile.healBlock>0)log(room,mon.name+' is prevented from healing!');else heal(room,mon,Math.floor(mon.maxHP/2),move.name); return; }
  if(n==='morningsun'||n==='synthesis'||n==='moonlight'){
    var frac=room.weather==='sun'?2/3:(room.weather?1/4:1/2);
    if(mon.volatile.healBlock>0)log(room,mon.name+' is prevented from healing!');else heal(room,mon,Math.floor(mon.maxHP*frac),move.name);return;
  }
  if(n==='shoreup'){var frac2=room.weather==='sand'?2/3:1/2;if(mon.volatile.healBlock<=0)heal(room,mon,Math.floor(mon.maxHP*frac2),'Shore Up');return;}
  if(SETUP[n]){ SETUP[n].forEach(x=>boost(room,mon,x[0],x[1])); return; }
  if(n==='defensecurl'){boost(room,mon,'def',1);return;}
  if(n==='minimize'){boost(room,mon,'eva',2);return;}
  if(n==='autotomize'){boost(room,mon,'spe',2);return;}
  if(n==='swagger'){boost(room,target,'atk',2);target.volatile.confusion=2+Math.floor(Math.random()*4);log(room,target.name+' became confused!');return;}
  if(n==='curse'){
    if(hasType(mon,'Ghost')){if(mon.hp>mon.maxHP/2){hurt(room,mon,Math.floor(mon.maxHP/2),'Curse');target.volatile.cursed=true;log(room,target.name+' was afflicted by a curse!');}}else{boost(room,mon,'atk',1);boost(room,mon,'def',1);boost(room,mon,'spe',-1);}return;
  }
  if(n==='conversion'){var first=mon.moves.find(m=>m.type);if(first){mon.types=[first.type];log(room,mon.name+' transformed into the '+first.type+' type!');}return;}
  if(n==='conversion2'){var options=['Normal','Fire','Water','Electric','Grass','Ice','Fighting','Poison','Ground','Flying','Psychic','Bug','Rock','Ghost','Dragon','Dark','Steel','Fairy'].filter(t=>effectiveness(target.moves[target.lastMoveIndex]&&target.moves[target.lastMoveIndex].type||'Normal',[t])<1);if(options.length){mon.types=[choose(options)];log(room,mon.name+' changed type!');}return;}
  if(n==='bellydrum'){ if(mon.hp>mon.maxHP/2){ hurt(room,mon,Math.floor(mon.maxHP/2),'Belly Drum');mon.stages.atk=6;log(room,mon.name+' maximized its Attack!'); } return; }
  if(n==='rest'){ mon.status='sleep';mon.statusTurns=0;heal(room,mon,mon.maxHP,'Rest');log(room,mon.name+' went to sleep!');return; }
  if(n==='substitute'){ const cost=Math.floor(mon.maxHP/4); if(mon.hp>cost){hurt(room,mon,cost,'Substitute');mon.volatile.substitute=cost;log(room,mon.name+' put in a substitute!');}return; }
  if(n==='leechseed'){ if(!hasType(target,'Grass')){target.volatile.seeded=true;log(room,target.name+' was seeded!');} return; }
  if(n==='toxic'){setStatus(room,target,'toxic');return;} if(n==='willowisp'){setStatus(room,target,'burn');return;} if(n==='thunderwave'){setStatus(room,target,'paralysis');return;}
  if(n==='spore'||n==='sleeppowder'||n==='hypnosis'||n==='sing'){setStatus(room,target,'sleep');return;}
  if(n==='confuseray'||n==='supersonic'){target.volatile.confusion=2+Math.floor(Math.random()*4);log(room,target.name+' became confused!');return;}
  if(n==='darkvoid'){setStatus(room,target,'sleep');return;}
  if(n==='foresight'){target.volatile.foresight=true;target.stages.eva=0;log(room,target.name+' was identified!');return;}
  if(n==='miracleeye'){target.volatile.miracleEye=true;target.stages.eva=0;log(room,target.name+' was identified!');return;}
  if(n==='geomancy'){boost(room,mon,'spa',2);boost(room,mon,'spd',2);boost(room,mon,'spe',2);return;}
  if(n==='sketch'){
    if(target.lastMoveIndex!==null&&target.moves[target.lastMoveIndex]){const slot=mon.lastMoveIndex!==null?mon.lastMoveIndex:0;mon.moves[slot]=Object.assign({},target.moves[target.lastMoveIndex]);log(room,mon.name+' sketched '+target.moves[target.lastMoveIndex].name+'!');}
    else log(room,'But it failed!');return;
  }
  if(n==='snatch'){mon.volatile.snatch=true;log(room,mon.name+' is waiting to snatch a move!');return;}
  if(n==='taunt'){target.volatile.taunt=3;log(room,target.name+' fell for the taunt!');return;}
  if(n==='transform'){transformInto(room,mon,target);return;}
  if(n==='focusenergy'){mon.volatile.focusEnergy=Math.min(2,(mon.volatile.focusEnergy||0)+1);log(room,mon.name+' is getting pumped!');return;}
  if(n==='magiccoat'){mon.volatile.magicCoat=true;log(room,mon.name+' shrouded itself with Magic Coat!');return;}
  if(n==='imprison'){mon.volatile.imprison=true;log(room,mon.name+' sealed shared moves with Imprison!');return;}
  if(n==='mimic'){
    if(target.lastMoveIndex!==null&&target.moves[target.lastMoveIndex]){
      const slot=mon.lastMoveIndex!==null?mon.lastMoveIndex:0;
      mon.moves[slot]=Object.assign({},target.moves[target.lastMoveIndex],{pp:5,maxPP:5});
      log(room,mon.name+' mimicked '+target.moves[target.lastMoveIndex].name+'!');
    }else log(room,'But it failed!');
    return;
  }
  if(n==='sketch'){
    if(target.lastMoveIndex!==null&&target.moves[target.lastMoveIndex]){
      const slot=mon.lastMoveIndex!==null?mon.lastMoveIndex:0;
      mon.moves[slot]=Object.assign({},target.moves[target.lastMoveIndex]);
      log(room,mon.name+' sketched '+target.moves[target.lastMoveIndex].name+'!');
    }else log(room,'But it failed!');
    return;
  }
  if(n==='laserfocus'){mon.volatile.laserFocus=2;log(room,mon.name+' concentrated intensely!');return;}
  if(n==='endure'){mon.volatile.endure=true;log(room,mon.name+' braced itself!');return;}
  if(n==='acupressure'){const stats=['atk','def','spa','spd','spe','acc','eva'];boost(room,mon,choose(stats),2);return;}
  if(n==='autotomize'){boost(room,mon,'spe',2);return;}
  if(n==='defensecurl'){boost(room,mon,'def',1);return;}
  if(n==='minimize'){boost(room,mon,'eva',2);return;}
  if(n==='growth'){boost(room,mon,'atk',room.weather==='sun'?2:1);boost(room,mon,'spa',room.weather==='sun'?2:1);return;}
  if(n==='dragoncheer'){mon.volatile.focusEnergy=Math.min(2,(mon.volatile.focusEnergy||0)+1);log(room,mon.name+' received a Dragon Cheer!');return;}
  if(n==='attract'){target.volatile.infatuated=true;log(room,target.name+' became infatuated!');return;}
  if(n==='nightmare'&&target.status==='sleep'){target.volatile.nightmare=true;log(room,target.name+' began having a nightmare!');return;}
  if(n==='stockpile'){if(mon.volatile.stockpile<3){mon.volatile.stockpile++;boost(room,mon,'def',1);boost(room,mon,'spd',1);}return;}
  if(n==='swallow'){var st=mon.volatile.stockpile||0;if(st){var f=st===1?1/4:st===2?1/2:1;heal(room,mon,Math.floor(mon.maxHP*f),'Swallow');mon.volatile.stockpile=0;}return;}
  if(n==='conversion'&&mon.moves.length){var mv=mon.moves.find(x=>x.type);if(mv){mon.types=[mv.type];log(room,mon.name+' changed to the '+mv.type+' type!');}return;}
  if(n==='camouflage'){var t=room.terrain==='electric'?'Electric':room.terrain==='grassy'?'Grass':room.terrain==='psychic'?'Psychic':room.terrain==='misty'?'Fairy':'Normal';mon.types=[t];log(room,mon.name+' changed to the '+t+' type!');return;}
  if(n==='curse'){if(hasType(mon,'Ghost')){if(mon.hp>mon.maxHP/2){hurt(room,mon,Math.floor(mon.maxHP/2),'Curse');target.volatile.cursed=true;log(room,target.name+' was cursed!');}}else{boost(room,mon,'atk',1);boost(room,mon,'def',1);boost(room,mon,'spe',-1);}return;}
  if(n==='guardsplit'){var d=Math.floor((mon.def+target.def)/2),sd=Math.floor((mon.spDef+target.spDef)/2);mon.def=target.def=d;mon.spDef=target.spDef=sd;log(room,'The battlers shared their defenses!');return;}
  if(n==='powersplit'){var a=Math.floor((mon.atk+target.atk)/2),sa=Math.floor((mon.spAtk+target.spAtk)/2);mon.atk=target.atk=a;mon.spAtk=target.spAtk=sa;log(room,'The battlers shared their offenses!');return;}
  if(n==='psychoshift'&&mon.status&&!target.status){target.status=mon.status;mon.status=null;log(room,mon.name+' transferred its status!');return;}
  if(n==='swagger'){boost(room,target,'atk',2);target.volatile.confusion=2+Math.floor(Math.random()*4);log(room,target.name+' became confused!');return;}
  if(n==='toxicthread'){setStatus(room,target,'poison');boost(room,target,'spe',-1);return;}
  if(n==='watersport'){room.waterSport=5;log(room,"Fire's power was weakened!");return;}
  if(n==='mudsport'){room.mudSport=5;log(room,"Electricity's power was weakened!");return;}
  if(n==='iondeluge'){room.ionDeluge=true;log(room,'An ion deluge filled the battlefield!');return;}
  if(n==='fairylock'){room.fairyLock=2;log(room,'No Pokémon can escape next turn!');return;}
  if(n==='lockon'||n==='mindreader'){mon.volatile.lockOn=true;log(room,mon.name+' took aim at '+target.name+'!');return;}
  if(n==='magnetrise'){mon.volatile.magnetRise=5;log(room,mon.name+' levitated with electromagnetism!');return;}
  if(n==='gravity'){room.gravity=true;room.gravityTurns=5;log(room,'Gravity intensified!');return;}
  if(n==='magicroom'){room.magicRoom=!room.magicRoom;room.magicRoomTurns=room.magicRoom?5:0;log(room,'A bizarre area was created in which held items lose their effects!');return;}
  if(n==='wonderroom'){room.wonderRoom=!room.wonderRoom;room.wonderRoomTurns=room.wonderRoom?5:0;log(room,'Defense and Sp. Def were swapped!');return;}
  if(n==='mist'){p.side.mist=5;log(room,p.name+"'s team became shrouded in mist!");return;}
  if(n==='safeguard'){p.side.safeguard=5;log(room,p.name+"'s team became cloaked in a mystical veil!");return;}
  if(n==='auroraveil'){if(room.weather==='snow'){p.side.auroraVeil=5;log(room,'Aurora Veil protected the team!');}else log(room,'Aurora Veil failed!');return;}
  if(n==='spite'&&target.lastMoveIndex!==null&&target.moves[target.lastMoveIndex]){var sm=target.moves[target.lastMoveIndex];sm.pp=Math.max(0,sm.pp-4);log(room,sm.name+' lost 4 PP!');return;}
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
  if(n==='psychup'){mon.stages=Object.assign({},target.stages);log(room,mon.name+" copied the foe's stat changes!");return;}
  if(n==='topsyturvy'){Object.keys(target.stages).forEach(k=>target.stages[k]=-target.stages[k]);log(room,target.name+"'s stat changes were inverted!");return;}
  if(n==='powertrick'){const tmp=mon.atk;mon.atk=mon.def;mon.def=tmp;log(room,mon.name+' switched its Attack and Defense!');return;}
  if(n==='powerswap'){['atk','spa'].forEach(k=>{const t=mon.stages[k];mon.stages[k]=target.stages[k];target.stages[k]=t;});log(room,'The battlers swapped offensive stat changes!');return;}
  if(n==='guardswap'){['def','spd'].forEach(k=>{const t=mon.stages[k];mon.stages[k]=target.stages[k];target.stages[k]=t;});log(room,'The battlers swapped defensive stat changes!');return;}
  if(n==='heartswap'){const t=mon.stages;mon.stages=target.stages;target.stages=t;log(room,'The battlers swapped stat changes!');return;}
  if(n==='speedswap'){const t=mon.speed;mon.speed=target.speed;target.speed=t;log(room,'The battlers swapped Speed!');return;}
  if(n==='soak'){target.types=['Water'];log(room,target.name+' transformed into the Water type!');return;}
  if(n==='reflecttype'){mon.types=target.types.slice();log(room,mon.name+" copied the foe's type!");return;}
  if(n==='roleplay'){mon.ability=target.ability;log(room,mon.name+' copied '+target.ability+'!');return;}
  if(n==='gastroacid'){target.ability='';log(room,target.name+"'s Ability was suppressed!");return;}
  if(n==='entrainment'){target.ability=mon.ability;log(room,target.name+' acquired '+mon.ability+'!');return;}
  if(n==='refresh'){if(['burn','paralysis','poison','toxic'].includes(mon.status)){mon.status=null;log(room,mon.name+' refreshed itself!');}return;}
  if(n==='healbell'||n==='aromatherapy'){p.team.forEach(x=>x.status=null);log(room,p.name+"'s team was cured of status conditions!");return;}
  if(n==='strengthsap'){const amount=stat(target,'atk');boost(room,target,'atk',-1);if(mon.volatile.healBlock<=0)heal(room,mon,amount,'Strength Sap');return;}
  if(n==='noretreat'&&!mon.volatile.noRetreat){['atk','def','spa','spd','spe'].forEach(k=>boost(room,mon,k,1));mon.volatile.noRetreat=true;mon.volatile.trapped=true;log(room,mon.name+' can no longer escape!');return;}
  if(n==='clangoroussoul'){const cost=Math.floor(mon.maxHP/3);if(mon.hp>cost){hurt(room,mon,cost,'Clangorous Soul');['atk','def','spa','spd','spe'].forEach(k=>boost(room,mon,k,1));}return;}
  if(n==='tidyup'){clearHazards(p.side);clearHazards(foe.side);mon.volatile.substitute=0;target.volatile.substitute=0;boost(room,mon,'atk',1);boost(room,mon,'spe',1);log(room,'The battlefield was tidied up!');return;}
  if(n==='psychoshift'&&mon.status&&!target.status){var shifted=mon.status;mon.status=null;setStatus(room,target,shifted);log(room,mon.name+' transferred its status condition!');return;}
  if(n==='stockpile'){if(mon.volatile.stockpile<3){mon.volatile.stockpile++;boost(room,mon,'def',1);boost(room,mon,'spd',1);log(room,mon.name+' stockpiled '+mon.volatile.stockpile+'!');}return;}
  if(n==='swallow'){if(mon.volatile.stockpile>0&&mon.volatile.healBlock<=0){var fractions=[0,.25,.5,1];heal(room,mon,Math.floor(mon.maxHP*fractions[mon.volatile.stockpile]),'Swallow');mon.volatile.stockpile=0;}return;}
  if(n==='charge'){mon.volatile.charged=true;boost(room,mon,'spd',1);log(room,mon.name+' began charging power!');return;}
  if(n==='electrify'){target.volatile.electrified=true;log(room,target.name+"'s next move was electrified!");return;}
  if(n==='embargo'){target.volatile.embargo=5;log(room,target.name+' can no longer use its held item!');return;}
  if(n==='nightmare'&&target.status==='sleep'){target.volatile.nightmare=true;log(room,target.name+' began having a nightmare!');return;}
  if(n==='painsplit'){const avg=Math.floor((mon.hp+target.hp)/2);mon.hp=Math.min(mon.maxHP,avg);target.hp=Math.min(target.maxHP,avg);log(room,'The battlers shared their pain!');return;}
  if(n==='bestow'&&mon.item&&!target.item){target.item=mon.item;mon.item='';log(room,mon.name+' bestowed its item on '+target.name+'!');return;}
  if(n==='trick'||n==='switcheroo'){const tmp=mon.item;mon.item=target.item;target.item=tmp;mon.choiceLock=null;target.choiceLock=null;log(room,'The Pokémon swapped held items!');return;}
  if(n==='recycle'&&!mon.item&&mon.volatile.recycledItem){mon.item=mon.volatile.recycledItem;mon.volatile.recycledItem='';log(room,mon.name+' recycled its '+mon.item+'!');return;}
  if(n==='corrosivegas'&&target.item){log(room,target.name+"'s "+target.item+' was corroded away!');target.item='';return;}
  if(n==='courtchange'){const keys=['stealthRock','spikes','toxicSpikes','stickyWeb','reflect','lightScreen','auroraVeil','safeguard','mist','tailwind'];keys.forEach(k=>{const t=p.side[k];p.side[k]=foe.side[k];foe.side[k]=t;});log(room,'The battlefield effects were swapped!');return;}
  if(n==='purify'&&target.status){target.status=null;if(mon.volatile.healBlock<=0)heal(room,mon,Math.floor(mon.maxHP/2),'Purify');log(room,target.name+' was purified!');return;}
  if(n==='lifedew'){if(mon.volatile.healBlock<=0)heal(room,mon,Math.floor(mon.maxHP/4),'Life Dew');return;}
  if(n==='junglehealing'){if(mon.volatile.healBlock<=0)heal(room,mon,Math.floor(mon.maxHP/4),'Jungle Healing');mon.status=null;return;}
  if(n==='takeheart'){mon.status=null;boost(room,mon,'spa',1);boost(room,mon,'spd',1);return;}
  if(n==='tarshot'){target.volatile.tarShot=true;boost(room,target,'spe',-1);log(room,target.name+' became weaker to Fire!');return;}
  if(n==='octolock'){target.volatile.octolock=true;target.volatile.trapped=true;log(room,target.name+' was locked in place!');return;}
  if(n==='skillswap'){const tmp=mon.ability;mon.ability=target.ability;target.ability=tmp;log(room,'The Pokémon swapped abilities!');return;}
  if(n==='meanlook'||n==='block'||n==='spiderweb'){target.volatile.trapped=true;log(room,target.name+' can no longer escape!');return;}
  if(n==='memento'){boost(room,target,'atk',-2);boost(room,target,'spa',-2);mon.hp=0;log(room,mon.name+' fainted after Memento!');return;}
  if(n==='partingshot'){boost(room,target,'atk',-1);boost(room,target,'spa',-1);pivotSwitch(room,pi,false);return;}
  if(n==='healingwish'||n==='lunardance'){
    mon.hp=0;p.side.healingWish=n==='lunardance'?'lunar':'healing';log(room,mon.name+' sacrificed itself for its replacement!');return;
  }
  if(n==='shedtail'){const cost=Math.floor(mon.maxHP/2);if(mon.hp>cost){hurt(room,mon,cost,'Shed Tail');const slot=randomBenchSlot(p);if(slot>=0){doSwitch(room,pi,slot);active(p).volatile.substitute=Math.floor(active(p).maxHP/4);}}return;}
  if(n==='revivalblessing'){const fainted=p.team.filter(x=>x.hp<=0);if(fainted.length){const revive=fainted[0];revive.hp=Math.max(1,Math.floor(revive.maxHP/2));log(room,revive.name+' was revived!');}return;}
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
function applyExtractedMoveEffects(room,attacker,defender,move){
  (move.moveEffects||[]).forEach(function(entry){
    if(!chance(Number(entry.chance)||100))return;
    const target=entry.self?attacker:defender,key=normalizeName(entry.effect).replace(/^moveeffect/,'');
    if(key==='sleep')setStatus(room,target,'sleep');
    else if(key==='poison')setStatus(room,target,'poison');
    else if(key==='burn')setStatus(room,target,'burn');
    else if(key==='freeze'||key==='freezeorfrostbite')setStatus(room,target,'freeze');
    else if(key==='paralysis')setStatus(room,target,'paralysis');
    else if(key==='toxic')setStatus(room,target,'toxic');
    else if(key==='confusion'){target.volatile.confusion=2+Math.floor(Math.random()*4);log(room,target.name+' became confused!');}
    else if(key==='flinch')target.volatile.flinch=true;
    else if(key==='absorb'&&entry.self){const amount=Math.max(1,Math.floor(target.maxHP/8));heal(room,target,amount,move.name);}
    else if(key==='clear smog'||key==='clearsmog'){target.stages={atk:0,def:0,spa:0,spd:0,spe:0,acc:0,eva:0};log(room,target.name+"'s stat changes were eliminated!");}
    else if(key==='removestatus'){target.status=null;log(room,target.name+"'s status was cured!");}
    else if(key==='wrap'||key==='firespinside'||key==='trapboth'){target.volatile.trapped=true;log(room,target.name+' was trapped!');}
    else if(key==='spite'){var used=target.lastMoveIndex;if(used!==null&&target.moves[used]){target.moves[used].pp=Math.max(0,target.moves[used].pp-4);log(room,target.moves[used].name+' lost PP!');}}
    else if(key==='throatchop'){target.volatile.throatChop=2;log(room,target.name+' was prevented from using sound moves!');}
    else if(key==='incinerate'&&target.item&&/berry/i.test(target.item)){log(room,target.name+"'s "+target.item+' was incinerated!');target.item='';}
    else if(key==='bugbite'&&target.item&&/berry/i.test(target.item)){log(room,attacker.name+' ate '+target.name+"'s "+target.item+'!');target.item='';}
    else if(key==='breakscreen'){const owner=room.players.find(p=>p.team.includes(target));if(owner){owner.side.reflect=0;owner.side.lightScreen=0;owner.side.auroraVeil=0;log(room,'The protective screens were shattered!');}}
    else if(key==='reflect'){const owner=room.players.find(p=>p.team.includes(attacker));if(owner)owner.side.reflect=5;}
    else if(key==='lightscreen'){const owner=room.players.find(p=>p.team.includes(attacker));if(owner)owner.side.lightScreen=5;}
    else if(key==='stealthrock'){const owner=room.players.find(p=>p.team.includes(target));if(owner)owner.side.stealthRock=true;}
    else if(key==='yawnfoe'){target.volatile.yawn=2;log(room,target.name+' grew drowsy!');}
    else if(key==='tormentside'){target.volatile.torment=true;log(room,target.name+' was subjected to torment!');}
    else if(key==='preventescapeside'){target.volatile.trapped=true;log(room,target.name+' can no longer escape!');}
    else if(key==='paralyzeside')setStatus(room,target,'paralysis');
    else if(key==='poisonside')setStatus(room,target,'poison');
    else if(key==='poisonparalyzeside')setStatus(room,target,chance(50)?'poison':'paralysis');
    else if(key==='confuseside'||key==='confusepaydayside'){target.volatile.confusion=2+Math.floor(Math.random()*4);log(room,target.name+' became confused!');}
    else if(key==='critplusside'){target.volatile.focusEnergy=Math.min(2,(target.volatile.focusEnergy||0)+1);}
    else if(key==='recoilhp25'&&entry.self&&!hasAbility(target,'Rock Head')&&!hasAbility(target,'Magic Guard'))hurt(room,target,Math.max(1,Math.floor(target.maxHP/4)),'recoil');
    else if(key==='recharge'&&entry.self)target.volatile.recharge=true;
    else if(key==='preventescape'){target.volatile.trapped=true;log(room,target.name+' was trapped!');}
    else if(key==='leechseed'){target.volatile.seeded=true;log(room,target.name+' was seeded!');}
    else if(key==='saltcure'){target.volatile.saltCure=true;log(room,target.name+' was salt cured!');}
    else if(key==='haze'){room.players.forEach(p=>active(p)&&(active(p).stages={atk:0,def:0,spa:0,spd:0,spe:0,acc:0,eva:0}));}
    else if(key==='sun'){room.weather='sun';room.weatherTurns=5;}
    else if(key==='rain'){room.weather='rain';room.weatherTurns=5;}
    else if(key==='sandstorm'){room.weather='sand';room.weatherTurns=5;}
    else if(key==='hail'){room.weather='snow';room.weatherTurns=5;}
    else if(key==='mistyterrain'){room.terrain='misty';room.terrainTurns=5;}
    else if(key==='grassyterrain'){room.terrain='grassy';room.terrainTurns=5;}
    else if(key==='electricterrain'){room.terrain='electric';room.terrainTurns=5;}
    else if(key==='psychicterrain'){room.terrain='psychic';room.terrainTurns=5;}
    else if(key==='gravity'){room.gravity=true;room.gravityTurns=5;}
    else if(key==='auroraveil'){const p=room.players.find(p=>p.team.includes(attacker));if(p)p.side.auroraVeil=5;}
    else if(key==='defog'){room.players.forEach(p=>clearHazards(p.side));}
    else if(key==='aromatherapy'||key==='healteam'){const p=room.players.find(p=>p.team.includes(attacker));if(p)p.team.forEach(m=>m.status=null);}
    else if(key==='feint'){target.volatile.protect=false;}
    else if(key==='eeriespell'){var li=target.lastMoveIndex;if(li!==null&&target.moves[li])target.moves[li].pp=Math.max(0,target.moves[li].pp-3);}
    else if(key==='effectsporeside'){setStatus(room,target,choose(['sleep','poison','paralysis']));}
    else if(key==='infatuateside'){target.volatile.infatuated=true;}
    else if(key==='iondeluge'){room.ionDeluge=true;}
    else if(key==='recycleberries'&&!target.item&&target.volatile.recycledItem){target.item=target.volatile.recycledItem;target.volatile.recycledItem='';}
    else if(key==='removeargtype'&&target.types.length>1){target.types=target.types.slice(0,1);}
    else if(key==='statplus'){boost(room,target,'atk',1);}
    else if(key==='statminus'){boost(room,target,'atk',-1);}
    else if(key==='stealstats'){Object.keys(target.stages).forEach(k=>{if(target.stages[k]>0){attacker.stages[k]=clamp(attacker.stages[k]+target.stages[k],-6,6);target.stages[k]=0;}});}
    else if(key==='psychicnoise'){target.volatile.healBlock=2;}
    else if(key==='thrash'){attacker.volatile.confusion=2+Math.floor(Math.random()*3);}
    else if(key==='syrupbomb')boost(room,target,'spe',-1);
    else if(key==='steelsurge'){const owner=room.players.find(p=>p.team.includes(target));if(owner)owner.side.stealthRock=true;}
    else if(key==='wildfire'||key==='cannonade'||key==='vinelash'||key==='volcalith'){target.volatile.saltCure=true;}
    else if(key==='coreenforcer'&&target.volatile.actedTurn===room.turn)target.ability='';
    else if(key==='fixedpower'){/* power already comes from Brisk move data */}
    else if(key==='flameburst'){const owner=room.players.find(p=>p.team.includes(target));if(owner){const bench=owner.team.find(m=>m!==target&&m.hp>0);if(bench)hurt(room,bench,Math.max(1,Math.floor(bench.maxHP/16)),'Flame Burst');}}
    else if(key==='glaiverush'){target.volatile.glaiveRush=2;}
    else if(key==='ord erup'||key==='orderup'){boost(room,attacker,'atk',1);}
    else if(key==='rainbow'){/* doubles pledge side effect; no singles target */}
    else if(key==='randomfromlist'){const effects=['burn','poison','paralysis'];setStatus(room,target,choose(effects));}
    else if(key==='sandblastside')room.weather='sand';
    else if(key==='seaoffire'||key==='swamp'){target.volatile.saltCure=true;}
    else if(key==='secretpower'){if(chance(30))target.volatile.flinch=true;}
    else if(key==='beatupmessage'||key==='itemmessage'){/* message-only metadata */}
  });
}
function secondaryEffect(room,attacker,defender,move){
  applyExtractedMoveEffects(room,attacker,defender,move);
  const n=normalizeName(move.name);
  if((move.moveEffects||[]).length)return;
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
function moveHitCount(name,move){
  const n=normalizeName(name);
  if(['doublekick','bonemerang','doublehit','twineedle','dualwingbeat','doubleironbash'].includes(n)) return 2;
  if(['tripleaxel','tripledive','triplekick'].includes(n)) return 3;
  if(['populationbomb'].includes(n)) return 10;
  if((move&&move.multiHit)||['bulletseed','rockblast','iciclespear','furyattack','furryswipes','armthrust','pinmissile','watershuriken','tailslap','scaleshot','doubleslap','cometpunch'].includes(n)){
    const r=Math.random(); return r<.375?2:r<.75?3:r<.875?4:5;
  }
  return 1;
}

function resolveAttack(room,pi,choice){
  const p=room.players[pi], foe=room.players[other(pi)], mon=active(p), target=active(foe);
  mon.volatile.lastMoveFailed=false;
  if(!alive(mon)||!alive(target)) return;
  if(choice.gimmick) transformMon(room,pi,choice.gimmick,choice.formIndex);
  const called=choice.calledMove&&choice.depth<3;
  const move=called?choice.calledMove:mon.moves[choice.moveIndex]; if(!move){log(room,mon.name+' has no usable move there.');return;}
  if(!called&&mon.choiceLock!==null && mon.choiceLock!==choice.moveIndex){log(room,mon.name+" is locked into "+(mon.moves[mon.choiceLock]&&mon.moves[mon.choiceLock].name||'another move')+'!');return;}
  if(!called&&mon.volatile.encore>0 && mon.volatile.encoreMove!==null && mon.volatile.encoreMove!==choice.moveIndex){log(room,mon.name+" must repeat "+(mon.moves[mon.volatile.encoreMove]&&mon.moves[mon.volatile.encoreMove].name||'its encored move')+'!');return;}
  if(!called&&mon.volatile.disabledMove===choice.moveIndex&&mon.volatile.disableTurns>0){log(room,move.name+' is disabled!');return;}
  if(!called&&mon.volatile.torment&&mon.lastMoveIndex===choice.moveIndex){log(room,mon.name+" can't use the same move twice because of Torment!");return;}
  if(target.volatile.imprison&&target.moves.some(function(m){return normalizeName(m.name)===normalizeName(move.name);})){log(room,move.name+' is sealed by Imprison!');return;}
  if(!called&&move.pp<=0){log(room,move.name+' has no PP left!');return;}
  if(!called){move.pp=Math.max(0,move.pp-(hasAbility(target,'Pressure')?2:1)); mon.lastMoveIndex=choice.moveIndex;if(!mon.volatile.usedMoves.includes(choice.moveIndex))mon.volatile.usedMoves.push(choice.moveIndex);}
  if(!called&&(hasItem(mon,'Choice Band')||hasItem(mon,'Choice Specs')||hasItem(mon,'Choice Scarf'))&&mon.choiceLock===null) mon.choiceLock=choice.moveIndex;
  if(mon.volatile.taunt>0&&move.category==='Status'){log(room,mon.name+" can't use "+move.name+' after the taunt!');return;}
  if(mon.volatile.throatChop>0&&isSoundMove(move)){log(room,mon.name+" can't use sound moves!");return;}
  const movePriority=effectivePriority(room,pi,move);
  if(priorityBlocked(mon,target,movePriority,room)){log(room,target.name+' blocked the priority move!');return;}
  const moveNameKey=normalizeName(move.name);
  if(!PROTECT_MOVES.has(moveNameKey))mon.volatile.protectCounter=0;
  if((hasAbility(mon,'Protean')||hasAbility(mon,'Libero'))&&!mon.transformed&&move.category!=='Status'){mon.types=[move.type];log(room,mon.name+' changed to the '+move.type+' type!');}
  if(CHARGE_MOVES.has(moveNameKey)||['twoturnsattack','semiinvulnerable','skydrop','geomancy'].includes(effectKey(move))){

    const instant=(moveNameKey==='solarbeam'||moveNameKey==='solarblade')&&room.weather==='sun';
    if(!instant&&mon.volatile.charging!==choice.moveIndex){mon.volatile.charging=choice.moveIndex;log(room,mon.name+' began charging '+move.name+'!');return;}
    mon.volatile.charging=null;
  }
  if(!canAct(room,mon)){faintCheck(room,pi);return;}
  mon.volatile.actedTurn=room.turn;
  let accuracy=move.accuracy;
  if(mon.volatile.lockOn){accuracy=100;mon.volatile.lockOn=false;}
  if(room.gravity&&accuracy>0)accuracy*=5/3;
  if(accuracy>0){
    accuracy*=accuracyMultiplier(mon.stages.acc||0)/accuracyMultiplier(target.stages.eva||0);
    if(hasAbility(mon,'Compound Eyes')) accuracy*=1.3;
    if(!chance(clamp(accuracy,1,100))){
      log(room,mon.name+' used '+move.name+', but it missed!');mon.volatile.lastMoveFailed=true;
      if(effectKey(move)==='recoilifmiss'&&!hasAbility(mon,'Magic Guard'))hurt(room,mon,Math.max(1,Math.floor(mon.maxHP/2)),'crash damage');
      return;
    }
  }
  room.lastMove=Object.assign({},move,{pp:move.maxPP||move.pp||1});
  if(move.category==='Status'||move.power<=0){
    log(room,mon.name+' used '+move.name+'!');
    if(target.volatile.snatch&&moveHasFlag(move,'snatch')){target.volatile.snatch=false;log(room,target.name+' snatched '+move.name+'!');applyStatusMove(room,other(pi),move);return;}
    const statusKey=normalizeName(move.name);
    if(isPowderMove(move)&&(hasType(target,'Grass')||hasAbility(target,'Overcoat')||hasItem(target,'Safety Goggles'))){log(room,target.name+' is immune to powder moves!');return;}
    if(hasAbility(target,'Good as Gold')&&!ignoresAbility(mon)&&!['haze','trickroom','raindance','sunnyday','sandstorm','snowscape','hail','electricterrain','grassyterrain','psychicterrain','mistyterrain'].includes(statusKey)){log(room,target.name+" is protected by Good as Gold!");return;}
    if(hasAbility(mon,'Prankster')&&hasType(target,'Dark')&&effectivePriority(room,pi,move)>0){log(room,target.name+' is immune to the Prankster move!');return;}
    if((hasAbility(target,'Magic Bounce')||target.volatile.magicCoat)&&!ignoresAbility(mon)&&BOUNCEABLE_MOVES.has(normalizeName(move.name))){
      log(room,target.name+' bounced the move back with Magic Bounce!');
      const originalActive=p.active, originalFoe=foe.active;
      applyStatusMove(room,other(pi),move);
      return;
    }
    const statusName=normalizeName(move.name);
    if(statusName==='metronome'){
      const selected=randomCatalogMove(function(m){return m.name!==move.name&&!moveHasFlag(m,'metronome banned');});
      if(selected){log(room,'Metronome selected '+selected.name+'!');resolveAttack(room,pi,{calledMove:selected,depth:(choice.depth||0)+1,moveIndex:choice.moveIndex});}else log(room,'But it failed!');
      return;
    }else if(statusName==='copycat'||statusName==='mirrormove'){
      const selected=room.lastMove?Object.assign({},room.lastMove):null;
      if(selected&&normalizeName(selected.name)!==statusName){log(room,move.name+' copied '+selected.name+'!');resolveAttack(room,pi,{calledMove:selected,depth:(choice.depth||0)+1,moveIndex:choice.moveIndex});}else log(room,'But it failed!');
      return;
    }else if(statusName==='sleeptalk'){
      if(mon.status!=='sleep'){log(room,'But it failed!');return;}
      const pool=mon.moves.filter(m=>!['sleeptalk','rest'].includes(normalizeName(m.name)));
      const selected=pool.length?choose(pool):null;
      if(selected){log(room,'Sleep Talk selected '+selected.name+'!');resolveAttack(room,pi,{calledMove:Object.assign({},selected),depth:(choice.depth||0)+1,moveIndex:choice.moveIndex});}else log(room,'But it failed!');
      return;
    }else if(statusName==='assist'){
      const pool=p.team.flatMap(x=>x.moves||[]).filter(m=>!['assist','metronome','copycat','mirrormove'].includes(normalizeName(m.name))&&!moveHasFlag(m,'assist banned'));
      const selected=pool.length?choose(pool):null;
      if(selected){log(room,'Assist selected '+selected.name+'!');resolveAttack(room,pi,{calledMove:Object.assign({},selected),depth:(choice.depth||0)+1,moveIndex:choice.moveIndex});}else log(room,'But it failed!');
      return;
    }else if(statusName==='naturepower'){
      const desired=room.terrain==='electric'?'thunderbolt':room.terrain==='grassy'?'energyball':room.terrain==='misty'?'moonblast':room.terrain==='psychic'?'psychic':'triattack';
      const selected=randomCatalogMove(m=>normalizeName(m.name)===desired);
      if(selected)resolveAttack(room,pi,{calledMove:selected,depth:(choice.depth||0)+1,moveIndex:choice.moveIndex});else log(room,'But it failed!');
      return;
    }else if(statusName==='trickroom'){
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
  if(normalizeName(move.name)==='lastresort'&&mon.moves.some(function(m,i){return i!==choice.moveIndex&&!mon.volatile.usedMoves.includes(i);})){log(room,'Last Resort failed!');mon.volatile.lastMoveFailed=true;return;}
  if(normalizeName(move.name)==='snore'&&mon.status!=='sleep'){log(room,'Snore failed because '+mon.name+' is not asleep!');mon.volatile.lastMoveFailed=true;return;}
  if(normalizeName(move.name)==='synchronoise'&&!target.types.some(function(t){return mon.types.includes(t);})){log(room,'Synchronoise failed!');mon.volatile.lastMoveFailed=true;return;}
  if(normalizeName(move.name)==='upperhand'){
    const uc=foe.choice,um=uc&&uc.type==='move'?target.moves[uc.moveIndex]:null;
    if(!um||effectivePriority(room,other(pi),um)<=0){log(room,'Upper Hand failed!');mon.volatile.lastMoveFailed=true;return;}
  }
  if(normalizeName(move.name)==='steelroller'&&!room.terrain){log(room,mon.name+"'s Steel Roller failed because there is no terrain!");mon.volatile.lastMoveFailed=true;return;}
  if(normalizeName(move.name)==='suckerpunch'){
    const foeChoice=foe.choice, foeMove=foeChoice&&foeChoice.type==='move'?target.moves[foeChoice.moveIndex]:null;
    if(!foeMove||foeMove.category==='Status'){log(room,mon.name+"'s Sucker Punch failed!");return;}
  }
  if(target.volatile.protect&&!['hyperspacefury','hyperspacehole','feint'].includes(normalizeName(move.name))){log(room,target.name+' protected itself from '+move.name+'!');return;}
  const n=normalizeName(move.name);
  if(n==='bide'){if(mon.volatile.bideTurns<=0){mon.volatile.bideTurns=2;mon.volatile.bideDamage=0;log(room,mon.name+' began storing energy!');return;}}
  if(n==='shelltrap'&&!(mon.volatile.lastDamagedTurn===room.turn&&mon.volatile.lastDamageCategory==='Physical')){log(room,'Shell Trap failed!');mon.volatile.lastMoveFailed=true;return;}
  if(effectKey(move)==='ohko'){
    if(mon.level<target.level){log(room,move.name+' failed!');mon.volatile.lastMoveFailed=true;return;}
    if(chance(clamp(30+mon.level-target.level,1,100))){target.hp=0;log(room,"It's a one-hit KO!");faintCheck(room,other(pi));}
    else{log(room,mon.name+' used '+move.name+', but it missed!');mon.volatile.lastMoveFailed=true;}return;
  }
  if(n==='finalgambit'){const d=Math.min(target.hp,mon.hp);target.hp-=d;mon.hp=0;log(room,mon.name+' sacrificed itself and dealt '+d+' damage!');faintCheck(room,other(pi));faintCheck(room,pi);return;}
  const primaryEffect=effectKey(move);
  if(primaryEffect==='failifnotargtype'&&!hasType(mon,move.type)){log(room,move.name+' failed!');mon.volatile.lastMoveFailed=true;return;}
  if(primaryEffect==='snore'&&mon.status!=='sleep'){log(room,'Snore failed!');mon.volatile.lastMoveFailed=true;return;}
  if(primaryEffect==='synchronoise'&&!target.types.some(t=>mon.types.includes(t))){log(room,'Synchronoise failed!');mon.volatile.lastMoveFailed=true;return;}
  if(primaryEffect==='shelltrap'&&mon.volatile.lastDamagedTurn!==room.turn){log(room,'Shell Trap failed!');mon.volatile.lastMoveFailed=true;return;}
  if(primaryEffect==='upperhand'){const fc=foe.choice,fm=fc&&fc.type==='move'?target.moves[fc.moveIndex]:null;if(!fm||effectivePriority(room,other(pi),fm)<=0){log(room,'Upper Hand failed!');mon.volatile.lastMoveFailed=true;return;}target.volatile.flinch=true;}
  if(primaryEffect==='hyperspacefury')target.volatile.protect=false;
  if(primaryEffect==='snipe shot'||primaryEffect==='snipeshot'||primaryEffect==='maxmove'||primaryEffect==='speciespoweroverride'||primaryEffect==='hiddenpower'||primaryEffect==='ivycudgel'){/* singles-compatible: base move data handles damage; redirection/species hooks are irrelevant or data-driven here */}
  if(primaryEffect==='firstturnonly'&&mon.volatile.switchInTurn!==room.turn){log(room,move.name+' failed!');mon.volatile.lastMoveFailed=true;return;}
  if(primaryEffect==='fixedhpdamage'){const d=Math.min(target.hp,40);target.hp-=d;log(room,target.name+' lost '+d+' HP!');faintCheck(room,other(pi));return;}
  if(primaryEffect==='fixedpercentdamage'){const d=Math.max(1,Math.floor(target.maxHP/2));target.hp=Math.max(0,target.hp-d);log(room,target.name+' lost '+d+' HP!');faintCheck(room,other(pi));return;}
  if(primaryEffect==='leveldamage'){const d=Math.min(target.hp,mon.level);target.hp-=d;log(room,target.name+' lost '+d+' HP!');faintCheck(room,other(pi));return;}
  if(primaryEffect==='psywave'){const d=Math.max(1,Math.floor(mon.level*(.5+Math.random())));target.hp=Math.max(0,target.hp-d);log(room,target.name+' lost '+d+' HP!');faintCheck(room,other(pi));return;}
  if(primaryEffect==='reflectdamage'){const d=Math.max(1,Math.floor((mon.volatile.lastDamageTaken||1)*2));target.hp=Math.max(0,target.hp-d);log(room,target.name+' took '+d+' reflected damage!');faintCheck(room,other(pi));return;}
  if(primaryEffect==='recoilifmiss'&&move.accuracy>0){/* crash recoil is handled on miss path below */}
  if(primaryEffect==='bide'){
    if(mon.volatile.bideTurns<=0){mon.volatile.bideTurns=2;mon.volatile.bideDamage=0;log(room,mon.name+' is storing energy!');return;}
    mon.volatile.bideDamage+=mon.volatile.lastDamageTaken||0;
    mon.volatile.bideTurns--;
    if(mon.volatile.bideTurns>0){log(room,mon.name+' is storing energy!');return;}
    const bd=Math.max(1,mon.volatile.bideDamage*2);target.hp=Math.max(0,target.hp-bd);log(room,mon.name+' unleashed energy for '+bd+' damage!');mon.volatile.bideDamage=0;faintCheck(room,other(pi));return;
  }
  if(n==='poltergeist'&&!target.item){log(room,mon.name+"'s Poltergeist failed because the target has no item!");mon.volatile.lastMoveFailed=true;return;}
  if(n==='dreameater'&&target.status!=='sleep'){log(room,mon.name+"'s Dream Eater failed!");mon.volatile.lastMoveFailed=true;return;}
  if(n==='belch'&&!mon.volatile.recycledItem){log(room,mon.name+"'s Belch failed!");mon.volatile.lastMoveFailed=true;return;}
  if(n==='spitup'){
    if(mon.volatile.stockpile<=0){log(room,'But it failed!');mon.volatile.lastMoveFailed=true;return;}
    move.power=100*mon.volatile.stockpile;mon.volatile.stockpile=0;
  }
  if(n==='fling'){
    if(!mon.item){log(room,'But it failed!');mon.volatile.lastMoveFailed=true;return;}
    log(room,mon.name+' flung its '+mon.item+'!');mon.item='';
  }
  if(primaryEffect==='mefirst'){
    const fc=foe.choice,fm=fc&&fc.type==='move'?target.moves[fc.moveIndex]:null;
    if(!fm||fm.category==='Status'){log(room,'Me First failed!');return;}
    const copied=Object.assign({},fm,{power:Math.floor((fm.power||0)*1.5)});
    resolveAttack(room,pi,{calledMove:copied,depth:(choice.depth||0)+1,moveIndex:choice.moveIndex});return;
  }
  if(n==='futuresight'){
    foe.side.futureSight={turns:3,damage:Math.max(1,Math.floor((((2*mon.level/5+2)*120*stat(mon,'spa')/Math.max(1,stat(target,'spd')))/50)+2))};
    log(room,mon.name+' foresaw an attack!');return;
  }
  if(effectKey(move)==='leveldamage'){const d=Math.min(target.hp,mon.level);target.hp-=d;log(room,target.name+' lost '+d+' HP!');faintCheck(room,other(pi));return;}
  if(effectKey(move)==='fixedpercentdamage'){const d=Math.max(1,Math.floor(target.hp/2));target.hp-=d;log(room,target.name+' lost '+d+' HP!');faintCheck(room,other(pi));return;}
  if(n==='psywave'){const d=Math.max(1,Math.floor(mon.level*(0.5+Math.random())));target.hp=Math.max(0,target.hp-d);log(room,target.name+' lost '+d+' HP!');faintCheck(room,other(pi));return;}
  if((n==='counter'||n==='mirrorcoat')&&mon.volatile.lastDamageTaken>0&&mon.volatile.lastDamagedTurn===room.turn){
    const wanted=n==='counter'?'Physical':'Special';
    if(mon.volatile.lastDamageCategory===wanted){const d=Math.min(target.hp,mon.volatile.lastDamageTaken*2);target.hp-=d;log(room,move.name+' returned '+d+' damage!');faintCheck(room,other(pi));return;}
    log(room,'But it failed!');return;
  }
  if(n==='seismictoss'||n==='nightshade'){const d=Math.min(target.hp,mon.level);target.hp-=d;log(room,mon.name+' used '+move.name+'! '+target.name+' lost '+d+' HP.');faintCheck(room,other(pi));return;}
  if(n==='superfang'||n==='naturesmadness'||n==='ruination'){const d=Math.max(1,Math.floor(target.hp/2));target.hp-=d;log(room,mon.name+' used '+move.name+'! '+target.name+' lost '+d+' HP.');faintCheck(room,other(pi));return;}
  if(n==='endeavor'&&target.hp>mon.hp){const d=target.hp-mon.hp;target.hp=mon.hp;log(room,mon.name+' used Endeavor! '+target.name+' lost '+d+' HP.');}
  const hits=moveHitCount(move.name,move);
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
    let hitDamage=result.amount;if(n==='triplekick'||n==='tripleaxel')hitDamage=Math.floor(hitDamage*(hitNo+1));
    if(target.volatile.substitute>0){
      const subHit=Math.min(hitDamage,target.volatile.substitute);target.volatile.substitute-=subHit;hitDamage=0;
      if(target.volatile.substitute<=0)log(room,target.name+"'s substitute faded!");
    }else{
      if(n==='falseswipe'&&hitDamage>=target.hp)hitDamage=Math.max(0,target.hp-1);
      target.hp=Math.max(0,target.hp-hitDamage);dealt+=hitDamage;
    }
    landed++;
    if(result.crit)log(room,'A critical hit!');
  }
  log(room,mon.name+' used '+move.name+'! '+target.name+' lost '+dealt+' HP.'+(landed>1?' Hit '+landed+' times!':''));
  if(dealt>0){if(target.volatile.bideTurns>0)target.volatile.bideDamage+=dealt;target.volatile.lastDamageTaken=dealt;target.volatile.lastDamageCategory=move.category;target.volatile.lastDamagedTurn=room.turn;target.volatile.rageFistHits=(target.volatile.rageFistHits||0)+1;}
  if(lastResult&&lastResult.eff>1)log(room,"It's super effective!");else if(lastResult&&lastResult.eff<1)log(room,"It's not very effective...");
  if(dealt>0&&hasItem(target,'Air Balloon')){target.item='';log(room,target.name+"'s Air Balloon popped!");}
  if(n==='snore'&&target.hp>0&&chance(30))target.volatile.flinch=true;
  if(n==='upperhand'&&target.hp>0)target.volatile.flinch=true;
  if(target.hp>0)secondaryEffect(room,mon,target,move);
  contactReaction(room,mon,target,move,dealt);
  if(dealt>0&&target.hp>0){
    if(hasAbility(target,'Stamina'))boost(room,target,'def',1);
    if(hasAbility(target,'Weak Armor')&&move.category==='Physical'){boost(room,target,'def',-1);boost(room,target,'spe',2);}
    if(hasAbility(target,'Water Compaction')&&move.type==='Water')boost(room,target,'def',2);
    if(hasAbility(target,'Steam Engine')&&(move.type==='Water'||move.type==='Fire'))boost(room,target,'spe',6);
    if(lastResult&&lastResult.crit&&hasAbility(target,'Anger Point')){target.stages.atk=6;log(room,target.name+"'s Anger Point maximized its Attack!");}
    if(hasAbility(target,'Berserk')&&target.hp<=target.maxHP/2&&target.hp+dealt>target.maxHP/2)boost(room,target,'spa',1);
    if(hasAbility(mon,'Poison Touch')&&isContactMove(move)&&chance(30))setStatus(room,target,'poison');
  }
  checkConsumable(room,target);checkConsumable(room,mon);
  if(lastResult&&lastResult.eff>1&&hasItem(target,'Weakness Policy')&&target.hp>0){consumeItem(room,target);boost(room,target,'atk',2);boost(room,target,'spa',2);}
  if(RECHARGE_MOVES.has(n)&&mon.hp>0)mon.volatile.recharge=true;
  if(n==='knockoff'&&target.item){log(room,target.name+"'s "+target.item+' was knocked off!');target.item='';}
  if(primaryEffect==='aurawheel')boost(room,mon,'spe',1);
  if(primaryEffect==='gravapple')boost(room,target,'def',-1);
  if(primaryEffect==='statchangeonstatus'&&mon.status)boost(room,mon,'atk',1);
  if(primaryEffect==='naturalgift'&&mon.item&&/berry/i.test(mon.item))consumeItem(room,mon);

  if(n==='fling'&&mon.item){var flung=mon.item;mon.item='';mon.volatile.recycledItem=flung;log(room,mon.name+' flung its '+flung+'!');}
  if(n==='dreameater'&&dealt>0)heal(room,mon,Math.max(1,Math.floor(dealt/2)),'Dream Eater');
  if(n==='rollout'||n==='iceball')mon.volatile.rollout=Math.min(4,(mon.volatile.rollout||0)+1);else mon.volatile.rollout=0;
  if(n==='ragingbull'){const own=room.players.find(pl=>pl.team.includes(target));if(own){own.side.reflect=0;own.side.lightScreen=0;own.side.auroraVeil=0;log(room,'The protective screens were shattered!');}}
  if(n==='aurawheel'&&dealt>0)boost(room,mon,'spe',1);
  if(n==='gravapple'&&dealt>0)boost(room,target,'def',-1);
  if(n==='hyperspacefury'&&dealt>0)boost(room,mon,'def',-1);
  if(n==='burnup'&&dealt>0)mon.types=mon.types.filter(t=>t!=='Fire');
  if(n==='doubleshock'&&dealt>0)mon.types=mon.types.filter(t=>t!=='Electric');
  if(n==='fellstinger'&&target.hp<=0)boost(room,mon,'atk',3);
  if(n==='stoneaxe'&&target.hp>=0){foe.side.stealthRock=true;log(room,'Pointed stones were scattered around the opposing team!');}
  if(n==='ceaselessedge'&&target.hp>=0){foe.side.spikes=clamp((foe.side.spikes||0)+1,0,3);log(room,'Spikes were scattered around the opposing team!');}
  if(n==='icespinner'&&room.terrain){room.terrain=null;room.terrainTurns=0;log(room,'The terrain was destroyed!');}
  if(n==='steelroller'&&room.terrain){room.terrain=null;room.terrainTurns=0;log(room,'The terrain was destroyed!');}
  if(n==='scaleshot'&&landed>0){boost(room,mon,'def',-1);boost(room,mon,'spe',1);}
  if(n==='smackdown'&&target.hp>0){target.volatile.smackedDown=true;log(room,target.name+' was knocked down!');}
  if(n==='saltcure'&&target.hp>0){target.volatile.saltCure=true;log(room,target.name+' was salt cured!');}
  if(n==='clearsmog'&&target.hp>0){target.stages={atk:0,def:0,spa:0,spd:0,spe:0,acc:0,eva:0};log(room,target.name+"'s stat changes were eliminated!");}
  if(n==='mortalspin'){clearHazards(p.side);if(target.hp>0)setStatus(room,target,'poison');log(room,mon.name+" cleared its side's hazards!");}
  if(n==='rapidspin'){clearHazards(p.side);boost(room,mon,'spe',1);log(room,mon.name+" cleared its side's hazards!");}
  if(n==='defog'){clearHazards(p.side);clearHazards(foe.side);foe.side.reflect=0;foe.side.lightScreen=0;log(room,'Defog cleared hazards and screens!');}
  if(n==='uturn'||n==='voltswitch'||n==='flipturn'||effectKey(move)==='hitescape')pivotSwitch(room,pi,false);
  if(effectKey(move)==='hitswitchtarget'&&target.hp>0){const slot=randomBenchSlot(foe);if(slot>=0)doSwitch(room,other(pi),slot);}
  if(effectKey(move)==='weatherandswitch'){room.weather='snow';room.weatherTurns=5;pivotSwitch(room,pi,false);}
  if(effectKey(move)==='stealitem'&&!mon.item&&target.item){mon.item=target.item;target.item='';log(room,mon.name+' stole the item!');}
  if(effectKey(move)==='maxhp50recoil'&&!hasAbility(mon,'Magic Guard'))hurt(room,mon,Math.max(1,Math.floor(mon.maxHP/2)),'recoil');
  if(effectKey(move)==='struggle'&&!hasAbility(mon,'Magic Guard'))hurt(room,mon,Math.max(1,Math.floor(mon.maxHP/4)),'Struggle recoil');
  if(n==='dragontail'||n==='circlethrow'){const slot=randomBenchSlot(foe);if(slot>=0&&target.hp>0)doSwitch(room,other(pi),slot);}
  if(dealt>0&&(n.includes('drain')||['gigadrain','megadrain','leechlife','drainingkiss','hornleech'].includes(n))) heal(room,mon,Math.max(1,Math.floor(dealt/2)),move.name);
  if(dealt>0&&RECOIL_MOVES.has(n)&&!hasAbility(mon,'Rock Head')&&!hasAbility(mon,'Magic Guard')) hurt(room,mon,Math.max(1,Math.floor(dealt/3)),'recoil');
  if(hasItem(mon,'Life Orb')&&dealt>0&&mon.hp>0&&!hasAbility(mon,'Magic Guard')) hurt(room,mon,Math.max(1,Math.floor(mon.maxHP/10)),'Life Orb');
  if(hasItem(mon,'Shell Bell')&&dealt>0&&mon.hp>0&&mon.volatile.healBlock<=0)heal(room,mon,Math.max(1,Math.floor(dealt/8)),'Shell Bell');
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
      aquaRing:false,ingrain:false,healBlock:0,saltCure:false,rageFistHits:0,lastDamageTaken:0,lastDamagedTurn:0,noRetreat:false,focusEnergy:0,lockOn:false,magnetRise:0,tarShot:false,octolock:false,recycledItem:'',actedTurn:0,statsLoweredTurn:0,smackedDown:false,endure:false,laserFocus:0,nightmare:false,infatuated:false,stockpile:0,rollout:0,uproar:0,throatChop:0,grudge:false,embargo:0,telekinesis:0,switchInTurn:0,beakBlast:false,magicCoat:false,imprison:false,usedMoves:[],lastDamageCategory:null,bideTurns:0,bideDamage:0,identified:false,miracleEye:false,snatch:false,skyDrop:false,glaiveRush:0}; }
  p.active=slot; active(p).volatile.switchInTurn=room.turn; log(room,p.name+' switched to '+active(p).name+'!'); onSwitchIn(room,pi);
}
function endTurn(room){
  for(let i=0;i<2;i++){
    const p=room.players[i], mon=active(p); if(!alive(mon)) continue;
    if(mon.status==='burn'&&!hasAbility(mon,'Magic Guard')) hurt(room,mon,Math.max(1,Math.floor(mon.maxHP/16)),'its burn');
    else if(mon.status==='poison'&&!hasAbility(mon,'Magic Guard')&&!hasAbility(mon,'Poison Heal')) hurt(room,mon,Math.max(1,Math.floor(mon.maxHP/8)),'poison');
    else if(mon.status==='toxic'&&!hasAbility(mon,'Magic Guard')&&!hasAbility(mon,'Poison Heal')){hurt(room,mon,Math.max(1,Math.floor(mon.maxHP*(mon.toxicCounter||1)/16)),'bad poison');mon.toxicCounter=clamp((mon.toxicCounter||1)+1,1,15);}
    if((mon.status==='poison'||mon.status==='toxic')&&hasAbility(mon,'Poison Heal'))heal(room,mon,Math.max(1,Math.floor(mon.maxHP/8)),'Poison Heal');
    if(mon.volatile.bideTurns>0&&--mon.volatile.bideTurns===0&&mon.volatile.bideDamage>0){const foeMon=active(room.players[other(i)]),d=Math.min(foeMon.hp,mon.volatile.bideDamage*2);foeMon.hp-=d;log(room,mon.name+' unleashed Bide for '+d+' damage!');mon.volatile.bideDamage=0;}
    if(mon.volatile.yawn>0&&--mon.volatile.yawn===0)setStatus(room,mon,'sleep');
    if(mon.volatile.perish>0){mon.volatile.perish--;log(room,mon.name+"'s perish count fell to "+mon.volatile.perish+'!');if(mon.volatile.perish===0)mon.hp=0;}
    if(mon.volatile.saltCure&&!hasAbility(mon,'Magic Guard'))hurt(room,mon,Math.max(1,Math.floor(mon.maxHP*(hasType(mon,'Water')||hasType(mon,'Steel')?1/4:1/8))),'Salt Cure');
    if(mon.volatile.cursed&&!hasAbility(mon,'Magic Guard'))hurt(room,mon,Math.max(1,Math.floor(mon.maxHP/4)),'the curse');
    if(mon.volatile.nightmare&&mon.status==='sleep'&&!hasAbility(mon,'Magic Guard'))hurt(room,mon,Math.max(1,Math.floor(mon.maxHP/4)),'Nightmare');
    if(mon.status!=='sleep')mon.volatile.nightmare=false;
    if(mon.volatile.seeded&&!hasAbility(mon,'Magic Guard')){
      const dmg=Math.max(1,Math.floor(mon.maxHP/8)); const actual=hurt(room,mon,dmg,'Leech Seed');
      const foe=active(room.players[other(i)]); if(foe&&alive(foe)) heal(room,foe,actual,'Leech Seed');
    }
    if(mon.volatile.aquaRing&&mon.volatile.healBlock<=0)heal(room,mon,Math.max(1,Math.floor(mon.maxHP/16)),'Aqua Ring');
    if(mon.volatile.ingrain&&mon.volatile.healBlock<=0)heal(room,mon,Math.max(1,Math.floor(mon.maxHP/16)),'Ingrain');
    if(hasItem(mon,'Leftovers')&&mon.volatile.healBlock<=0) heal(room,mon,Math.max(1,Math.floor(mon.maxHP/16)),'Leftovers');
    if(hasItem(mon,'Black Sludge')) hasType(mon,'Poison')?heal(room,mon,Math.max(1,Math.floor(mon.maxHP/16)),'Black Sludge'):hurt(room,mon,Math.max(1,Math.floor(mon.maxHP/8)),'Black Sludge');
    if(hasItem(mon,'Flame Orb')&&!mon.status)setStatus(room,mon,'burn');
    if(hasItem(mon,'Toxic Orb')&&!mon.status)setStatus(room,mon,'toxic');
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
    p.side.reflect=Math.max(0,p.side.reflect-1);p.side.lightScreen=Math.max(0,p.side.lightScreen-1);p.side.auroraVeil=Math.max(0,p.side.auroraVeil-1);p.side.safeguard=Math.max(0,p.side.safeguard-1);p.side.mist=Math.max(0,p.side.mist-1);p.side.luckyChant=Math.max(0,p.side.luckyChant-1);p.side.tailwind=Math.max(0,p.side.tailwind-1);
    if(mon.volatile.taunt>0) mon.volatile.taunt--;
    if(mon.volatile.disableTurns>0&&--mon.volatile.disableTurns===0)mon.volatile.disabledMove=null;
    if(mon.volatile.healBlock>0)mon.volatile.healBlock--;
    if(mon.volatile.embargo>0)mon.volatile.embargo--;
    if(mon.volatile.laserFocus>0)mon.volatile.laserFocus--;
    if(mon.volatile.telekinesis>0)mon.volatile.telekinesis--;
    if(mon.volatile.throatChop>0)mon.volatile.throatChop--;
    if(mon.volatile.magnetRise>0)mon.volatile.magnetRise--;
    if(mon.volatile.octolock){boost(room,mon,'def',-1);boost(room,mon,'spd',-1);}
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
  if(room.fairyLock>0)room.fairyLock--;
  if(room.waterSport>0)room.waterSport--;
  if(room.mudSport>0)room.mudSport--;
  room.ionDeluge=false;
  if(room.gravityTurns>0&&--room.gravityTurns===0){room.gravity=false;log(room,'Gravity returned to normal.');}
  if(room.magicRoomTurns>0&&--room.magicRoomTurns===0){room.magicRoom=false;log(room,'Magic Room wore off.');}
  if(room.wonderRoomTurns>0&&--room.wonderRoomTurns===0){room.wonderRoom=false;log(room,'Wonder Room wore off.');}
  resetTurnVolatiles(room);
}
function resolveTurn(room){
  const choices=room.players.map(p=>p.choice); if(choices.some(c=>!c)) return;
  const pursuitAttackers=[0,1].filter(i=>choices[i].type==='move'&&effectKey((active(room.players[i]).moves||[])[choices[i].moveIndex]||{})==='pursuit'&&choices[other(i)].type==='switch');
  pursuitAttackers.forEach(i=>{
    const mv=active(room.players[i]).moves[choices[i].moveIndex],oldPower=mv.power;
    mv.power=Math.max(1,(oldPower||40)*2);resolveAttack(room,i,choices[i]);mv.power=oldPower;choices[i]={type:'done'};
  });
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
    if(req.method==='GET'&&url.pathname==='/health') return json(res,200,{ok:true,rooms:rooms.size,engine:'advanced-v18'});
    if(req.method==='GET'&&url.pathname==='/rooms'){
      const openRooms=[];
      for(const room of rooms.values()){
        if(room.phase!=='lobby'||room.players.length>=2) continue;
        openRooms.push({
          code:room.code,
          host:(room.players[0]&&room.players[0].name)||'Host',
          players:room.players.length,
          teamSize:(room.players[0]&&room.players[0].team&&room.players[0].team.length)||0,
          createdAt:room.createdAt,
          updatedAt:room.updatedAt
        });
      }
      openRooms.sort((a,b)=>b.updatedAt-a.updatedAt);
      return json(res,200,{ok:true,rooms:openRooms});
    }
    if(req.method==='POST'&&url.pathname==='/rooms'){
      const body=await readBody(req), code=roomCode(), playerId=id(), team=cleanTeam(body.team);
      if(!team.length) return json(res,400,{error:'Load a save with at least one party Pokémon first.'});
      const room={code,phase:'lobby',turn:0,winner:null,reward:null,kickedIds:[],createdAt:Date.now(),updatedAt:Date.now(),log:[],weather:null,weatherTurns:0,terrain:null,terrainTurns:0,
        rules:{format:'singles',teamSize:Math.max(1,Math.min(6,Number(body.rules&&body.rules.teamSize)||6))},
        players:[{id:playerId,name:cleanText(body.name,24)||'Host',team,ready:false,active:0,choice:null,side:{}}]};
      rooms.set(code,room); return json(res,200,{code,playerId,playerIndex:0,room:publicRoom(room,0)});
    }
    const match=url.pathname.match(/^\/rooms\/([A-Z0-9]{6})(?:\/(join|action))?$/);
    if(!match) return json(res,404,{error:'Not found'});
    const room=rooms.get(match[1]); if(!room) return json(res,404,{error:'Room not found or expired.'});
    room.updatedAt=Date.now();
    if(req.method==='GET'&&!match[2]){
      const playerId=url.searchParams.get('playerId'); const pi=playerIndex(room,playerId);
      if(pi<0&&Array.isArray(room.kickedIds)&&room.kickedIds.includes(playerId)) return json(res,410,{error:'You were removed from the room by the host.'});
      if(pi<0) return json(res,403,{error:'Invalid player token.'});
      return json(res,200,{room:publicRoom(room,pi),playerIndex:pi});
    }
    if(req.method==='POST'&&match[2]==='join'){
      if(room.players.length>=2) return json(res,409,{error:'This room is full.'});
      if(room.phase!=='lobby') return json(res,409,{error:'This battle already started.'});
      const body=await readBody(req), team=cleanTeam(body.team); if(!team.length) return json(res,400,{error:'Load a save with at least one party Pokémon first.'});
      const playerId=id(); room.players.push({id:playerId,name:cleanText(body.name,24)||'Challenger',team,ready:false,active:0,choice:null,side:{}});
      log(room,room.players[1].name+' joined the room.'); return json(res,200,{code:room.code,playerId,playerIndex:1,room:publicRoom(room,1)});
    }
    if(req.method==='POST'&&match[2]==='action'){
      const body=await readBody(req), pi=playerIndex(room,body.playerId);
      if(pi<0&&Array.isArray(room.kickedIds)&&room.kickedIds.includes(body.playerId)) return json(res,410,{error:'You were removed from the room by the host.'});
      if(pi<0) return json(res,403,{error:'Invalid player token.'});
      const p=room.players[pi];
      if(body.type==='kick'&&room.phase==='lobby'){
        if(pi!==0) return json(res,403,{error:'Only the host can remove players.'});
        if(room.players.length<2) return json(res,400,{error:'There is no opponent to remove.'});
        const removed=room.players[1];
        room.kickedIds=Array.isArray(room.kickedIds)?room.kickedIds:[];
        room.kickedIds.push(removed.id);
        room.players.splice(1,1);
        room.players[0].ready=false;
        log(room,removed.name+' was removed from the room by the host.');
      }else if(body.type==='forfeit'&&room.phase==='battle'){
        finishBattle(room,other(pi),p.name+' forfeited. '+room.players[other(pi)].name+' won the battle!');
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
      return json(res,200,{room:publicRoom(room,pi),playerIndex:pi});
    }
    return json(res,405,{error:'Method not allowed'});
  }catch(err){ return json(res,400,{error:err.message||String(err)}); }
});
const ready=new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(PORT,HOST,()=>{console.log('Brisk battle relay listening on http://'+HOST+':'+PORT+' (advanced-v18)');resolve(server.address());});
});
ready.catch(err=>console.error('Battle relay could not start:',err.message));
module.exports={server,ready};

// EFFECT_COVERAGE: Aura Wheel | Bide | Change Type On Item | Dark Void | Dynamax Double Dmg | Fail If Not Arg Type | Fickle Beam | Foresight | Fusion Combo | Geomancy | Grav Apple | Hidden Power | Hit Enemy Heal Ally | Hyperspace Fury | Instruct | Ivy Cudgel | Mat Block | Max Move | Me First | Miracle Eye | Natural Gift | Pursuit | Semi Invulnerable | Shell Trap | Sky Drop | Snatch | Snipe Shot | Species Power Override | Stat Change On Status | Super Effective On Arg | Tera Starstorm | Triple Kick | Two Turns Attack | Two Typed Move
