import {compileScripts} from './scripts.mjs';
export function mapEntryScripts(map){
  const labels=compileScripts(map.scriptText||''),root=Object.values(labels).find(lines=>lines.some(line=>line.startsWith('map_script ')))||[];
  return root.map(line=>line.match(/^map_script\s+(MAP_SCRIPT_ON_LOAD|MAP_SCRIPT_ON_TRANSITION),\s*(\w+)/)).filter(Boolean).sort((a,b)=>(a[1]==='MAP_SCRIPT_ON_LOAD'?0:1)-(b[1]==='MAP_SCRIPT_ON_LOAD'?0:1)).map(m=>m[2]);
}
export function frameScript(campaign){
  const labels=compileScripts(campaign.map.scriptText||'');
  for(const lines of Object.values(labels))for(const line of lines){
    const pointer=line.match(/^map_script\s+MAP_SCRIPT_ON_FRAME_TABLE,\s*(\w+)/);if(!pointer)continue;
    for(const command of labels[pointer[1]]||[]){const condition=command.match(/^map_script_2\s+(VAR_\w+),\s*(0x[\da-f]+|\d+),\s*(\w+)/i);if(condition&&(campaign.state.vars?.[condition[1]]||0)===Number(condition[2]))return condition[3];}
  }
  return null;
}
export function coordinateScript(campaign){
  const {x,y}=campaign.state.position;
  return (campaign.storyInfo?.coordEvents||campaign.map.coordEvents||[]).find(event=>event.x===x&&event.y===y&&(!event.var||event.var==='0'||(campaign.state.vars?.[event.var]||0)===Number(event.var_value)))?.script||null;
}

export function warpScripts(campaign){const labels=compileScripts(campaign.map.scriptText||''),result=[];for(const lines of Object.values(labels))for(const line of lines){const pointer=line.match(/^map_script\s+MAP_SCRIPT_ON_WARP_INTO_MAP_TABLE,\s*(\w+)/);if(!pointer)continue;for(const command of labels[pointer[1]]||[]){const m=command.match(/^map_script_2\s+(VAR_\w+),\s*(0x[\da-f]+|\d+),\s*(\w+)/i);if(m&&(campaign.state.vars?.[m[1]]||0)===Number(m[2])){result.push(m[3]);break;}}}return result;}

export function sightedTrainers(campaign){
 if(campaign.state.options.trainersTalkOnly)return [];
 const p=campaign.state.position,result=[],seen=new Set();
 for(const event of campaign.visibleEvents()){
  if(event.kind!=='trainer'||campaign.state.flags[event.id]||seen.has(event.id))continue;
  const range=campaign.storyInfo?.trainers?.[event.localId]?.range||0,dir={MOVEMENT_TYPE_FACE_DOWN:[0,1],MOVEMENT_TYPE_FACE_UP:[0,-1],MOVEMENT_TYPE_FACE_LEFT:[-1,0],MOVEMENT_TYPE_FACE_RIGHT:[1,0]}[event.movementType];if(!dir)continue;
  for(let step=1;step<=range;step++){const x=event.x+dir[0]*step,y=event.y+dir[1]*step;if(x===p.x&&y===p.y){seen.add(event.id);result.push(event);break;}if(!campaign.canOccupy(x,y))break;}
 }return result;
}
export function sightedTrainer(campaign){return sightedTrainers(campaign)[0]||null;}
// Interleave teams so each trainer opens with their own lead. Never manufacture
// an extra player Pokémon when the player has fewer than two healthy partners.
export function pairedTrainerBattle(campaign,events){
 const trainers=events.filter((e,i,a)=>!campaign.state.flags[e.id]&&a.findIndex(t=>t.id===e.id)===i).slice(0,2);
 if(trainers.length<2||campaign.state.party.filter(m=>m.hp>0).length<2)return null;
 const teams=trainers.map(e=>campaign.trainerTeam(e.team||campaign.catalog.scriptData?.trainers[e.id]?.party||[]));if(teams.some(t=>!t.length))return null;
 const team=[];for(let i=0;i<Math.max(...teams.map(t=>t.length));i++)for(const members of teams)if(members[i])team.push(members[i]);
 return {team,trainers,ids:trainers.map(e=>e.id),name:trainers.map(e=>e.trainerName||campaign.catalog.scriptData?.trainers[e.id]?.name||'Trainer').join(' & '),format:'doubles'};
}
