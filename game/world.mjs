import {connectedPosition} from './connections.mjs';
import {refreshWildlife,meetWildlife} from './overworld.mjs';
import {behaviorAt,sourceWater,fieldMoveUser,diveConnection} from './traversal.mjs';
import {tileAt} from './field-specials.mjs';
import {assert, integer, clone, Random, SAVE_FORMAT, SAVE_VERSION} from './model.mjs';
export const WEATHER_ABILITIES = {Drizzle:'rain','Primordial Sea':'rain',Drought:'sun','Desolate Land':'sun','Orichalcum Pulse':'sun','Sand Stream':'sand','Sand Spit':'sand','Snow Warning':'snow','Delta Stream':'wind'};
export function fieldWeather(map, lead) { return !map.outdoor||map.weatherLocked ? map.weather : WEATHER_ABILITIES[lead?.ability]||map.weather; }
export function validatePack(pack) {
  assert(pack?.format==='brisk-native-content'&&pack.schema===1,'Unsupported content pack');
  assert(typeof pack.version==='string'&&pack.version.length<=80,'Invalid content version');
  assert(pack.maps&&typeof pack.maps==='object','Missing maps');
  const maps=Object.values(pack.maps); assert(maps.length>0&&maps.length<=1000,'Invalid map count');
  for(const [id,map] of Object.entries(pack.maps)) {
    assert(id===map.id&&/^[a-z0-9_-]+$/i.test(id),'Invalid map id'); integer(map.width,1,512,'map width'); integer(map.height,1,512,'map height');
    assert(typeof map.outdoor==='boolean'&&typeof map.weatherLocked==='boolean','Missing weather rules');
    assert(['clear','rain','sun','sand','snow','wind','fog'].includes(map.weather),'Invalid weather');
    assert(map.tiles?.length===map.height&&map.tiles.every(row=>typeof row==='string'&&row.length===map.width&&/^[.g#~bpfhd]+$/.test(row)),'Invalid map tiles');
    assert(Array.isArray(map.events)&&map.events.length<1000,'Invalid events');
    for(const e of map.events) {
      integer(e.x,0,map.width-1,'event x'); integer(e.y,0,map.height-1,'event y');
      assert(['dialogue','heal','shop','trainer','warp'].includes(e.kind),'Unsupported event kind');
      if(e.kind==='warp') { const dest=pack.maps[e.map]; assert(dest,'Missing warp destination'); integer(e.toX,0,dest.width-1,'warp x'); integer(e.toY,0,dest.height-1,'warp y'); assert(!'#~h'.includes(dest.tiles[e.toY][e.toX]),'Warp destination blocked'); }
      if(e.kind==='trainer') { assert(typeof e.id==='string'&&e.id.length<=100,'Missing trainer identity');assert(typeof e.species==='string','Missing trainer species');integer(e.level,1,100,'trainer level'); }
      if(e.text!==undefined)assert(typeof e.text==='string'&&e.text.length<=4000,'Invalid dialogue');
      if(e.kind==='shop') { assert(Array.isArray(e.stock),'Invalid stock'); e.stock.forEach(v=>{integer(v.item,1,10000,'stock item');integer(v.price,0,1000000,'stock price');}); }
    }
    for(const e of map.encounters||[]) { assert(typeof e.species==='string','Invalid encounter'); integer(e.min,1,100,'minimum level'); integer(e.max,e.min,100,'maximum level'); integer(e.weight,1,10000,'encounter weight'); }
  }
  const start=pack.maps[pack.start?.map]; assert(start,'Missing starting map'); integer(pack.start.x,0,start.width-1,'start x'); integer(pack.start.y,0,start.height-1,'start y'); assert(!'#~h'.includes(start.tiles[pack.start.y][pack.start.x]),'Blocked start');
  return pack;
}
function startingFlags(pack){return {...clone(pack.initialFlags||{}),FLAG_SYS_POKEMON_GET:true,FLAG_RESCUED_BIRCH:true,FLAG_HIDE_ROUTE_101_BIRCH_ZIGZAGOON_BATTLE:true,FLAG_HIDE_ROUTE_101_BIRCH_STARTERS_BAG:true,FLAG_HIDE_ROUTE_101_ZIGZAGOON:true,FLAG_HIDE_LITTLEROOT_TOWN_BIRCHS_LAB_BIRCH:false};}
export class Campaign {
  get storyInfo(){return this.catalog.storyData?.maps?.[this.map.id]||{};}
  get mapInfo(){return this.catalog.fieldData?.maps?.[this.map.id]||{};}
  get mode(){return this.state.field?.mode||(this.mapInfo.mapType==='MAP_TYPE_UNDERWATER'?'underwater':'land');}
  behavior(x,y,map=this.map){return behaviorAt(this.catalog,this.state,map,x,y);}
  tile(x,y,map=this.map){
    if(x<0||y<0||x>=map.width||y>=map.height)return '#';const change=this.state.metatiles?.[map.id]?.[`${x},${y}`];
    if(sourceWater(this.catalog,this.state,map,x,y)){if(change?.blocked||!change&&this.catalog.fieldData?.maps?.[map.id]?.blockedWater?.includes(`${x},${y}`))return '#';return '~';}
    return tileAt(this.state,map,x,y);
  }
  canOccupy(x,y,map=this.map,mode=this.mode,waterfall=false){if(map.id===this.map.id&&this.state.dynamicWarp&&this.storyInfo.warpEvents?.some(e=>e.x===x&&e.y===y&&e.dest_map==='MAP_DYNAMIC'))return true;const tile=this.tile(x,y,map);return tile!==undefined&&!('#h'.includes(tile))&&(tile!=='~'||mode==='surf'||mode==='underwater')&&(waterfall||this.behavior(x,y,map)!=='MB_WATERFALL')&&!this.visibleEvents(map).some(e=>e.x===x&&e.y===y&&e.kind!=='warp'&&e.solid!==false);}
  forcedDirection(){return this.mode==='surf'?{MB_EASTWARD_CURRENT:[1,0],MB_WESTWARD_CURRENT:[-1,0],MB_NORTHWARD_CURRENT:[0,-1],MB_SOUTHWARD_CURRENT:[0,1]}[this.behavior(this.state.position.x,this.state.position.y)]||null:null;}
  fishable(x,y){return this.tile(x,y)==='~'&&!!this.catalog.fieldData?.fishableBehaviors?.includes(this.behavior(x,y));}
  fieldScript(dx,dy,button='interact'){
    const p=this.state.position;
    if(button==='dive')return fieldMoveUser(this.catalog,this.state,'FIELD_MOVE_DIVE')>=0&&diveConnection(this)?this.mode==='underwater'?'EventScript_UseDiveUnderwater':'EventScript_UseDive':null;
    if(this.mode==='surf'&&dy===-1&&this.behavior(p.x,p.y-1)==='MB_WATERFALL')return 'EventScript_UseWaterfall';
    if(this.mode==='land'&&this.fishable(p.x+dx,p.y+dy)&&fieldMoveUser(this.catalog,this.state,'FIELD_MOVE_SURF')>=0)return 'EventScript_UseSurf';
    return null;
  }
  enterMap(position){
    if(this.map.outdoor)this.state.escapeOrigin=clone(this.state.position);delete this.state.wildlife;delete this.state.flags.FLAG_SYS_USE_STRENGTH;delete this.state.flashLevel;
    this.state.position=position;if(this.catalog.fieldData?.maps?.[position.map]?.mapType==='MAP_TYPE_UNDERWATER')this.state.field={mode:'underwater'};else if(this.mode!=='land'&&this.tile(position.x,position.y)!=='~')this.state.field={mode:'land'};for(const key of Object.keys(this.state.flags))if(/^FLAG_TEMP_/.test(key))delete this.state.flags[key];for(const key of Object.keys(this.state.vars||{}))if(/^VAR_TEMP_/.test(key))delete this.state.vars[key];
    if(this.state.objects?.[position.map])for(const [key,obj]of Object.entries(this.state.objects[position.map]))if(!obj.persistent)delete this.state.objects[position.map][key];
  }
  visibleEvents(map=this.map) {
    const overrides=this.state.objects?.[map.id]||{};
    return map.events.filter(e=>!this.state.flags[e.hideFlag]&&overrides[e.localId]?.visible!==false).map(e=>{const graphics=this.catalog.storyData?.maps?.[map.id]?.objectGraphics?.[e.localId],slot=graphics?.match(/^OBJ_EVENT_GFX_VAR_([0-9A-F]+)$/),sprite=slot?this.catalog.storyData.objectSprites?.[this.state.vars?.['VAR_OBJ_GFX_ID_'+slot[1]]]:null;return {...e,...(sprite?{sprite}:{}),...overrides[e.localId]};});
  }
  canDisembark(x,y){return this.mode==='surf'&&this.tile(x,y)!=='~'&&(this.map.elevations?.[y]?.[x]??3)===(this.catalog.fieldData?.defaultElevation??3);}
  elevationAllows(x,y) {
    const p=this.state.position,from=this.map.elevations?.[p.y]?.[p.x]||0,to=this.map.elevations?.[y]?.[x]||0;
    return !from||!to||from===15||to===15||from===to;
  }
  constructor(catalog, pack, state) { this.catalog=catalog; this.pack=validatePack(pack); this.state=state; this.random=new Random(state.rng); this.validate(); }
  static start(catalog, pack, starter='TREECKO', seed=Date.now()) {
    const rng=new Random(seed), first=catalog.create(catalog.id(starter),5,rng,'mon-1');
    return new Campaign(catalog,pack,{format:SAVE_FORMAT,schema:SAVE_VERSION,contentVersion:pack.version,vars:{VAR_STARTER_MON:{TREECKO:0,TORCHIC:1,MUDKIP:2}[starter]??0},trainer:{name:'Trainer'},position:clone(pack.start),party:[first],boxes:[],inventory:{'1':10,'28':5},money:3000,sourceObjectVersion:1,flags:startingFlags(pack),nextId:2,rng:rng.state,steps:0,options:{encounters:true,overworldEncounters:true,wildlifeDensity:6,shinyHunt:false,weather:true,difficulty:'normal',expShare:true,battleBag:true,shinyOdds:8192,orangeShinies:true},seen:[first.species],caught:[first.species]});
  }
  static begin(catalog,pack,{name='Trainer',gender='Male'}={},seed=Date.now()){
    const c=Campaign.start(catalog,pack,'TREECKO',seed);c.state.party=[];c.state.seen=[];c.state.caught=[];c.state.nextId=1;c.state.inventory={};c.state.flags=clone(pack.initialFlags||{});c.state.vars={};c.state.trainer={name,gender};c.state.intro=true;c.state.position={map:'map_inside_of_truck',x:2,y:2};c.state.options.overworldEncounters=true;c.random=new Random(seed);c.state.rng=c.random.state;return new Campaign(catalog,pack,c.state);
  }
  get map() { return this.pack.maps[this.state.position.map]; }
  validate() {
    const s=this.state; assert(s?.format===SAVE_FORMAT&&s.schema===SAVE_VERSION,'Unsupported save version'); assert(s.contentVersion===this.pack.version,'Save needs its matching content pack');
    assert(typeof s.trainer?.name==='string'&&s.trainer.name.length>0&&s.trainer.name.length<=24,'Invalid trainer name');
    assert(this.map,'Saved map is unavailable'); const normalized=connectedPosition(this.pack,this.map,s.position.x,s.position.y);assert(normalized,'Invalid saved position');if(normalized.map!==this.map.id)assert(s.sceneMap===this.map.id,'Off-map save outside a scene');else assert(!'#h'.includes(this.tile(s.position.x,s.position.y))&&(this.tile(s.position.x,s.position.y)!=='~'||this.mode!=='land'),'Saved position is blocked');if(s.field)assert(['land','surf','underwater'].includes(s.field.mode),'Invalid field mode');
    assert(Array.isArray(s.party)&&(s.party.length>=1||s.intro===true)&&s.party.length<=6&&Array.isArray(s.boxes)&&s.boxes.length<=6000,'Invalid storage');
    const mons=[...s.party,...s.boxes]; mons.forEach(m=>this.catalog.validateMon(m)); assert(new Set(mons.map(m=>m.uid)).size===mons.length,'Duplicate Pokémon identity');
    integer(s.nextId,1,10000000,'identity counter'); assert(mons.every(m=>/^mon-[1-9]\d*$/.test(m.uid)&&Number(m.uid.slice(4))<s.nextId),'Invalid identity counter');
    integer(s.money,0,999999999,'money'); integer(s.steps,0,Number.MAX_SAFE_INTEGER,'steps'); integer(s.rng,1,0xffffffff,'random state');
    assert(s.inventory&&typeof s.inventory==='object'&&!Array.isArray(s.inventory),'Invalid bag');
    for(const [id,count] of Object.entries(s.inventory)) { assert(this.catalog.data.items[id],'Unknown bag item'); integer(count,0,999999,'item count'); }
    assert(s.flags&&typeof s.flags==='object'&&!Array.isArray(s.flags),'Invalid flags'); assert(Object.keys(s.flags).length<=10000&&Object.values(s.flags).every(v=>typeof v==='boolean'),'Invalid flags');
    assert(typeof s.options?.encounters==='boolean'&&typeof s.options.weather==='boolean','Invalid options');
    if(s.options.expShareMode!==undefined)integer(s.options.expShareMode,0,2,'EXP Share mode');
    if(s.options.difficulty!==undefined)assert(['easy','normal','hard','extreme'].includes(s.options.difficulty),'Invalid difficulty');if(s.options.shinyOdds!==undefined)integer(s.options.shinyOdds,50,8192,'shiny odds');for(const key of ['expShare','battleBag','orangeShinies','overworldEncounters','shinyHunt'])if(s.options[key]!==undefined)assert(typeof s.options[key]==='boolean','Invalid option '+key);
    for(const k of ['seen','caught']) { assert(Array.isArray(s[k])&&s[k].length<=10000,'Invalid Pokédex'); s[k].forEach(id=>this.catalog.species(id)); }
    if(s.metatiles){for(const [mapId,changes]of Object.entries(s.metatiles)){const map=this.pack.maps[mapId];assert(map,'Invalid tile map');for(const [key,tile]of Object.entries(changes)){const [x,y]=key.split(',').map(Number);integer(x,0,map.width-1,'tile x');integer(y,0,map.height-1,'tile y');integer(tile.id,0,1023,'tile id');assert(map.metatileAtlas?.behaviors[tile.id]!==undefined&&typeof tile.blocked==='boolean','Invalid map edit');}}}
    if(s.objects){assert(typeof s.objects==='object'&&!Array.isArray(s.objects),'Invalid objects');for(const [mapId,objects]of Object.entries(s.objects)){const map=this.pack.maps[mapId];assert(map&&objects&&typeof objects==='object','Invalid object map');for(const obj of Object.values(objects)){if(obj.visible!==undefined)assert(typeof obj.visible==='boolean','Invalid object visibility');if(obj.x!==undefined&&obj.y!==undefined)assert(connectedPosition(this.pack,map,obj.x,obj.y),'Invalid object position');else{if(obj.x!==undefined)integer(obj.x,0,map.width-1,'object x');if(obj.y!==undefined)integer(obj.y,0,map.height-1,'object y');}}}}
    if(s.vars){assert(typeof s.vars==='object'&&!Array.isArray(s.vars),'Invalid script variables');for(const [key,value]of Object.entries(s.vars)){assert(/^VAR_\w+$/.test(key),'Invalid script variable');integer(value,0,65535,'script variable');}}
    if(s.respawn){const m=this.pack.maps[s.respawn.map];assert(m&&m.tiles[s.respawn.y]?.[s.respawn.x]&&!('#~h'.includes(m.tiles[s.respawn.y][s.respawn.x])),'Invalid recovery point');}
    if(s.options.wildlifeDensity!==undefined)assert([3,6,9].includes(s.options.wildlifeDensity),'Invalid wildlife density');
    if(s.wildlife){assert(s.wildlife.map===s.position.map&&Array.isArray(s.wildlife.actors)&&s.wildlife.actors.length<=9,'Invalid wildlife');for(const a of s.wildlife.actors){integer(a.x,0,this.map.width-1,'wild x');integer(a.y,0,this.map.height-1,'wild y');integer(a.born,0,s.steps,'wild age');this.catalog.validateMon(a.mon);assert(!mons.some(m=>m.uid===a.mon.uid),'Duplicate wild identity');}}
    return s;
  }
  snapshot() { this.state.rng=this.random.state; this.validate(); return clone(this.state); }
  move(dx,dy) {
    assert(Math.abs(dx)+Math.abs(dy)===1,'Move one tile at a time');const forced=this.forcedDirection();if(forced)[dx,dy]=forced; const p=this.state.position,x=p.x+dx,y=p.y+dy;
    if(x<0||y<0||x>=this.map.width||y>=this.map.height){
      const direction=y<0?'up':y>=this.map.height?'down':x<0?'left':'right';
      for(const link of (this.map.connections||[]).filter(c=>c.direction===direction)){
        const dest=this.pack.maps[link.map];if(!dest)continue;const nx=direction==='left'?dest.width-1:direction==='right'?0:x-link.offset,ny=direction==='up'?dest.height-1:direction==='down'?0:y-link.offset;
        if(!this.canOccupy(nx,ny,dest))continue;this.state.steps++;this.enterMap({map:link.map,x:nx,y:ny});return {kind:'warp',map:dest.name};
      }return {kind:'blocked'};
    }
    const jump=this.map.jumps?.[`${x},${y}`],dir=dx===1?'east':dx===-1?'west':dy===1?'south':'north';
    if(jump===dir){const nx=x+dx,ny=y+dy;if(nx>=0&&ny>=0&&nx<this.map.width&&ny<this.map.height&&!('#~h'.includes(this.tile(nx,ny)))){p.x=nx;p.y=ny;this.state.steps++;return {kind:'step'};}}
    const warpHere=this.map.events.some(e=>e.x===x&&e.y===y&&e.kind==='warp');
    if((!this.canOccupy(x,y)&&!(this.state.flags.FLAG_SYS_USE_STRENGTH&&this.visibleEvents().some(e=>e.x===x&&e.y===y&&e.sourceScript==='EventScript_StrengthBoulder'))||this.tile(x,y)!=='~'&&!this.elevationAllows(x,y)&&!this.canDisembark(x,y))&&!warpHere)return {kind:'blocked'};
    const wild=meetWildlife(this,x,y);if(wild)return wild;
    const obstacle=this.visibleEvents().find(e=>e.x===x&&e.y===y&&e.kind!=='warp'&&e.solid!==false); if(obstacle){if(obstacle.sourceScript==='EventScript_StrengthBoulder'&&this.state.flags.FLAG_SYS_USE_STRENGTH&&this.canOccupy(x+dx,y+dy)&&!this.map.events.some(e=>e.kind==='warp'&&e.x===x+dx&&e.y===y+dy)){this.state.objects??={};this.state.objects[this.map.id]??={};this.state.objects[this.map.id][obstacle.localId]={...this.state.objects[this.map.id][obstacle.localId],x:x+dx,y:y+dy};}else return {kind:'blocked'};}
    p.x=x;p.y=y;this.state.steps++;
    let warp=this.map.events.find(e=>e.x===x&&e.y===y&&e.kind==='warp');if(!warp&&this.state.dynamicWarp&&this.storyInfo.warpEvents?.some(e=>e.x===x&&e.y===y&&e.dest_map==='MAP_DYNAMIC'))warp={map:this.state.dynamicWarp.map,toX:this.state.dynamicWarp.x,toY:this.state.dynamicWarp.y};
    if(warp){this.enterMap({map:warp.map,x:warp.toX,y:warp.toY});return {kind:'warp',map:this.map.name};}
    if(this.mode==='surf'&&this.tile(x,y)!=='~')this.state.field={mode:'land'};
    const encountered=this.stepEncounter();if(encountered)return encountered;
    return {kind:'step'};
  }
  chooseEncounter(pool,markSeen=true){
    const total=pool.reduce((n,e)=>n+e.weight,0);if(!total)return null;let roll=this.random.int(1,total);const entry=pool.find(e=>(roll-=e.weight)<=0);if(!entry?.species)return null;
    const mon=this.createMon(entry.species,this.random.int(entry.min,entry.max));if(markSeen)this.mark('seen',mon.species);return {kind:'encounter',mon};
  }
  stepEncounter(){
    if(!this.state.options.encounters||!this.state.party.length)return null;if(this.state.options.overworldEncounters===true){refreshWildlife(this);return null;}const p=this.state.position,attrs=this.catalog.fieldData?.tileAttributes?.[this.behavior(p.x,p.y)],method=attrs?.surfable?'water_mons':'land_mons',source=this.mapInfo.encounters?.[method];
    if(source){if(!attrs?.encounters)return null;const pool=source.slots.filter(e=>e.species);if(pool.length&&this.random.next()<Math.min(.5,source.rate/100))return this.chooseEncounter(pool);return null;}
    if(this.tile(p.x,p.y)==='g'&&this.map.encounters?.length&&this.random.next()<Math.min(.5,(this.map.encounterRate??16)/100))return this.chooseEncounter(this.map.encounters);return null;
  }
  fish(rod,dx,dy){
    assert(['old_rod','good_rod','super_rod'].includes(rod),'Invalid fishing rod');const item=Object.keys(this.catalog.data.itemDetails).find(id=>this.catalog.data.itemDetails[id].constant==='ITEM_'+rod.toUpperCase());assert(item&&(this.state.inventory[item]||0)>0,'That rod is not in the Bag');const p=this.state.position;assert(this.fishable(p.x+dx,p.y+dy),'Face fishable water');const table=this.mapInfo.encounters?.fishing_mons;assert(table?.groups?.[rod],'No fishing table here');const indices=new Set(table.groups[rod]);return this.chooseEncounter(table.slots.filter(e=>indices.has(e.sourceSlot)))||{kind:'no_bite'};
  }
  createMon(constant,level) { const mon=this.catalog.create(this.catalog.id(constant),level,this.random,`mon-${this.state.nextId++}`);const orange=/map_(?:orange_city|route14[3-6])/.test(this.map.id);const odds=orange&&this.state.options.orangeShinies!==false?50:this.state.options.shinyOdds||8192;mon.shiny=this.random.int(1,odds)===1;return mon; }
  bagAllowed(){return !['hard','extreme'].includes(this.state.options.difficulty)&&this.state.options.battleBag!==false;}
  travel(map,x,y){const dest=this.pack.maps[map];assert(dest&&dest.tiles[y]?.[x]&&!('#~h'.includes(dest.tiles[y][x])),'Blocked destination');this.state.position={map,x,y};}
  trainerTeam(entries){
    const normalized=s=>String(s).toLowerCase().replace(/[^a-z0-9]/g,''),byName=new Map(),moveNames=new Map(Object.entries(this.catalog.data.moves).map(([id,name])=>[normalized(name),Number(id)])),itemNames=new Map(Object.entries(this.catalog.data.items).map(([id,name])=>[normalized(name),Number(id)]));
    for(const [id,s]of Object.entries(this.catalog.data.species)){if(!byName.has(normalized(s.name)))byName.set(normalized(s.name),Number(id));byName.set(normalized(s.constant),Number(id));if(s.formLabel){byName.set(normalized(s.name+s.formLabel),Number(id));if(/ Standard$/.test(s.formLabel))byName.set(normalized(s.name+s.formLabel.replace(/ Standard$/,'')),Number(id));}}
    return entries.map(entry=>{
      const id=byName.get(normalized(entry.species.replace(/\s*\([MF]\)$/i,'')));assert(id,'Unknown trainer species '+entry.species);const fields=entry.fields||{},s=this.catalog.species(id),mon=this.createMon(s.constant,Number(fields.Level)||5);mon.nickname=entry.nickname||s.name;
      const stats={HP:0,Atk:1,Def:2,Spe:3,SpA:4,SpD:5};
      for(const [field,key,max] of [['IVs','ivs',31],['EVs','evs',252]])for(const match of (fields[field]||'').matchAll(/(\d+) (HP|Atk|Def|Spe|SpA|SpD)/g))mon[key][stats[match[2]]]=Math.min(max,Number(match[1]));
      if(['hard','extreme'].includes(this.state.options.difficulty))mon.ivs.fill(31);if(this.state.options.difficulty==='easy'){mon.ivs.fill(0);mon.evs.fill(0);}
      const natures=['Hardy','Lonely','Brave','Adamant','Naughty','Bold','Docile','Relaxed','Impish','Lax','Timid','Hasty','Serious','Jolly','Naive','Modest','Mild','Quiet','Bashful','Rash','Calm','Gentle','Sassy','Careful','Quirky'];if(natures.includes(fields.Nature))mon.nature=natures.indexOf(fields.Nature);mon.shiny=fields.Shiny==='Yes';
      if(s.abilities.includes(fields.Ability))mon.ability=fields.Ability;mon.item=itemNames.get(normalized(entry.item))||0;
      const authored=(entry.moves||[]).map(name=>moveNames.get(normalized(name))).filter(id=>id&&this.catalog.data.moveDetails[id]?.pp>0);if(authored.length)mon.moves=authored.slice(0,4).map(id=>({id,pp:this.catalog.move(id).pp}));mon.hp=this.catalog.stats(mon)[0];return mon;
    });
  }
  mark(key,id) { if(!this.state[key].includes(id))this.state[key].push(id); }
  interact(dx,dy) { const p=this.state.position;const distance=(this.map.counters||[]).includes(`${p.x+dx},${p.y+dy}`)?2:1;return this.visibleEvents().find(e=>e.x===p.x+dx*distance&&e.y===p.y+dy*distance)||null; }
  heal() { this.state.party.forEach(m=>this.catalog.heal(m)); }
  buy(item,quantity,event) {
    assert(this.visibleEvents().some(e=>e.kind==='shop'&&e.x===event.x&&e.y===event.y)&&event.kind==='shop','No shop here'); const p=this.state.position; assert(Math.abs(p.x-event.x)+Math.abs(p.y-event.y)<=2&&this.interact(Math.sign(event.x-p.x),Math.sign(event.y-p.y))?.sourceScript===event.sourceScript,'Approach the shopkeeper first');
    const stock=event.stock.find(e=>e.item===item); assert(stock,'Item not sold here'); integer(quantity,1,99,'quantity');
    const count=this.state.inventory[item]||0; assert(count+quantity<=999999,'Bag is full'); const price=stock.price*({easy:1,normal:2,hard:4,extreme:10}[this.state.options.difficulty]||1);assert(this.state.money>=price*quantity,'Not enough money');
    this.state.money-=price*quantity; this.state.inventory[item]=count+quantity;
  }
  useFieldItem(item,uid,quantity=1){
    const mon=this.state.party.find(m=>m.uid===uid);assert(mon,'Choose a party Pokémon');integer(quantity,1,99,'quantity');assert((this.state.inventory[item]||0)>=quantity,'Not enough items');const constant=this.catalog.data.itemDetails[item]?.constant,exp={ITEM_EXP_CANDY_XS:100,ITEM_EXP_CANDY_S:800,ITEM_EXP_CANDY_M:3000,ITEM_EXP_CANDY_L:10000,ITEM_EXP_CANDY_XL:30000};
    if(exp[constant]){assert(mon.level<100,'Already at level 100');this.state.inventory[item]-=quantity;this.catalog.gainExperience(mon,exp[constant]*quantity);return;}
    assert(quantity===1,'Use one healing item at a time');const hp=this.catalog.stats(mon)[0],heals={28:20,29:60,30:120,31:hp,32:hp};
    if([33,34].includes(item)){assert(!mon.hp,'This Pokémon has not fainted');mon.hp=item===34?hp:Math.max(1,Math.floor(hp/2));}
    else{assert(mon.hp>0,'Use a Revive first');assert(heals[item],'That field item is not implemented');assert(mon.hp<hp||item===32&&mon.status,'HP is already full');mon.hp=Math.min(hp,mon.hp+heals[item]);if(item===32)mon.status=null;}
    this.consume(item);
  }
  consume(item) { assert((this.state.inventory[item]||0)>0,'None left in the bag'); this.state.inventory[item]--; }
  catchMon(mon) { this.mark('caught',mon.species);this.mark('seen',mon.species);(this.state.party.length<6?this.state.party:this.state.boxes).push(mon); }
  swapStorage(partyIndex, boxIndex) {
    integer(partyIndex,0,this.state.party.length-1,'party slot'); integer(boxIndex,0,this.state.boxes.length-1,'storage slot');
    [this.state.party[partyIndex],this.state.boxes[boxIndex]]=[this.state.boxes[boxIndex],this.state.party[partyIndex]];
  }
  setLead(index) { integer(index,0,this.state.party.length-1,'party slot'); const p=this.state.party;[p[0],p[index]]=[p[index],p[0]]; }
  evolve(uid,itemId) {
    const mon=this.state.party.find(m=>m.uid===uid);assert(mon,'Choose a party Pokémon'); const item=itemId?this.catalog.data.itemDetails[itemId]?.constant:null,e=this.catalog.evolution(mon,item);
    assert(e,'No supported evolution available'); if(itemId)this.consume(itemId);this.catalog.evolve(mon,e.target);this.mark('seen',mon.species);this.mark('caught',mon.species); return mon;
  }
}

export function migrateCampaign(state,pack,catalog){const copy=clone(state);if(copy.options.overworldEncounters===undefined)copy.options.overworldEncounters=true;if(!copy.sourceObjectVersion){copy.flags={...startingFlags(pack),...copy.flags};copy.sourceObjectVersion=1;}if(copy.contentVersion===pack.version)return new Campaign(catalog,pack,copy);assert(copy.contentVersion==='prototype-1'&&pack.version==='prototype-2','Unsupported campaign migration');copy.contentVersion=pack.version;copy.options={difficulty:'normal',expShare:true,battleBag:true,shinyOdds:8192,orangeShinies:true,...copy.options};return new Campaign(catalog,pack,copy);}
