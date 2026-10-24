import {assert, integer, clone, Random, SAVE_FORMAT, SAVE_VERSION} from './model.mjs';
export const WEATHER_ABILITIES = {Drizzle:'rain','Primordial Sea':'rain',Drought:'sun','Desolate Land':'sun','Orichalcum Pulse':'sun','Sand Stream':'sand','Sand Spit':'sand','Snow Warning':'snow','Delta Stream':'wind'};
export function fieldWeather(map, lead) { return !map.outdoor||map.weatherLocked ? map.weather : WEATHER_ABILITIES[lead?.ability]||map.weather; }
export function validatePack(pack) {
  assert(pack?.format==='brisk-native-content'&&pack.schema===1,'Unsupported content pack');
  assert(typeof pack.version==='string'&&pack.version.length<=80,'Invalid content version');
  assert(pack.maps&&typeof pack.maps==='object','Missing maps');
  const maps=Object.values(pack.maps); assert(maps.length>0&&maps.length<=1000,'Invalid map count');
  for(const [id,map] of Object.entries(pack.maps)) {
    assert(id===map.id&&/^[a-z0-9_-]+$/i.test(id),'Invalid map id'); integer(map.width,3,512,'map width'); integer(map.height,3,512,'map height');
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
export class Campaign {
  constructor(catalog, pack, state) { this.catalog=catalog; this.pack=validatePack(pack); this.state=state; this.random=new Random(state.rng); this.validate(); }
  static start(catalog, pack, starter='TREECKO', seed=Date.now()) {
    const rng=new Random(seed), first=catalog.create(catalog.id(starter),5,rng,'mon-1');
    return new Campaign(catalog,pack,{format:SAVE_FORMAT,schema:SAVE_VERSION,contentVersion:pack.version,trainer:{name:'Trainer'},position:clone(pack.start),party:[first],boxes:[],inventory:{'1':10,'28':5},money:3000,flags:{},nextId:2,rng:rng.state,steps:0,options:{encounters:true,weather:true},seen:[first.species],caught:[first.species]});
  }
  get map() { return this.pack.maps[this.state.position.map]; }
  validate() {
    const s=this.state; assert(s?.format===SAVE_FORMAT&&s.schema===SAVE_VERSION,'Unsupported save version'); assert(s.contentVersion===this.pack.version,'Save needs its matching content pack');
    assert(typeof s.trainer?.name==='string'&&s.trainer.name.length>0&&s.trainer.name.length<=24,'Invalid trainer name');
    assert(this.map,'Saved map is unavailable'); integer(s.position.x,0,this.map.width-1,'saved x'); integer(s.position.y,0,this.map.height-1,'saved y'); assert(!'#~h'.includes(this.map.tiles[s.position.y][s.position.x]),'Saved position is blocked');
    assert(Array.isArray(s.party)&&s.party.length>=1&&s.party.length<=6&&Array.isArray(s.boxes)&&s.boxes.length<=6000,'Invalid storage');
    const mons=[...s.party,...s.boxes]; mons.forEach(m=>this.catalog.validateMon(m)); assert(new Set(mons.map(m=>m.uid)).size===mons.length,'Duplicate Pokémon identity');
    integer(s.nextId,1,10000000,'identity counter'); assert(mons.every(m=>/^mon-[1-9]\d*$/.test(m.uid)&&Number(m.uid.slice(4))<s.nextId),'Invalid identity counter');
    integer(s.money,0,999999999,'money'); integer(s.steps,0,Number.MAX_SAFE_INTEGER,'steps'); integer(s.rng,1,0xffffffff,'random state');
    assert(s.inventory&&typeof s.inventory==='object'&&!Array.isArray(s.inventory),'Invalid bag');
    for(const [id,count] of Object.entries(s.inventory)) { assert(this.catalog.data.items[id],'Unknown bag item'); integer(count,0,999999,'item count'); }
    assert(s.flags&&typeof s.flags==='object'&&!Array.isArray(s.flags),'Invalid flags'); assert(Object.keys(s.flags).length<=10000&&Object.values(s.flags).every(v=>typeof v==='boolean'),'Invalid flags');
    assert(typeof s.options?.encounters==='boolean'&&typeof s.options.weather==='boolean','Invalid options');
    for(const k of ['seen','caught']) { assert(Array.isArray(s[k])&&s[k].length<=10000,'Invalid Pokédex'); s[k].forEach(id=>this.catalog.species(id)); }
    return s;
  }
  snapshot() { this.state.rng=this.random.state; this.validate(); return clone(this.state); }
  move(dx,dy) {
    assert(Math.abs(dx)+Math.abs(dy)===1,'Move one tile at a time'); const p=this.state.position,x=p.x+dx,y=p.y+dy;
    if(x<0||y<0||x>=this.map.width||y>=this.map.height||'#~h'.includes(this.map.tiles[y][x]))return {kind:'blocked'};
    const obstacle=this.map.events.find(e=>e.x===x&&e.y===y&&e.kind!=='warp'); if(obstacle)return {kind:'blocked'};
    p.x=x;p.y=y;this.state.steps++;
    const warp=this.map.events.find(e=>e.x===x&&e.y===y&&e.kind==='warp');
    if(warp){this.state.position={map:warp.map,x:warp.toX,y:warp.toY};return {kind:'warp',map:this.map.name};}
    if(this.map.tiles[y][x]==='g'&&this.state.options.encounters&&this.map.encounters?.length&&this.random.next()<.16) {
      const pool=this.map.encounters,total=pool.reduce((n,e)=>n+e.weight,0); let roll=this.random.int(1,total), selected=pool[0];
      for(const entry of pool){roll-=entry.weight;if(roll<=0){selected=entry;break;}}
      const mon=this.createMon(selected.species,this.random.int(selected.min,selected.max)); this.mark('seen',mon.species); return {kind:'encounter',mon};
    }
    return {kind:'step'};
  }
  createMon(constant,level) { return this.catalog.create(this.catalog.id(constant),level,this.random,`mon-${this.state.nextId++}`); }
  mark(key,id) { if(!this.state[key].includes(id))this.state[key].push(id); }
  interact(dx,dy) { const p=this.state.position;return this.map.events.find(e=>e.x===p.x+dx&&e.y===p.y+dy)||null; }
  heal() { this.state.party.forEach(m=>this.catalog.heal(m)); }
  buy(item,quantity,event) {
    assert(this.map.events.includes(event)&&event.kind==='shop','No shop here'); const p=this.state.position; assert(Math.abs(p.x-event.x)+Math.abs(p.y-event.y)===1,'Approach the shopkeeper first');
    const stock=event.stock.find(e=>e.item===item); assert(stock,'Item not sold here'); integer(quantity,1,99,'quantity');
    const count=this.state.inventory[item]||0; assert(count+quantity<=999999,'Bag is full'); assert(this.state.money>=stock.price*quantity,'Not enough money');
    this.state.money-=stock.price*quantity; this.state.inventory[item]=count+quantity;
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
