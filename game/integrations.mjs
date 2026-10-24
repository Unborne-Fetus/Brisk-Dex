import {assert, clone} from './model.mjs';
export const INTEGRATION_CAPABILITIES=Object.freeze({onlineBattles:false,ranked:false,trades:false,dexSaveWrite:false,gbaImport:true,automaticUpdates:false});
export function partySnapshot(campaign) {
  // Versioned JSON boundary for a future Dex party panel / local battle host.
  return {format:'brisk-native-party',schema:1,contentVersion:campaign.pack.version,origin:'native-prototype',competitiveEligible:false,trainer:clone(campaign.state.trainer),pokemon:clone(campaign.state.party)};
}
export function battleTeam(campaign) {
  return campaign.state.party.map(mon=>{
    const s=campaign.catalog.species(mon.species),stats=campaign.catalog.stats(mon);
    return {species:mon.species,name:mon.nickname,level:mon.level,types:clone(s.types),ability:mon.ability,item:campaign.catalog.data.items[mon.item]||'',maxHP:stats[0],atk:stats[1],def:stats[2],speed:stats[3],spAtk:stats[4],spDef:stats[5],moves:mon.moves.map(m=>({id:m.id,...clone(campaign.catalog.move(m.id)),pp:m.pp,maxPP:campaign.catalog.maxPP(m)})),provenance:{source:'native-prototype',uid:mon.uid,competitiveEligible:false}};
  });
}
export class IntegrationBridge {
  constructor(){this.capabilities=INTEGRATION_CAPABILITIES;}
  prepareBattle(campaign,format='singles') {
    assert(['singles','doubles'].includes(format),'Unsupported battle format');
    return {protocol:'brisk-native-battle-v1',contentVersion:campaign.pack.version,format,team:battleTeam(campaign),competitiveEligible:false};
  }
  connect(){throw new Error('Online integration is intentionally disconnected. A server-side campaign/provenance protocol is required first.');}
  transfer(){throw new Error('Transfers to Dex, GBA saves, trading and ranked are not enabled for prototype Pokémon.');}
}
