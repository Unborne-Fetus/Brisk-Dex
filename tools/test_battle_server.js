#!/usr/bin/env node
'use strict';

const {spawn} = require('child_process');
const path = require('path');
const fs = require('fs');

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'brisk-dex-data.json'), 'utf8'));
const GEN3_SUB_ORDERS=['GAEM','GAME','GEAM','GEMA','GMAE','GMEA','AGEM','AGME','AEGM','AEMG','AMGE','AMEG','EGAM','EGMA','EAGM','EAMG','EMGA','EMAG','MGAE','MGEA','MAGE','MAEG','MEGA','MEAG'];

const port = 18787;
const base = 'http://127.0.0.1:' + port;
const server = spawn(process.execPath, [path.join(__dirname, '..', 'battle-server.js')], {
  env: Object.assign({}, process.env, {PORT:String(port), HOST:'127.0.0.1'}),
  stdio:['ignore','pipe','pipe']
});

function delay(ms){ return new Promise(r=>setTimeout(r,ms)); }
async function request(pathname, options){
  const response = await fetch(base + pathname, Object.assign({headers:{'Content-Type':'application/json'}}, options||{}));
  const data = await response.json();
  if(!response.ok) throw new Error((data&&data.error)||('HTTP '+response.status));
  return data;
}
function expForLevel(level,growthRate){
  const n=level;
  switch(growthRate){
    case 'fast': return Math.floor(4*n*n*n/5);
    case 'medium_slow': return Math.max(0,Math.floor(6*n*n*n/5-15*n*n+100*n-140));
    case 'slow': return Math.floor(5*n*n*n/4);
    case 'erratic':
      if(n<=50)return Math.floor(n*n*n*(100-n)/50);
      if(n<=68)return Math.floor(n*n*n*(150-n)/100);
      if(n<=98)return Math.floor(n*n*n*Math.floor((1911-10*n)/3)/500);
      return Math.floor(n*n*n*(160-n)/100);
    case 'fluctuating':
      if(n<=15)return Math.floor(n*n*n*(Math.floor((n+1)/3)+24)/50);
      if(n<=36)return Math.floor(n*n*n*(n+14)/50);
      return Math.floor(n*n*n*(Math.floor(n/2)+32)/50);
    default:return n*n*n;
  }
}
function moveDetail(id){
  return (DATA.moveDetails||{})[String(id)]||{};
}
function usableSpecies(){
  return Object.keys(DATA.species||{}).map(Number).filter(id=>{
    const sp=DATA.species[String(id)]||{},abilities=(sp.abilities||[]).filter(Boolean),moves=(sp.learnableMoves||[]).map(Number);
    return id>0&&abilities.length&&moves.some(mid=>{
      const d=moveDetail(mid);
      return d&&d.name&&Number(d.power)>0&&Number(d.pp||((DATA.movePP||{})[String(mid)]||0))>0;
    });
  });
}
function makeRawRecord(speciesId,seed){
  const sp=DATA.species[String(speciesId)];
  if(!sp)throw new Error('Smoke-test species '+speciesId+' is missing from bundled data.');
  const moveId=(sp.learnableMoves||[]).map(Number).find(mid=>{
    const d=moveDetail(mid);
    return d&&d.name&&Number(d.power)>0&&Number(d.pp||((DATA.movePP||{})[String(mid)]||0))>0;
  });
  if(!moveId)throw new Error('Smoke-test species '+speciesId+' has no legal damaging move.');
  const move=moveDetail(moveId),pp=Number(move.pp||((DATA.movePP||{})[String(moveId)]||1));
  const personality=(0x10203040+(seed||1))>>>0,otId=(0x55667788+(seed||1))>>>0,key=(personality^otId)>>>0;
  const raw=Buffer.alloc(80),plain=Buffer.alloc(48),order=GEN3_SUB_ORDERS[personality%24],offsets={};
  for(let i=0;i<4;i++)offsets[order[i]]=i*12;
  raw.writeUInt32LE(personality,0);raw.writeUInt32LE(otId,4);
  // Bit 15 marks verified competitive provenance. Bit 14 remains clear.
  raw.writeUInt16LE(0x8000,0x1e);
  const g=offsets.G,a=offsets.A,e=offsets.E,m=offsets.M;
  const teraType=1; // Normal; valid even when it is not STAB.
  plain.writeUInt16LE((speciesId&0x07ff)|((teraType&0x1f)<<11),g);
  plain.writeUInt16LE(0,g+2);
  plain.writeUInt32LE(expForLevel(50,sp.growthRate)&0x001fffff,g+4);
  plain.writeUInt8(255,g+9);
  plain.writeUInt16LE(moveId&0x07ff,a);
  plain.writeUInt8(Math.max(1,Math.min(127,pp)),a+8);
  // Legal 0 EVs and perfect 31 IVs. Ability slot 0.
  let ivWord=0;for(let i=0;i<6;i++)ivWord|=(31<<(i*5));
  plain.writeUInt32LE(ivWord>>>0,m+4);plain.writeUInt32LE(0,m+8);
  let checksum=0;for(let i=0;i<24;i++)checksum=(checksum+plain.readUInt16LE(i*2))&0xffff;
  raw.writeUInt16LE(checksum,0x1c);
  for(let w=0;w<12;w++)raw.writeUInt32LE((plain.readUInt32LE(w*4)^key)>>>0,0x20+w*4);
  return raw.toString('base64');
}
function mon(name,species,seed){
  return {name,rewardRaw80:makeRawRecord(species,seed)};
}
async function waitForServer(){
  for(let i=0;i<50;i++){
    try{const h=await request('/health');if(h.ok)return h;}catch(e){}
    await delay(100);
  }
  throw new Error('Battle relay did not become healthy.');
}

(async()=>{
  try{
    const health=await waitForServer();
    if(!String(health.engine||'').startsWith('advanced-v')) throw new Error('Unexpected engine version: '+health.engine);

    const eligible=usableSpecies();
    if(eligible.length<2)throw new Error('Bundled data does not contain two smoke-test-compatible species.');
    const hostSpecies=eligible[0],guestSpecies=eligible[1];
    const host=await request('/rooms',{method:'POST',body:JSON.stringify({name:'Host',team:[mon('Alpha',hostSpecies,1)],rules:{format:'singles',teamSize:1}})});
    if(!/^[A-Z0-9]{6}$/.test(host.code)) throw new Error('Room code was not generated correctly.');

    const join=await request('/rooms/'+host.code+'/join',{method:'POST',body:JSON.stringify({name:'Guest',team:[mon('Beta',guestSpecies,2)]})});
    await request('/rooms/'+host.code+'/action',{method:'POST',body:JSON.stringify({playerId:host.playerId,type:'ready',ready:true})});
    let started=await request('/rooms/'+host.code+'/action',{method:'POST',body:JSON.stringify({playerId:join.playerId,type:'ready',ready:true})});
    if(started.room.phase!=='battle'||started.room.turn!==1) throw new Error('Battle did not start after both players readied.');

    const initialHp=started.room.players.map(p=>p.team[0].hp);
    await request('/rooms/'+host.code+'/action',{method:'POST',body:JSON.stringify({playerId:host.playerId,type:'move',moveIndex:0})});
    const turn=await request('/rooms/'+host.code+'/action',{method:'POST',body:JSON.stringify({playerId:join.playerId,type:'move',moveIndex:0})});
    if(turn.room.turn<2&&turn.room.phase==='battle') throw new Error('Turn did not resolve.');
    const hp=turn.room.players.map(p=>p.team[0].hp);
    if(hp.every((v,i)=>v===initialHp[i])) throw new Error('Resolved damaging moves did not change HP.');

    const state=await request('/rooms/'+host.code+'?playerId='+encodeURIComponent(host.playerId));
    if(state.room.code!==host.code) throw new Error('Room state could not be re-read.');
    console.log('Brisk online battle smoke test passed ('+health.engine+').');
  } finally {
    server.kill('SIGTERM');
  }
})().catch(err=>{
  console.error(err.stack||err);
  server.kill('SIGTERM');
  process.exit(1);
});
