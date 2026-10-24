import {assert,clone,integer} from './model.mjs';
import {createBattleEngine} from './relay-engine.mjs';
import {battleTeam} from './integrations.mjs';
export {TYPE_CHART} from './type-chart.mjs';
import {TYPE_CHART} from './type-chart.mjs';
export function effectiveness(type,targets){return targets.reduce((n,t)=>n*(TYPE_CHART[type]?.[t]??1),1);}
export function supportedMove(move){return !!move?.name&&move.pp>0;}
// Shares the relay's move/ability engine, but never imports or starts its server.
export class LocalBattle {
  constructor(campaign,opponent,{trainer=null,format='singles'}={}){
    this.campaign=campaign;this.catalog=campaign.catalog;this.random=campaign.random;this.trainer=trainer;this.phase='battle';this.awarded=new Set();
    this.opponents=(Array.isArray(opponent)?opponent:[opponent]).map(clone);assert(campaign.state.party.some(m=>m.hp>0),'Heal your party first');assert(['singles','doubles'].includes(format),'Invalid battle format');if(format==='doubles')assert(campaign.state.party.filter(m=>m.hp>0).length>=2&&this.opponents.filter(m=>m.hp>0).length>=2,'Double battles need two healthy Pokémon on each side');
    this.engine=createBattleEngine(this.catalog.data,()=>this.random.next());
    const enemyTeam=battleTeam({...campaign,state:{...campaign.state,party:this.opponents}}),own=battleTeam(campaign);
    for(const [entries,mons] of [[own,campaign.state.party],[enemyTeam,this.opponents]])entries.forEach((m,i)=>{
      const mon=mons[i];m.hp=mon.hp;m.status=mon.status;m.transformations=this.engine.verifiedTransformations({species:mon.species,speciesData:this.catalog.species(mon.species),level:mon.level},m);
      // Native held-item form checks: no free Mega button for unrelated stones.
      m.transformations=m.transformations.filter(f=>this.catalog.canTransform(mon,f.species));
    });
    this.room=this.engine.start([own,enemyTeam],{format,difficulty:campaign.state.options.difficulty==='extreme'?'expert':campaign.state.options.difficulty||'normal',names:[campaign.state.trainer.name,trainer||'Wild Pokémon']});
    this.opponents.forEach(m=>campaign.mark('seen',m.species));this.sync();
  }
  get doubles(){return this.room.rules.format==='doubles';}
  get actorPos(){const p=this.room.players[0];if(!this.doubles||this.room.phase==='finished')return 0;return p.team[p.active]?.hp>0&&!p.choice?.[0]?0:1;}
  get active(){return this.actorPos===1?this.room.players[0].active2:this.room.players[0].active;}
  resolveChoices(choice){
    const own=this.room.players[0],enemy=this.room.players[1];
    if(!this.doubles){own.choice=choice;enemy.choice=this.engine.botChoice(this.room,1);this.engine.resolveTurn(this.room);this.sync();return;}
    const pos=this.actorPos;own.choice??={};own.choice[pos]={...choice,actorPos:pos,targetPos:this.targetPos||0};
    const ready=[own.active,own.active2].every((index,pos)=>!own.team[index]||own.team[index].hp<=0||own.choice[pos]);if(!ready)return;
    enemy.choice={};const saved=enemy.active;
    for(const [pos,index]of [[0,saved],[1,enemy.active2]]){if(!enemy.team[index]||enemy.team[index].hp<=0)continue;enemy.active=index;let action=this.engine.botChoice(this.room,1)||{type:'move',moveIndex:0};if(action.type==='switch'&&(action.slot===saved||action.slot===enemy.active2))action={type:'move',moveIndex:enemy.team[index].moves.findIndex(m=>m.pp>0)};enemy.choice[pos]={...action,actorPos:pos,targetPos:own.team[own.active]?.hp>0?0:1};}
    enemy.active=saved;this.engine.resolveDoublesTurn(this.room);this.sync();
  }
  get player(){return this.campaign.state.party[this.active];}
  get enemy(){const i=this.room.players[1].active,b=this.room.players[1].team[i];return {...this.opponents[i],species:b.species,nickname:b.name,hp:b.hp,status:b.status,moves:b.moves.map(m=>({id:m.id,pp:m.pp})),battleMaxHP:b.maxHP};}
  get playerView(){const b=this.room.players[0].team[this.active];return {...this.player,species:b.species,nickname:b.name,hp:b.hp,battleMaxHP:b.maxHP};}
  get log(){return this.room.log;}
  get turn(){return this.room.turn;}
  get weather(){return this.room.weather;}
  say(text){this.room.log.push(text);}
  available(mon){return mon.moves.map((m,i)=>m.pp>0?i:-1).filter(i=>i>=0);}
  gimmicks(){const p=this.room.players[0],m=p.team[this.active];return m.transformed?[]:m.transformations.map((form,index)=>({...form,index})).filter(f=>f.kind==='Mega'?!p.usedMega:!p.usedGmax);}
  sync(){
    this.room.players[0].team.forEach((b,i)=>{const m=this.campaign.state.party[i],max=this.catalog.stats(m)[0];m.hp=b.hp<=0?0:Math.min(max,Math.ceil(b.hp*max/b.maxHP));m.status=b.status||null;m.moves.forEach((slot,k)=>{slot.pp=Math.max(0,Math.min(this.catalog.maxPP(slot),b.moves[k]?.pp??slot.pp));});});
    this.room.players[1].team.forEach((b,i)=>{if(b.hp>0||this.awarded.has(i))return;this.awarded.add(i);const source=this.opponents[i],yieldValue=this.catalog.native?.species?.[source.species]?.expYield||60;
      const amount=Math.max(1,Math.floor(yieldValue*source.level/7*(this.trainer?1.5:1))),active=this.player;
      for(const m of this.campaign.state.party){if(!m.hp)continue;const share=m===active?1:this.campaign.state.options.expShare===false?0:({easy:2,normal:1,hard:.5,extreme:0}[this.campaign.state.options.difficulty]??1);if(!share)continue;const gain=this.catalog.gainExperience(m,Math.floor(amount*share));this.say(`${m.nickname} gained ${Math.floor(amount*share)} EXP.${gain.after>gain.before?' Grew to level '+m.level+'!':''}`);}
    });
    // Level changes and consumable items must survive subsequent turns and saving.
    const items=new Map(Object.entries(this.catalog.data.items).map(([id,name])=>[name,Number(id)]));
    this.room.players[0].team.forEach((b,i)=>{const m=this.campaign.state.party[i],stats=this.catalog.stats(m);m.item=items.get(b.item)||0;
      if(!b.transformed){b.level=m.level;b.maxHP=stats[0];b.atk=stats[1];b.def=stats[2];b.speed=stats[3];b.spAtk=stats[4];b.spDef=stats[5];b.hp=m.hp;
        while(b.moves.length<m.moves.length){const slot=m.moves[b.moves.length];b.moves.push({...this.engine.catalogMove(slot.id),pp:slot.pp});}
      }
    });
    if(this.room.phase==='finished'){this.phase=this.room.winner===0?'won':'lost';if(this.phase==='won'&&this.trainer&&!this.rewarded){this.campaign.state.money=Math.min(999999999,this.campaign.state.money+this.opponents.reduce((n,m)=>n+m.level*20,0));this.rewarded=true;}}
  }
  enemyTurn(){
    this.resolveChoices({type:'done'});
  }
  act(action){
    assert(this.phase==='battle','Battle has ended');const p=this.room.players[0],mon=p.team[this.active];
    if(action.type==='move'){
      integer(action.index,-1,3,'move choice');const available=this.available(this.player);assert(available.includes(action.index)||(action.index===-1&&!available.length),'Choose a move with PP');
      const index=action.index===-1?0:action.index;
      // Relay resolves an exhausted chosen move as Struggle.
      if(action.gimmick){assert(this.gimmicks().some(f=>f.kind===action.gimmick&&f.index===action.formIndex),'That transformation is unavailable');}
      assert(mon.choiceLock===null||mon.choiceLock===index,'A held item locks you into another move');
      assert(!(mon.volatile.disabledMove===index&&mon.volatile.disableTurns>0),'That move is disabled');
      assert(!(mon.volatile.encore>0&&mon.volatile.encoreMove!==null&&mon.volatile.encoreMove!==index),'Encore forces another move');
      this.resolveChoices({type:'move',moveIndex:index,gimmick:action.gimmick||null,formIndex:action.formIndex||0});
    }else if(action.type==='switch'){
      integer(action.index,0,p.team.length-1,'party slot');assert(action.index!==p.active&&action.index!==p.active2&&p.team[action.index].hp>0,'Choose another healthy Pokémon');assert(!this.engine.switchBlocked(this.room,0),'Your Pokémon is trapped');this.resolveChoices({type:'switch',slot:action.index});
    }else if(action.type==='potion'){
      assert(this.campaign.bagAllowed(),'Battle items are disabled by your difficulty/options');assert(mon.hp<mon.maxHP,'HP is already full');this.campaign.consume(28);mon.hp=Math.min(mon.maxHP,mon.hp+20);this.say('Used a Potion.');this.enemyTurn();
    }else if(action.type==='catch'){
      assert(!this.trainer,"You cannot catch a trainer's Pokémon");assert(this.campaign.bagAllowed(),'Battle items are disabled');
      const item=action.item||1;assert([1,2,3,4].includes(item),'Unsupported ball');this.campaign.consume(item);const rate=this.catalog.native?.species?.[this.opponents[this.room.players[1].active].species]?.catchRate||45;
      const status=['sleep','freeze'].includes(this.enemy.status)?2.5:this.enemy.status?1.5:1,multiplier=item===2?1.5:item===3?2:1;
      const odds=Math.min(1,((3*this.enemy.battleMaxHP-2*this.enemy.hp)*rate*multiplier*status)/(3*this.enemy.battleMaxHP*255));
      if(item===4||this.random.next()<odds){const caught=this.enemy;delete caught.battleMaxHP;this.campaign.catchMon(caught);this.phase='caught';this.say(`Caught ${caught.nickname}!`);return;}
      this.say('It broke free!');this.enemyTurn();
    }else if(action.type==='run'){assert(!this.trainer,'You cannot run from a trainer');this.phase='escaped';this.say('Got away safely.');}
    else throw new Error('Unknown battle action');
  }
}
