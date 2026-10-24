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
  return (campaign.map.coordEvents||[]).find(event=>event.x===x&&event.y===y&&(!event.var||event.var==='0'||(campaign.state.vars?.[event.var]||0)===Number(event.var_value)))?.script||null;
}
