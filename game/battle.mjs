import {assert, clone, integer} from './model.mjs';
export const TYPE_CHART = {
  Normal:{Rock:.5,Ghost:0,Steel:.5},
  Fire:{Fire:.5,Water:.5,Grass:2,Ice:2,Bug:2,Rock:.5,Dragon:.5,Steel:2},
  Water:{Fire:2,Water:.5,Grass:.5,Ground:2,Rock:2,Dragon:.5},
  Electric:{Water:2,Electric:.5,Grass:.5,Ground:0,Flying:2,Dragon:.5},
  Grass:{Fire:.5,Water:2,Grass:.5,Poison:.5,Ground:2,Flying:.5,Bug:.5,Rock:2,Dragon:.5,Steel:.5},
  Ice:{Fire:.5,Water:.5,Grass:2,Ice:.5,Ground:2,Flying:2,Dragon:2,Steel:.5},
  Fighting:{Normal:2,Ice:2,Poison:.5,Flying:.5,Psychic:.5,Bug:.5,Rock:2,Ghost:0,Dark:2,Steel:2,Fairy:.5},
  Poison:{Grass:2,Poison:.5,Ground:.5,Rock:.5,Ghost:.5,Steel:0,Fairy:2},
  Ground:{Fire:2,Electric:2,Grass:.5,Poison:2,Flying:0,Bug:.5,Rock:2,Steel:2},
  Flying:{Electric:.5,Grass:2,Fighting:2,Bug:2,Rock:.5,Steel:.5},
  Psychic:{Fighting:2,Poison:2,Psychic:.5,Dark:0,Steel:.5},
  Bug:{Fire:.5,Grass:2,Fighting:.5,Poison:.5,Flying:.5,Psychic:2,Ghost:.5,Dark:2,Steel:.5,Fairy:.5},
  Rock:{Fire:2,Ice:2,Fighting:.5,Ground:.5,Flying:2,Bug:2,Steel:.5},
  Ghost:{Normal:0,Psychic:2,Ghost:2,Dark:.5},
  Dragon:{Dragon:2,Steel:.5,Fairy:0},
  Dark:{Fighting:.5,Psychic:2,Ghost:2,Dark:.5,Fairy:.5},
  Steel:{Fire:.5,Water:.5,Electric:.5,Ice:2,Rock:2,Steel:.5,Fairy:2},
  Fairy:{Fire:.5,Fighting:2,Poison:.5,Dragon:2,Dark:2,Steel:.5}
};
export function effectiveness(type, targets) { return targets.reduce((v,t)=>v*(TYPE_CHART[type]?.[t]??1),1); }
export function supportedMove(move) { return ['Pound','Scratch','Vine Whip','Tackle','Water Gun','Peck','Rock Throw','Quick Attack','Swift','Magical Leaf','Disarming Voice'].includes(move.name) && move.effect==='Hit' && move.power>0 && !move.multiHit && !move.moveEffects?.length; }
// Deliberately limited local battle implementation. Online engine is not modified.
export class LocalBattle {
  constructor(campaign, opponent, {trainer=null}={}) {
    this.campaign=campaign; this.catalog=campaign.catalog; this.random=campaign.random;
    this.enemy=clone(opponent);this.trainer=trainer;this.active=campaign.state.party.findIndex(m=>m.hp>0);
    assert(this.active>=0,'Heal your party first'); this.phase='battle';this.turn=0;this.log=[];
    this.weather=null;this.weatherTurns=0;this.setWeather(this.player.ability);this.setWeather(this.enemy.ability);
    campaign.mark('seen',opponent.species); this.say(`${trainer||'A wild '+opponent.nickname} appeared!`);
  }
  get player(){return this.campaign.state.party[this.active];}
  say(message){this.log.push(message);this.log=this.log.slice(-80);}
  setWeather(ability){const map={'Drizzle':'rain','Primordial Sea':'rain','Drought':'sun','Desolate Land':'sun','Orichalcum Pulse':'sun','Sand Stream':'sand','Sand Spit':'sand','Snow Warning':'snow'};if(map[ability]){this.weather=map[ability];this.weatherTurns=5;}}
  available(mon) { return mon.moves.map((m,i)=>({m,i})).filter(({m})=>m.pp>0&&supportedMove(this.catalog.move(m.id))).map(({i})=>i); }
  speed(mon){return this.catalog.stats(mon)[3]*(mon.status==='paralysis'?.5:1);}
  attack(attacker,target,index) {
    if(attacker.hp<=0||target.hp<=0)return;
    if(attacker.status==='paralysis'&&this.random.next()<.25){this.say(`${attacker.nickname} is paralyzed!`);return;}
    const slot=index===-1?null:attacker.moves[index];
    const move=slot?this.catalog.move(slot.id):{name:'Struggle',power:50,type:'Normal',category:'Physical',accuracy:100,priority:0};
    if(slot){assert(slot.pp>0&&supportedMove(move),'That move is not implemented in the prototype');slot.pp--;}
    this.say(`${attacker.nickname} used ${move.name}!`);
    if(move.accuracy>0&&this.random.int(1,100)>move.accuracy){this.say('The attack missed.');return;}
    const own=this.catalog.stats(attacker),foe=this.catalog.stats(target),physical=move.category==='Physical';
    const types=this.catalog.species(target.species).types,mod=index===-1?1:effectiveness(move.type,types);
    if(mod===0){this.say('It had no effect.');return;}
    let attack=own[physical?1:4],defense=foe[physical?2:5];
    if(physical&&attacker.status==='burn'&&attacker.ability!=='Guts')attack*=.5;
    if(physical&&attacker.ability==='Huge Power')attack*=2;
    if(physical&&attacker.ability==='Pure Power')attack*=2;
    if(target.ability==='Levitate'&&move.type==='Ground'){this.say('Levitate prevented the hit.');return;}
    if((target.ability==='Water Absorb'&&move.type==='Water')||(target.ability==='Volt Absorb'&&move.type==='Electric')){target.hp=Math.min(foe[0],target.hp+Math.floor(foe[0]/4));this.say(`${target.nickname} absorbed the attack!`);return;}
    let weather=this.weather==='sun'?(move.type==='Fire'?1.5:move.type==='Water'?.5:1):this.weather==='rain'?(move.type==='Water'?1.5:move.type==='Fire'?.5:1):1;
    const stab=this.catalog.species(attacker.species).types.includes(move.type)?1.5:1;
    const critical=this.random.int(1,24)===1?1.5:1;
    let damage=Math.max(1,Math.floor((Math.floor(Math.floor((2*attacker.level/5+2)*move.power*attack/defense)/50)+2)*stab*mod*weather*critical*(this.random.int(85,100)/100)));
    if(target.ability==='Sturdy'&&target.hp===foe[0]&&damage>=target.hp)damage=target.hp-1;
    target.hp=Math.max(0,target.hp-damage);
    if(critical>1)this.say('A critical hit!'); if(mod>1)this.say("It's super effective!");else if(mod<1)this.say("It's not very effective.");
    if(index===-1)attacker.hp=Math.max(0,attacker.hp-Math.max(1,Math.floor(own[0]/4)));
    if(target.hp===0)this.say(`${target.nickname} fainted!`);
  }
  enemyAttack(){const choices=this.available(this.enemy);this.attack(this.enemy,this.player,choices.length?this.random.pick(choices):-1);}
  residual(mon) {
    if(mon.hp<=0)return;const max=this.catalog.stats(mon)[0],types=this.catalog.species(mon.species).types;
    if(mon.status==='poison'&&mon.ability==='Poison Heal'){mon.hp=Math.min(max,mon.hp+Math.max(1,Math.floor(max/8)));return;}
    let damage=mon.status==='poison'?Math.max(1,Math.floor(max/8)):mon.status==='burn'?Math.max(1,Math.floor(max/16)):0;
    if(this.weather==='sand'&&!types.some(t=>['Rock','Ground','Steel'].includes(t))&&!['Sand Rush','Sand Veil','Sand Force','Magic Guard','Overcoat'].includes(mon.ability))damage+=Math.max(1,Math.floor(max/16));
    if(mon.ability==='Magic Guard')damage=0;
    mon.hp=Math.max(0,mon.hp-damage);if(damage)this.say(`${mon.nickname} took residual damage.`);
  }
  checkEnd() {
    if(this.enemy.hp<=0){this.phase='won';const amount=Math.max(15,this.enemy.level*12);const gains=this.catalog.gainExperience(this.player,amount);this.say(`Won! ${this.player.nickname} gained ${amount} EXP.`);if(gains.after>gains.before)this.say(`Grew to level ${gains.after}!`);if(this.trainer)this.campaign.state.money=Math.min(999999999,this.campaign.state.money+200);return true;}
    if(this.player.hp<=0){const next=this.campaign.state.party.findIndex(m=>m.hp>0);if(next<0){this.phase='lost';this.say('Your party needs to rest.');}else {this.active=next;this.setWeather(this.player.ability);this.say(`Go, ${this.player.nickname}!`);}return true;}
    return false;
  }
  finishTurn() {
    if(!this.checkEnd()){this.residual(this.player);this.residual(this.enemy);this.checkEnd();}
    if(this.weatherTurns>0&&--this.weatherTurns===0)this.weather=null;this.turn++;
  }
  act(action) {
    assert(this.phase==='battle','Battle has ended');
    if(action.type==='move'){
      const choices=this.available(this.player);integer(action.index,-1,3,'move choice');assert(choices.includes(action.index)||(action.index===-1&&!choices.length),'Choose a supported move with PP');
      const enemyChoices=this.available(this.enemy),enemyIndex=enemyChoices.length?this.random.pick(enemyChoices):-1;
      const priority=(mon,i)=>i===-1?0:this.catalog.move(mon.moves[i].id).priority||0;
      const first=priority(this.player,action.index)-priority(this.enemy,enemyIndex)||this.speed(this.player)-this.speed(this.enemy)||(this.random.next()<.5?1:-1);
      if(first>=0){this.attack(this.player,this.enemy,action.index);if(this.enemy.hp>0)this.attack(this.enemy,this.player,enemyIndex);}
      else{this.attack(this.enemy,this.player,enemyIndex);if(this.player.hp>0)this.attack(this.player,this.enemy,action.index);}
    }else if(action.type==='switch'){
      integer(action.index,0,this.campaign.state.party.length-1,'party slot');assert(action.index!==this.active&&this.campaign.state.party[action.index].hp>0,'Choose another healthy Pokémon');this.active=action.index;this.setWeather(this.player.ability);this.say(`Go, ${this.player.nickname}!`);this.enemyAttack();
    }else if(action.type==='potion'){
      assert(this.player.hp<this.catalog.stats(this.player)[0],'HP is already full');this.campaign.consume(28);this.player.hp=Math.min(this.catalog.stats(this.player)[0],this.player.hp+20);this.say('Restored 20 HP.');this.enemyAttack();
    }else if(action.type==='catch'){
      assert(!this.trainer,"You cannot catch a trainer's Pokémon");this.campaign.consume(1);
      // Placeholder catch formula until source catch rates are exported.
      const odds=.2+.55*(1-this.enemy.hp/this.catalog.stats(this.enemy)[0]);
      if(this.random.next()<odds){this.campaign.catchMon(clone(this.enemy));this.phase='caught';this.say(`Caught ${this.enemy.nickname}!`);return;}
      this.say('It broke free!');this.enemyAttack();
    }else if(action.type==='run'){
      assert(!this.trainer,'You cannot run from a trainer');this.phase='escaped';this.say('Got away safely.');return;
    }else throw new Error('Unknown battle action');
    this.finishTurn();
  }
}
