#!/usr/bin/env node
'use strict';

const {spawn} = require('child_process');
const path = require('path');

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
function mon(name, species){
  return {
    species, name, level:50, types:['Normal'], ability:'', item:'', teraType:'Normal',
    maxHP:150, atk:100, def:90, speed:100, spAtk:90, spDef:90,
    moves:[
      {id:1,name:'Tackle',type:'Normal',category:'Physical',power:40,accuracy:100,priority:0,pp:35,maxPP:35,flags:['Makes Contact'],effect:'Hit'},
      {id:2,name:'Protect',type:'Normal',category:'Status',power:0,accuracy:100,priority:4,pp:10,maxPP:10,flags:[],effect:'Protect'}
    ]
  };
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

    const host=await request('/rooms',{method:'POST',body:JSON.stringify({name:'Host',team:[mon('Alpha',1)],rules:{format:'singles',teamSize:1}})});
    if(!/^[A-Z0-9]{6}$/.test(host.code)) throw new Error('Room code was not generated correctly.');

    const join=await request('/rooms/'+host.code+'/join',{method:'POST',body:JSON.stringify({name:'Guest',team:[mon('Beta',2)]})});
    await request('/rooms/'+host.code+'/action',{method:'POST',body:JSON.stringify({playerId:host.playerId,type:'ready',ready:true})});
    let started=await request('/rooms/'+host.code+'/action',{method:'POST',body:JSON.stringify({playerId:join.playerId,type:'ready',ready:true})});
    if(started.room.phase!=='battle'||started.room.turn!==1) throw new Error('Battle did not start after both players readied.');

    await request('/rooms/'+host.code+'/action',{method:'POST',body:JSON.stringify({playerId:host.playerId,type:'move',moveIndex:0})});
    const turn=await request('/rooms/'+host.code+'/action',{method:'POST',body:JSON.stringify({playerId:join.playerId,type:'move',moveIndex:0})});
    if(turn.room.turn<2&&turn.room.phase==='battle') throw new Error('Turn did not resolve.');
    const hp=turn.room.players.map(p=>p.team[0].hp);
    if(hp.every(v=>v===150)) throw new Error('Resolved damaging moves did not change HP.');

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
