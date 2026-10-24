// Standalone campaign records. Never encode these as trusted GBA/online records.
export const SAVE_FORMAT = 'brisk-native-save';
export const SAVE_VERSION = 1;
export const ENGINE_VERSION = 1;
export const PROTOTYPE_MOVE_IDS = new Set([1,10,22,33,55,64,88,98,129,345,574]);
export const clone = value => structuredClone(value);
export function assert(ok, message) { if (!ok) throw new Error(message); }
export function integer(value, min, max, name) {
  assert(Number.isInteger(value) && value >= min && value <= max, `Invalid ${name}`); return value;
}
export class Random {
  constructor(seed = 1) { this.state = seed >>> 0 || 1; }
  next() { let x = this.state; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.state = x >>> 0; return this.state / 4294967296; }
  int(min, max) { return min + Math.floor(this.next() * (max - min + 1)); }
  pick(items) { assert(items.length, 'Empty random pool'); return items[this.int(0, items.length - 1)]; }
}
export function experience(level, growth = 'medium_fast') {
  const n = level;
  switch (growth) {
    case 'fast': return Math.floor(4*n*n*n/5);
    case 'slow': return Math.floor(5*n*n*n/4);
    case 'medium_slow': return Math.max(0, Math.floor(6*n*n*n/5-15*n*n+100*n-140));
    case 'erratic': return Math.floor(n*n*n*(n<=50?(100-n)/50:n<=68?(150-n)/100:n<=98?Math.floor((1911-10*n)/3)/500:(160-n)/100));
    case 'fluctuating': return Math.floor(n*n*n*(n<=15?(Math.floor((n+1)/3)+24)/50:n<=36?(n+14)/50:(Math.floor(n/2)+32)/50));
    default: return n*n*n;
  }
}
export class Catalog {
  constructor(data, native = {}) {
    this.native=native;
    assert(data?.species && data?.moveDetails, 'Missing Brisk catalog'); this.data = {...data,items:{...data.items},itemDetails:{...data.itemDetails}};for(const [id,item]of Object.entries(native.extraItems||{})){this.data.items[id]=item.name;this.data.itemDetails[id]=item;}
    this.byConstant = new Map(Object.entries(data.species).map(([id, s]) => [s.constant, Number(id)]));
  }
  species(id) { const s = this.data.species[id]; assert(s && !['EGG','NONE'].includes(s.constant), `Unknown species ${id}`); return s; }
  id(constant) { const id = this.byConstant.get(constant); assert(id, `Unknown species ${constant}`); return id; }
  move(id) { const move = this.data.moveDetails[id]; assert(move?.pp > 0, `Unavailable move ${id}`); return move; }
  stats(mon) {
    const s = this.species(mon.species), b = s.baseStats, l = mon.level;
    // Brisk order: HP, Attack, Defense, Speed, Special Attack, Special Defense.
    return b.map((base, i) => {
      if (!i && s.constant === 'SHEDINJA') return 1;
      const raw = Math.floor((2*base+mon.ivs[i]+Math.floor(mon.evs[i]/4))*l/100);
      if (!i) return raw+l+10;
      const natureStats = [1,2,3,4,5], up=natureStats[Math.floor(mon.nature/5)], down=natureStats[mon.nature%5];
      return Math.floor((raw+5)*(up===down?1:i===up?1.1:i===down?.9:1));
    });
  }
  create(species, level, rng, uid) {
    const s = this.species(species);
    const learnset=this.native.species?.[species]?.learnset;
    const learned=learnset?.filter(e=>e.level<=level).map(e=>e.move).filter(id=>this.data.moveDetails[id]?.pp>0);
    const moves=learned?.length?[...new Set(learned)].slice(-4):s.learnableMoves.filter(id=>PROTOTYPE_MOVE_IDS.has(id)&&this.data.moveDetails[id]?.pp>0).slice(0,4);
    assert(moves.length, `${s.name} has no supported prototype moves`);
    const mon = {uid, species, level, exp:experience(level,s.growthRate), nickname:s.name, nature:rng.int(0,24), ivs:Array.from({length:6},()=>rng.int(0,31)), evs:[0,0,0,0,0,0], ability:(s.abilities||[]).find(Boolean)||'', item:0, shiny:rng.int(1,8192)===1, moves:moves.map(id=>({id,pp:this.move(id).pp})), status:null, hp:1, origin:'native-prototype'};
    mon.hp=this.stats(mon)[0]; return mon;
  }
  validateMon(mon) {
    assert(mon && typeof mon.uid==='string' && mon.uid.length<=100, 'Invalid Pokémon identity');
    const s=this.species(mon.species); integer(mon.level,1,100,'level'); integer(mon.nature,0,24,'nature');
    for(const [key,max] of [['ivs',31],['evs',252]]) { assert(Array.isArray(mon[key])&&mon[key].length===6, `Invalid ${key}`); mon[key].forEach(v=>integer(v,0,max,key)); }
    assert(mon.evs.reduce((a,b)=>a+b,0)<=510,'EV total exceeds 510');
    assert(typeof mon.nickname==='string'&&mon.nickname.length<=40,'Invalid nickname');
    assert((s.abilities||[]).includes(mon.ability),'Illegal ability');
    assert(mon.item===0||!!this.data.items[mon.item],'Unknown item');
    assert(typeof mon.shiny==='boolean'&&['native-prototype','gba-import'].includes(mon.origin),'Invalid Pokémon origin');
    integer(mon.exp,experience(mon.level,s.growthRate),experience(100,s.growthRate),'experience');
    assert(mon.level===100||mon.exp<experience(mon.level+1,s.growthRate),'Experience/level mismatch');
    assert([null,'poison','toxic','burn','paralysis','sleep','freeze'].includes(mon.status),'Unsupported status');
    integer(mon.hp,0,this.stats(mon)[0],'HP');
    assert(Array.isArray(mon.moves)&&mon.moves.length>=1&&mon.moves.length<=4,'Invalid moves');
    assert(new Set(mon.moves.map(m=>m.id)).size===mon.moves.length,'Duplicate moves');
    for(const m of mon.moves) { assert(s.learnableMoves.includes(m.id)||this.native.species?.[mon.species]?.learnset?.some(e=>e.move===m.id),'Illegal move'); integer(m.ppUps??0,0,3,'PP Ups');integer(m.pp,0,this.maxPP(m),'PP'); }
    assert(!mon.pendingMoves||Array.isArray(mon.pendingMoves)&&mon.pendingMoves.length<=100,'Invalid pending moves');for(const id of mon.pendingMoves||[])this.move(id);
    return mon;
  }
  maxPP(slot){return Math.floor(this.move(slot.id).pp*(5+(slot.ppUps||0))/5);}
  heal(mon) { mon.hp=this.stats(mon)[0]; mon.status=null; for(const m of mon.moves)m.pp=this.maxPP(m); }
  gainExperience(mon, amount) {
    integer(amount,0,10000000,'experience gain'); const s=this.species(mon.species), before=mon.level, hp=mon.hp;
    mon.exp=Math.min(experience(100,s.growthRate),mon.exp+amount);
    while(mon.level<100&&mon.exp>=experience(mon.level+1,s.growthRate)) {
      const oldHP=this.stats(mon)[0]; mon.level++; if(mon.hp)mon.hp+=this.stats(mon)[0]-oldHP;
    }
    const newMoves=(this.native.species?.[mon.species]?.learnset||[]).filter(e=>e.level>before&&e.level<=mon.level&&!mon.moves.some(m=>m.id===e.move));
    for(const entry of newMoves){if(mon.moves.length<4)mon.moves.push({id:entry.move,pp:this.move(entry.move).pp});else if(!(mon.pendingMoves||[]).includes(entry.move))(mon.pendingMoves??=[]).push(entry.move);}
    return {before,after:mon.level,wasFainted:hp===0,newMoves:newMoves.map(e=>e.move)};
  }
  canTransform(mon,form){return (this.native.species?.[mon.species]?.megaItems||[]).some(e=>e.species===form&&e.item===mon.item);}
  teach(mon,move,index){assert(this.species(mon.species).learnableMoves.includes(move)||this.native.species?.[mon.species]?.learnset?.some(e=>e.move===move),'Illegal move');integer(index,0,3,'move slot');assert(index<=mon.moves.length,'Invalid move slot');assert(!mon.moves.some(m=>m.id===move),'Already knows that move');mon.moves[index]={id:move,pp:this.move(move).pp};mon.pendingMoves=(mon.pendingMoves||[]).filter(id=>id!==move);}
  evolution(mon, item = null) {
    return (this.species(mon.species).evolutions||[]).find(e => e.method==='EVO_LEVEL'&&item===null&&mon.level>=Number(e.parameter) || e.method==='EVO_ITEM'&&item!==null&&e.parameter===item);
  }
  evolve(mon, target) {
    const oldHP=this.stats(mon)[0], previous=this.species(mon.species), next=this.species(target), slot=(previous.abilities||[]).indexOf(mon.ability);
    mon.species=target; mon.ability=next.abilities[slot]||next.abilities.find(Boolean); if(mon.nickname===previous.name)mon.nickname=next.name;
    // Growth curves can differ on custom evolutions; keep the earned level coherent.
    mon.exp=experience(mon.level,next.growthRate); if(mon.hp)mon.hp=Math.max(1,mon.hp+this.stats(mon)[0]-oldHP);
  }
}
