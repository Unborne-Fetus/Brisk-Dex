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

export function sightedTrainer(campaign){
 const p=campaign.state.position;
 for(const event of campaign.visibleEvents()){
  if(event.kind!=='trainer'||campaign.state.flags[event.id])continue;
  const range=campaign.storyInfo?.trainers?.[event.localId]?.range||0,dir={MOVEMENT_TYPE_FACE_DOWN:[0,1],MOVEMENT_TYPE_FACE_UP:[0,-1],MOVEMENT_TYPE_FACE_LEFT:[-1,0],MOVEMENT_TYPE_FACE_RIGHT:[1,0]}[event.movementType];if(!dir)continue;
  for(let step=1;step<=range;step++){const x=event.x+dir[0]*step,y=event.y+dir[1]*step;if(x===p.x&&y===p.y)return event;if(!campaign.canOccupy(x,y))break;}
 }return null;
}
