import fs from 'node:fs';
const storyData=JSON.parse(fs.readFileSync(new URL('../../game/story-data.json',import.meta.url)));
import{catalog}from'./helpers.mjs';import{experience}from'../../game/model.mjs';import{sectionChecksum}from'../../game/gba-import.mjs';
const orders=['GAEM','GAME','GEAM','GEMA','GMAE','GMEA','AGEM','AGME','AEGM','AEMG','AMGE','AMEG','EGAM','EGMA','EAGM','EAMG','EMGA','EMAG','MGAE','MGEA','MAGE','MAEG','MEGA','MEAG'];
function mon(species=252,{party=false,seed=31,egg=false,ppUps=3}={}){
 const raw=new Uint8Array(party?100:80),v=new DataView(raw.buffer),plain=new Uint8Array(48),d=new DataView(plain.buffer),ot=0x12345678,key=(seed^ot)>>>0,order=orders[seed%24],off={};[...order].forEach((k,i)=>off[k]=i*12);
 v.setUint32(0,seed,true);v.setUint32(4,ot,true);raw.fill(255,8,18);raw[8]=0xce;raw[18]=2|(((seed%25)^17)<<3);raw[19]=egg?6:2;
 d.setUint16(off.G,species|(13<<11),true);d.setUint32(off.G+4,experience(12,catalog.species(species).growthRate),true);d.setUint8(off.G+8,ppUps);d.setUint8(off.G+9,200);d.setUint16(off.A,species===255?10:1,true);d.setUint8(off.A+8,50);d.setUint8(off.E+3,24);d.setUint32(off.M+4,(31|31<<5|31<<10|31<<15|31<<20|31<<25|(egg?1<<30:0))>>>0,true);
 let sum=0;for(let i=0;i<48;i+=2)sum=(sum+d.getUint16(i,true))&65535;v.setUint16(28,sum,true);for(let i=0;i<48;i+=4)v.setUint32(32+i,(d.getUint32(i,true)^key)>>>0,true);
 if(party){v.setUint8(84,12);v.setUint16(86,19,true);v.setUint16(88,38,true);}return raw;
}
export function makeGbaSave({modern=true,egg=false,corruptMon=false,corruptBank=false,location={group:0,number:0,x:12,y:10},flags=[],vars={},trainer='S'}={}){
 const out=new Uint8Array(0x20000),parts=Array.from({length:14},()=>new Uint8Array(3968)),s0=new DataView(parts[0].buffer),s1=new DataView(parts[1].buffer),security=0xfedcba98;
 parts[0].fill(255,0,7);for(let i=0;i<Math.min(7,trainer.length);i++){const code=trainer.charCodeAt(i);parts[0][i]=code>=97?0xd5+code-97:0xbb+code-65;}s0.setUint32(10,12345,true);s0.setUint32(0xac,security,true);s1.setUint32(0x234,1,true);const party=mon(252,{party:true,egg});if(corruptMon)party[35]^=2;parts[1].set(party,0x238);s1.setUint32(0x490,(123456^security)>>>0,true);s1.setInt16(0,location.x,true);s1.setInt16(2,location.y,true);s1.setUint8(4,location.group);s1.setUint8(5,location.number);s1.setUint16(0x560,28,true);s1.setUint16(0x562,7^(security&65535),true);
 const storyLayout=storyData.saveLayouts?.[modern?20:14]||storyData.saveLayout;
 const byte=(offset,value)=>{parts[1+Math.floor(offset/3968)][offset%3968]=value;};
 for(const key of flags){const bit=key.startsWith('TRAINER_')?storyLayout.trainerFlagsStart+storyLayout.trainers[key]:storyLayout.flags[key];if(!Number.isInteger(bit))throw Error('Unknown fixture flag '+key);const at=storyLayout.flagsOffset+(bit>>3),part=parts[1+Math.floor(at/3968)];part[at%3968]|=1<<(bit&7);}
 for(const [key,value]of Object.entries(vars)){const id=storyLayout.vars[key];if(!id)throw Error('Unknown fixture variable '+key);const at=storyLayout.varsOffset+(id-storyLayout.varsStart)*2;byte(at,value&255);byte(at+1,value>>>8);}
 const pc=new Uint8Array(modern?48604:34144);pc.set(mon(255,{seed:99}),4+((modern?19:13)*30+29)*80);for(let i=0;i<9;i++)parts[i+5].set(pc.subarray(i*3968,(i+1)*3968));
 function sector(physical,id,data,size,counter){const off=physical*4096;out.set(data.subarray(0,size),off);const v=new DataView(out.buffer,off,4096);v.setUint16(0xff4,id,true);v.setUint16(0xff6,sectionChecksum(out.subarray(off,off+4096),size),true);v.setUint32(0xff8,0x08012025,true);v.setUint32(0xffc,counter,true);}
 for(let bank=0;bank<2;bank++)for(let id=0;id<14;id++)sector(bank*14+(id+3)%14,id,parts[id],id===0?3884:id===4?3848:id===13&&!modern?2400:3968,bank?4:5);
 if(modern)for(let i=0;i<4;i++)sector(28+i,0x100+i,pc.subarray((9+i)*3968),[3968,3968,3968,988][i],5);
 if(corruptBank)out[3*4096+12]^=1;return out;
}
