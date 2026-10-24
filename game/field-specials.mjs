import {assert,integer} from './model.mjs';
export function tileAt(state,map,x,y){
  const change=state.metatiles?.[map.id]?.[`${x},${y}`];if(!change)return map.tiles[y]?.[x];
  if(change.blocked)return '#';const behavior=map.metatileAtlas?.behaviors[change.id]||'';
  return /(?:TALL|LONG)_GRASS/.test(behavior)?'g':/(?:WATER|POND|OCEAN)/.test(behavior)&&!behavior.includes('SHALLOW')?'~':'.';
}
export function setMetatile(state,map,x,y,id,blocked){
  integer(x,0,map.width-1,'metatile x');integer(y,0,map.height-1,'metatile y');integer(id,0,1023,'metatile id');assert(map.metatileAtlas?.behaviors[id]!==undefined,'Missing metatile graphics '+id);
  state.metatiles??={};state.metatiles[map.id]??={};state.metatiles[map.id][`${x},${y}`]={id,blocked:!!blocked};
}
// Ported from src/field_specials.c; map coordinates exclude the engine border.
export function fieldSpecial(name,state,map,constants){
  const id=key=>{assert(Number.isInteger(constants[key]),'Missing field constant '+key);return constants[key];};
  const put=(x,y,key,blocked=false)=>setMetatile(state,map,x,y,id(key),blocked);
  if(name==='MauvilleGymPressSwitch'||name==='MauvilleGymDeactivatePuzzle'){
    const switches=[[0,15],[4,12],[3,9],[8,9]];
    switches.forEach(([x,y],i)=>put(x,y,'METATILE_MauvilleGym_'+(name==='MauvilleGymDeactivatePuzzle'||i===(state.vars?.VAR_0x8004||0)?'PressedSwitch':'RaisedSwitch')));
    if(name==='MauvilleGymDeactivatePuzzle'){
      const names=new Map(Object.entries(constants).filter(([key])=>key.startsWith('METATILE_MauvilleGym_')).map(([key,id])=>[id,key]));
      for(let y=5;y<17;y++)for(let x=0;x<9;x++){
        const current=state.metatiles?.[map.id]?.[`${x},${y}`]?.id??map.metatileIds[y][x],key=names.get(current)||'';
        if(/(?:Green|Red)BeamH[1-4]_On$/.test(key))put(x,y,key.replace(/_On$/,'_Off'));
        else if(/(?:Green|Red)BeamV1_On$/.test(key))put(x,y,'METATILE_MauvilleGym_PoleBottom_'+(key.includes('Green')?'On':'Off'),true);
        else if(/(?:Green|Red)BeamV2_On$/.test(key))put(x,y,'METATILE_MauvilleGym_FloorTile');
        else if(key==='METATILE_MauvilleGym_PoleTop_On')put(x,y,'METATILE_MauvilleGym_PoleTop_Off');
      }
    }
    return true;
  }
  if(name==='PetalburgGymUnlockRoomDoors'||name==='PetalburgGymSlideOpenRoomDoors'){
    const rooms={1:[[1,104],[7,104]],2:[[1,78],[7,78]],3:[[1,91],[7,91]],4:[[7,39]],5:[[1,52],[7,52]],6:[[1,65]],7:[[7,13]],8:[[1,26]]},coords=rooms[state.vars?.VAR_0x8004];assert(coords,'Invalid Petalburg room');
    for(const [x,y]of coords){const value=id('METATILE_PetalburgGym_SlidingDoor_Frame4');setMetatile(state,map,x,y,value,true);setMetatile(state,map,x,y+1,value+8,true);}return true;
  }
  if(name==='ResetHealLocationFromDewford'){if(state.respawn?.map?.includes('dewford'))state.respawn={map:'map_petalburg_city_pokemon_center_1f',x:7,y:4};return true;}
  if(name==='StorePlayerCoordsInVars'){state.vars??={};state.vars.VAR_0x8004=state.position.x;state.vars.VAR_0x8005=state.position.y;return true;}
  return false;
}
