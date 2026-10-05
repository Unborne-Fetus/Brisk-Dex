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
    req.on('end',()=>{
      try{ resolve(data ? JSON.parse(data) : {}); }catch(err){ reject(err); }
    });
    req.on('error',reject);
  });
}
function code(){
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
function cleanText(value,max=32){ return String(value||'').replace(/[<>]/g,'').slice(0,max); }
function cleanTeam(team){
  if(!Array.isArray(team)) return [];
  return team.slice(0,6).map((mon,index)=>({
    slot:index,
    species:Number(mon.species)||0,
    name:cleanText(mon.name,40)||('Pokémon '+(index+1)),
    level:Math.max(1,Math.min(100,Number(mon.level)||50)),
    types:Array.isArray(mon.types)?mon.types.slice(0,2).map(x=>cleanText(x,20)):[],
    ability:cleanText(mon.ability,50),
    item:cleanText(mon.item,50),
    maxHP:Math.max(1,Number(mon.maxHP)||100),
    atk:Math.max(1,Number(mon.atk)||50),
    def:Math.max(1,Number(mon.def)||50),
    speed:Math.max(1,Number(mon.speed)||50),
    spAtk:Math.max(1,Number(mon.spAtk)||50),
    spDef:Math.max(1,Number(mon.spDef)||50),
    moves:(Array.isArray(mon.moves)?mon.moves:[]).slice(0,4).map(move=>({
      id:Number(move.id)||0,
      name:cleanText(move.name,50)||'Move',
      type:cleanText(move.type,20)||'Normal',
      category:['Physical','Special','Status'].includes(move.category)?move.category:'Status',
      power:Math.max(0,Number(move.power)||0),
      accuracy:Math.max(0,Math.min(100,Number(move.accuracy)||100)),
      priority:Math.max(-7,Math.min(7,Number(move.priority)||0))
    }))
  })).filter(mon=>mon.species>0);
}
function publicRoom(room){
  return {
    code:room.code,
    phase:room.phase,
    rules:room.rules,
    turn:room.turn,
    winner:room.winner,
    log:room.log.slice(-80),
    players:room.players.map(p=>({
      name:p.name,
      ready:p.ready,
      connected:true,
      active:p.active,
      team:p.team.map(mon=>({
        species:mon.species,name:mon.name,level:mon.level,types:mon.types,
        maxHP:mon.maxHP,hp:mon.hp===undefined?mon.maxHP:mon.hp,
        ability:mon.ability,item:mon.item,moves:mon.moves
      }))
    }))
  };
}
function playerIndex(room,playerId){ return room.players.findIndex(p=>p.id===playerId); }
function other(i){ return i===0?1:0; }
function beginBattle(room){
  room.phase='battle';
  room.turn=1;
  room.log.push('Battle started!');
  room.players.forEach(p=>{
    p.team.forEach(mon=>{ mon.hp=mon.maxHP; });
    p.active=Math.max(0,p.team.findIndex(mon=>mon.hp>0));
    p.choice=null;
  });
}
const EFFECT = {
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
  return (types||[]).reduce((m,t)=>m*((EFFECT[type]&&EFFECT[type][t]!==undefined)?EFFECT[type][t]:1),1);
}
function damage(attacker,defender,move){
  if(!move || move.power<=0 || move.category==='Status') return 0;
  const attack = move.category==='Special'?attacker.spAtk:attacker.atk;
  const defense = Math.max(1,move.category==='Special'?defender.spDef:defender.def);
  const base=Math.floor((((2*attacker.level/5+2)*move.power*attack/defense)/50)+2);
  const stab=(attacker.types||[]).includes(move.type)?1.5:1;
  const eff=effectiveness(move.type,defender.types);
  const rand=(85+Math.floor(Math.random()*16))/100;
  return {amount:Math.max(1,Math.floor(base*stab*eff*rand)),eff};
}
function nextAlive(player){
  return player.team.findIndex(mon=>mon.hp>0);
}
function resolveAttack(room,pi,choice){
  const p=room.players[pi], foe=room.players[other(pi)];
  const mon=p.team[p.active], target=foe.team[foe.active];
  if(!mon || mon.hp<=0 || !target || target.hp<=0) return;
  const move=mon.moves[choice.moveIndex];
  if(!move){ room.log.push(mon.name+' has no usable move there.'); return; }
  if(move.accuracy>0 && Math.random()*100>=move.accuracy){
    room.log.push(mon.name+' used '+move.name+', but it missed!');
    return;
  }
  if(move.power<=0 || move.category==='Status'){
    room.log.push(mon.name+' used '+move.name+'. (Status effects are not implemented in the MVP yet.)');
    return;
  }
  const result=damage(mon,target,move);
  target.hp=Math.max(0,target.hp-result.amount);
  room.log.push(mon.name+' used '+move.name+'! '+target.name+' lost '+result.amount+' HP.');
  if(result.eff===0) room.log.push("It doesn't affect "+target.name+'...');
  else if(result.eff>1) room.log.push("It's super effective!");
  else if(result.eff<1) room.log.push("It's not very effective...");
  if(target.hp<=0){
    room.log.push(target.name+' fainted!');
    const next=nextAlive(foe);
    if(next<0){
      room.phase='finished'; room.winner=pi; room.log.push(p.name+' won the battle!');
    }else{
      foe.active=next;
      room.log.push(foe.name+' sent out '+foe.team[next].name+'!');
    }
  }
}
function resolveTurn(room){
  const choices=room.players.map(p=>p.choice);
  if(choices.some(c=>!c)) return;
  const switchers=[0,1].filter(i=>choices[i].type==='switch');
  switchers.forEach(i=>{
    const p=room.players[i], target=Number(choices[i].slot);
    if(p.team[target]&&p.team[target].hp>0&&target!==p.active){
      p.active=target; room.log.push(p.name+' switched to '+p.team[target].name+'!');
    }
  });
  if(room.phase==='battle'){
    const attackers=[0,1].filter(i=>choices[i].type==='move');
    attackers.sort((a,b)=>{
      const ma=room.players[a].team[room.players[a].active].moves[choices[a].moveIndex]||{};
      const mb=room.players[b].team[room.players[b].active].moves[choices[b].moveIndex]||{};
      const pa=Number(ma.priority)||0,pb=Number(mb.priority)||0;
      if(pa!==pb) return pb-pa;
      const sa=room.players[a].team[room.players[a].active].speed||0;
      const sb=room.players[b].team[room.players[b].active].speed||0;
      return sb-sa || (Math.random()<.5?-1:1);
    });
    for(const i of attackers){ if(room.phase==='battle') resolveAttack(room,i,choices[i]); }
  }
  room.players.forEach(p=>p.choice=null);
  if(room.phase==='battle') room.turn++;
}
setInterval(()=>{
  const cutoff=Date.now()-6*60*60*1000;
  for(const [key,room] of rooms) if(room.updatedAt<cutoff) rooms.delete(key);
},15*60*1000).unref();

const server=http.createServer(async (req,res)=>{
  if(req.method==='OPTIONS') return json(res,204,{});
  const url=new URL(req.url,'http://localhost');
  try{
    if(req.method==='GET'&&url.pathname==='/health') return json(res,200,{ok:true,rooms:rooms.size});
    if(req.method==='POST'&&url.pathname==='/rooms'){
      const body=await readBody(req), roomCode=code(), playerId=id();
      const team=cleanTeam(body.team);
      if(!team.length) return json(res,400,{error:'Load a save with at least one party Pokémon first.'});
      const room={
        code:roomCode,phase:'lobby',turn:0,winner:null,createdAt:Date.now(),updatedAt:Date.now(),log:[],
        rules:{format:body.rules&&body.rules.format==='doubles'?'doubles':'singles',teamSize:Math.max(1,Math.min(6,Number(body.rules&&body.rules.teamSize)||6))},
        players:[{id:playerId,name:cleanText(body.name,24)||'Host',team,ready:false,active:0,choice:null}]
      };
      rooms.set(roomCode,room);
      return json(res,200,{code:roomCode,playerId,playerIndex:0,room:publicRoom(room)});
    }
    const match=url.pathname.match(/^\/rooms\/([A-Z0-9]{6})(?:\/(join|action))?$/);
    if(!match) return json(res,404,{error:'Not found'});
    const room=rooms.get(match[1]);
    if(!room) return json(res,404,{error:'Room not found or expired.'});
    room.updatedAt=Date.now();
    if(req.method==='GET'&&!match[2]){
      const playerId=url.searchParams.get('playerId');
      if(playerIndex(room,playerId)<0) return json(res,403,{error:'Invalid player token.'});
      return json(res,200,{room:publicRoom(room),playerIndex:playerIndex(room,playerId)});
    }
    if(req.method==='POST'&&match[2]==='join'){
      if(room.players.length>=2) return json(res,409,{error:'This room is full.'});
      if(room.phase!=='lobby') return json(res,409,{error:'This battle already started.'});
      const body=await readBody(req), team=cleanTeam(body.team);
      if(!team.length) return json(res,400,{error:'Load a save with at least one party Pokémon first.'});
      const playerId=id();
      room.players.push({id:playerId,name:cleanText(body.name,24)||'Challenger',team,ready:false,active:0,choice:null});
      room.log.push(room.players[1].name+' joined the room.');
      return json(res,200,{code:room.code,playerId,playerIndex:1,room:publicRoom(room)});
    }
    if(req.method==='POST'&&match[2]==='action'){
      const body=await readBody(req), pi=playerIndex(room,body.playerId);
      if(pi<0) return json(res,403,{error:'Invalid player token.'});
      const p=room.players[pi];
      if(body.type==='ready'&&room.phase==='lobby'){
        p.ready=!!body.ready;
        if(room.players.length===2&&room.players.every(x=>x.ready)) beginBattle(room);
      }else if(body.type==='move'&&room.phase==='battle'){
        const idx=Number(body.moveIndex);
        if(!Number.isInteger(idx)||idx<0||idx>3) return json(res,400,{error:'Invalid move.'});
        p.choice={type:'move',moveIndex:idx}; resolveTurn(room);
      }else if(body.type==='switch'&&room.phase==='battle'){
        const slot=Number(body.slot);
        if(!Number.isInteger(slot)||!p.team[slot]||p.team[slot].hp<=0||slot===p.active) return json(res,400,{error:'Invalid switch.'});
        p.choice={type:'switch',slot}; resolveTurn(room);
      }else{
        return json(res,400,{error:'That action is not available right now.'});
      }
      return json(res,200,{room:publicRoom(room),playerIndex:pi});
    }
    return json(res,405,{error:'Method not allowed'});
  }catch(err){ return json(res,400,{error:err.message||String(err)}); }
});
server.listen(PORT,HOST,()=>console.log('Brisk battle relay listening on http://'+HOST+':'+PORT));
