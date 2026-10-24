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
    return new Campaign(catalog,pack,{format:SAVE_FORMAT,schema:SAVE_VERSION,contentVersion:pack.version,trainer:{name:'Trainer'},position:clone(pack.start),party:[first],boxes:[],inventory:{'1':10,'28':5},money:3000,flags:{},nextId:2,rng:rng.state,steps:0,options:{encounters:true,weather:true,difficulty:'normal',expShare:true,battleBag:true,shinyOdds:8192,orangeShinies:true},seen:[first.species],caught:[first.species]});
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
    if(s.options.difficulty!==undefined)assert(['easy','normal','hard','extreme'].includes(s.options.difficulty),'Invalid difficulty');if(s.options.shinyOdds!==undefined)integer(s.options.shinyOdds,50,8192,'shiny odds');for(const key of ['expShare','battleBag','orangeShinies'])if(s.options[key]!==undefined)assert(typeof s.options[key]==='boolean','Invalid option '+key);
    for(const k of ['seen','caught']) { assert(Array.isArray(s[k])&&s[k].length<=10000,'Invalid Pokédex'); s[k].forEach(id=>this.catalog.species(id)); }
    if(s.vars){assert(typeof s.vars==='object'&&!Array.isArray(s.vars),'Invalid script variables');for(const [key,value]of Object.entries(s.vars)){assert(/^VAR_\w+$/.test(key),'Invalid script variable');integer(value,0,65535,'script variable');}}
    if(s.respawn){const m=this.pack.maps[s.respawn.map];assert(m&&m.tiles[s.respawn.y]?.[s.respawn.x]&&!('#~h'.includes(m.tiles[s.respawn.y][s.respawn.x])),'Invalid recovery point');}
    return s;
  }
  snapshot() { this.state.rng=this.random.state; this.validate(); return clone(this.state); }
  move(dx,dy) {
    assert(Math.abs(dx)+Math.abs(dy)===1,'Move one tile at a time'); const p=this.state.position,x=p.x+dx,y=p.y+dy;
    if(x<0||y<0||x>=this.map.width||y>=this.map.height){
      const direction=y<0?'up':y>=this.map.height?'down':x<0?'left':'right';
      const link=(this.map.connections||[]).find(c=>c.direction===direction);if(!link)return {kind:'blocked'};
      const dest=this.pack.maps[link.map],nx=direction==='left'?dest.width-1:direction==='right'?0:x-link.offset,ny=direction==='up'?dest.height-1:direction==='down'?0:y-link.offset;
      if(nx<0||ny<0||nx>=dest.width||ny>=dest.height||'#~h'.includes(dest.tiles[ny][nx]))return {kind:'blocked'};
      this.state.position={map:link.map,x:nx,y:ny};return {kind:'warp',map:dest.name};
    }
    const jump=this.map.jumps?.[`${x},${y}`],dir=dx===1?'east':dx===-1?'west':dy===1?'south':'north';
    if(jump===dir){const nx=x+dx,ny=y+dy;if(nx>=0&&ny>=0&&nx<this.map.width&&ny<this.map.height&&!('#~h'.includes(this.map.tiles[ny][nx]))){p.x=nx;p.y=ny;this.state.steps++;return {kind:'step'};}}
    const warpHere=this.map.events.some(e=>e.x===x&&e.y===y&&e.kind==='warp');
    if('#~h'.includes(this.map.tiles[y][x])&&!warpHere)return {kind:'blocked'};
    const obstacle=this.map.events.find(e=>e.x===x&&e.y===y&&e.kind!=='warp'&&e.solid!==false); if(obstacle)return {kind:'blocked'};
    p.x=x;p.y=y;this.state.steps++;
    const warp=this.map.events.find(e=>e.x===x&&e.y===y&&e.kind==='warp');
    if(warp){this.state.position={map:warp.map,x:warp.toX,y:warp.toY};return {kind:'warp',map:this.map.name};}
    if(this.map.tiles[y][x]==='g'&&this.state.options.encounters&&this.map.encounters?.length&&this.random.next()<Math.min(.5,(this.map.encounterRate??16)/100)) {
      const pool=this.map.encounters,total=pool.reduce((n,e)=>n+e.weight,0); let roll=this.random.int(1,total), selected=pool[0];
      for(const entry of pool){roll-=entry.weight;if(roll<=0){selected=entry;break;}}
      const mon=this.createMon(selected.species,this.random.int(selected.min,selected.max)); this.mark('seen',mon.species); return {kind:'encounter',mon};
    }
    return {kind:'step'};
  }
  createMon(constant,level) { const mon=this.catalog.create(this.catalog.id(constant),level,this.random,`mon-${this.state.nextId++}`);const orange=/map_(?:orange_city|route14[3-6])/.test(this.map.id);const odds=orange&&this.state.options.orangeShinies!==false?50:this.state.options.shinyOdds||8192;mon.shiny=this.random.int(1,odds)===1;return mon; }
  bagAllowed(){return !['hard','extreme'].includes(this.state.options.difficulty)&&this.state.options.battleBag!==false;}
  travel(map,x,y){const dest=this.pack.maps[map];assert(dest&&dest.tiles[y]?.[x]&&!('#~h'.includes(dest.tiles[y][x])),'Blocked destination');this.state.position={map,x,y};}
  trainerTeam(entries){
    const normalized=s=>String(s).toLowerCase().replace(/[^a-z0-9]/g,''),byName=new Map(),moveNames=new Map(Object.entries(this.catalog.data.moves).map(([id,name])=>[normalized(name),Number(id)])),itemNames=new Map(Object.entries(this.catalog.data.items).map(([id,name])=>[normalized(name),Number(id)]));
    for(const [id,s]of Object.entries(this.catalog.data.species)){if(!byName.has(normalized(s.name)))byName.set(normalized(s.name),Number(id));byName.set(normalized(s.constant),Number(id));if(s.formLabel)byName.set(normalized(s.name+s.formLabel),Number(id));}
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
  interact(dx,dy) { const p=this.state.position;const distance=(this.map.counters||[]).includes(`${p.x+dx},${p.y+dy}`)?2:1;return this.map.events.find(e=>e.x===p.x+dx*distance&&e.y===p.y+dy*distance)||null; }
  heal() { this.state.party.forEach(m=>this.catalog.heal(m)); }
  buy(item,quantity,event) {
    assert(this.map.events.includes(event)&&event.kind==='shop','No shop here'); const p=this.state.position; assert(Math.abs(p.x-event.x)+Math.abs(p.y-event.y)<=2&&this.interact(Math.sign(event.x-p.x),Math.sign(event.y-p.y))===event,'Approach the shopkeeper first');
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

export function migrateCampaign(state,pack,catalog){const copy=clone(state);if(copy.contentVersion===pack.version)return new Campaign(catalog,pack,copy);assert(copy.contentVersion==='prototype-1'&&pack.version==='prototype-2','Unsupported campaign migration');copy.contentVersion=pack.version;copy.options={difficulty:'normal',expShare:true,battleBag:true,shinyOdds:8192,orangeShinies:true,...copy.options};return new Campaign(catalog,pack,copy);}
