import {assert} from './model.mjs';
export const DIRECTIONS={1:[0,1],2:[0,-1],3:[-1,0],4:[1,0]};
export function fieldRule(catalog,name){return catalog.fieldData?.fieldMoves?.[name];}
export function fieldMoveUser(catalog,state,name,checkUnlocked=true){
  const rule=fieldRule(catalog,name);if(!rule)return -1;
  if(checkUnlocked&&(rule.unlockType==='CANT_UNLOCK'||rule.unlockType==='BADGE_UNLOCK'&&!state.flags[rule.badge]))return -1;
  // Brisk's ScrCmd_checkfieldmove deliberately does not require a learned HM,
  // and includes fainted (non-egg) party members for the field animation.
  return state.party.findIndex(mon=>!rule.requiresKnownMove||mon.moves.some(m=>catalog.data.moveDetails[m.id]?.constant===rule.move));
}
export function behaviorAt(catalog,state,map,x,y){
  const change=state.metatiles?.[map.id]?.[`${x},${y}`];return change?map.metatileAtlas?.behaviors[change.id]||'MB_NORMAL':map.behaviors?.[y]?.[x]||'MB_NORMAL';
}
export function sourceWater(catalog,state,map,x,y){return !!catalog.fieldData?.tileAttributes?.[behaviorAt(catalog,state,map,x,y)]?.surfable;}
export function diveConnection(campaign){
  const p=campaign.state.position,under=campaign.mapInfo.mapType==='MAP_TYPE_UNDERWATER',behavior=campaign.behavior(p.x,p.y);
  if(under?['MB_NO_SURFACING','MB_SEAWEED_NO_SURFACING'].includes(behavior):!['MB_DEEP_WATER','MB_INTERIOR_DEEP_WATER','MB_SOOTOPOLIS_DEEP_WATER'].includes(behavior))return null;
  const link=campaign.map.connections?.find(c=>c.direction===(under?'emerge':'dive')),dest=campaign.pack.maps[link?.map];if(!dest)return null;
  if(!campaign.canOccupy(p.x,p.y,dest,under?'surf':'underwater'))return null;
  return {map:dest.id,x:p.x,y:p.y,mode:under?'surf':'underwater'};
}
export function applyFieldEffect(campaign,name){
  const state=campaign.state,p=state.position,[dx,dy]=DIRECTIONS[state.vars?.VAR_FACING]||[0,1],frames=[];
  if(name==='FLDEFF_USE_SURF'){
    assert(fieldMoveUser(campaign.catalog,state,'FIELD_MOVE_SURF')>=0,'Surf is locked');assert(campaign.mode==='land','Already swimming');
    const x=p.x+dx,y=p.y+dy;assert(campaign.fishable(x,y)&&campaign.canOccupy(x,y,campaign.map,'surf'),'Cannot Surf here');state.field={mode:'surf'};p.x=x;p.y=y;state.steps++;frames.push({x,y,facing:{1:'down',2:'up',3:'left',4:'right'}[state.vars?.VAR_FACING]||'down'});
  }else if(name==='FLDEFF_USE_DIVE'){
    assert(fieldMoveUser(campaign.catalog,state,'FIELD_MOVE_DIVE')>=0,'Dive is locked');const dest=diveConnection(campaign);assert(dest,'Cannot Dive or surface here');state.field={mode:dest.mode};campaign.enterMap({map:dest.map,x:dest.x,y:dest.y});
  }else if(name==='FLDEFF_USE_WATERFALL'){
    assert(fieldMoveUser(campaign.catalog,state,'FIELD_MOVE_WATERFALL')>=0,'Waterfall is locked');assert(campaign.mode==='surf'&&dy===-1&&campaign.behavior(p.x,p.y-1)==='MB_WATERFALL','Face the waterfall while Surfing');
    let y=p.y-1;for(;y>=0&&campaign.behavior(p.x,y)==='MB_WATERFALL';y--){assert(campaign.canOccupy(p.x,y,campaign.map,'surf',true),'The waterfall is blocked');frames.push({x:p.x,y,facing:'up'});}
    assert(y>=0&&campaign.tile(p.x,y)==='~'&&campaign.canOccupy(p.x,y,campaign.map,'surf'),'No waterfall landing');frames.push({x:p.x,y,facing:'up'});p.y=y;state.steps+=frames.length;
  }else if(['FLDEFF_USE_CUT_ON_TREE','FLDEFF_USE_ROCK_SMASH','FLDEFF_USE_STRENGTH'].includes(name)){const move={FLDEFF_USE_CUT_ON_TREE:'CUT',FLDEFF_USE_ROCK_SMASH:'ROCK_SMASH',FLDEFF_USE_STRENGTH:'STRENGTH'}[name];assert(fieldMoveUser(campaign.catalog,state,'FIELD_MOVE_'+move)>=0,move+' is locked');if(move==='STRENGTH')state.flags.FLAG_SYS_USE_STRENGTH=true;
  }else throw new Error('Unsupported traversal effect '+name);
  return frames;
}
