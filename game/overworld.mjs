// Encounter species/levels come from the map's source table. Wildlife uses the
// campaign RNG, so exporting/reloading cannot reroll a visible Pokémon.
export function refreshWildlife(campaign){
 const s=campaign.state,p=s.position;
 if(s.wildlife?.map!==p.map)s.wildlife={map:p.map,actors:[]};
 const actors=s.wildlife.actors;
 if(!s.options.encounters||s.options.overworldEncounters!==true||!s.party.length){actors.length=0;return;}
 if(s.wildlife.movedAt!==s.steps){s.wildlife.movedAt=s.steps;for(const actor of actors){if(Math.abs(actor.x-p.x)+Math.abs(actor.y-p.y)<=1||campaign.random.next()>.4)continue;const [dx,dy,facing]=[[0,1,'down'],[0,-1,'up'],[-1,0,'left'],[1,0,'right']][campaign.random.int(0,3)],x=actor.x+dx,y=actor.y+dy,from=campaign.catalog.fieldData?.tileAttributes?.[campaign.behavior(actor.x,actor.y)],to=campaign.catalog.fieldData?.tileAttributes?.[campaign.behavior(x,y)];if(!to?.encounters||!!from?.surfable!==!!to.surfable||!campaign.canOccupy(x,y,campaign.map,to.surfable?'surf':'land')||actors.some(a=>a.x===x&&a.y===y)||x===p.x&&y===p.y)continue;actor.x=x;actor.y=y;actor.facing=facing;}}

 for(let i=actors.length-1;i>=0;i--)if(Math.abs(actors[i].x-p.x)+Math.abs(actors[i].y-p.y)>16||s.steps-actors[i].born>60)actors.splice(i,1);
 if(actors.length>=3)return;
 const candidates=[];
 for(let y=Math.max(0,p.y-5);y<Math.min(campaign.map.height,p.y+6);y++)for(let x=Math.max(0,p.x-7);x<Math.min(campaign.map.width,p.x+8);x++){
  const distance=Math.abs(x-p.x)+Math.abs(y-p.y),attrs=campaign.catalog.fieldData?.tileAttributes?.[campaign.behavior(x,y)];
  if(distance<4||distance>9||!attrs?.encounters||!campaign.canOccupy(x,y,campaign.map,attrs.surfable?'surf':'land')||actors.some(a=>a.x===x&&a.y===y)||campaign.map.events.some(e=>e.x===x&&e.y===y))continue;
  const table=campaign.mapInfo.encounters?.[attrs.surfable?'water_mons':'land_mons'];if(table?.slots.some(e=>e.species))candidates.push({x,y,table});
 }
 while(actors.length<3&&candidates.length){const i=campaign.random.int(0,candidates.length-1),{x,y,table}=candidates.splice(i,1)[0],result=campaign.chooseEncounter(table.slots.filter(e=>e.species),false);if(result)actors.push({x,y,mon:result.mon,born:s.steps});}
}
export function wildAt(campaign,x,y){return campaign.state.wildlife?.map===campaign.map.id?campaign.state.wildlife.actors.find(a=>a.x===x&&a.y===y):null;}
export function meetWildlife(campaign,x,y){const actor=wildAt(campaign,x,y);if(!actor)return null;campaign.state.wildlife.actors.splice(campaign.state.wildlife.actors.indexOf(actor),1);campaign.mark('seen',actor.mon.species);return {kind:'encounter',mon:actor.mon};}
