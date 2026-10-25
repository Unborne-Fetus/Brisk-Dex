import {sha256} from './storage.mjs';
import {importGbaSave,readGbaSave,restoreGbaStory,unpackGbaSave} from './gba-import.mjs';
import {Campaign} from './world.mjs';
export async function resumeAppSave(bytes,current,catalog,pack,layout){
 const fingerprint=await sha256(bytes);
 if(current?.state.gbaSource?.sha256===fingerprint){
  if(current.state.gbaSource.report?.story?.applied||!catalog.storyData?.saveLayout)return {campaign:current,imported:false};
  // Older imports used starter-era story defaults. Backfill source progress,
  // retaining native rewards, party, position and changes earned since import.
  const state=structuredClone(current.snapshot()),baseline=Campaign.start(catalog,pack).state;
  const story=restoreGbaStory(readGbaSave(await unpackGbaSave(bytes),catalog),state,catalog);
  for(const [key,value]of Object.entries(current.state.flags))if(value!==baseline.flags[key])state.flags[key]=value;
  for(const [key,value]of Object.entries(current.state.vars||{}))if(key!=='VAR_STARTER_MON')state.vars[key]=value;
  for(const [key,value]of Object.entries(current.state.options))if(value!==baseline.options[key])state.options[key]=value;
  state.gbaSource.report={...state.gbaSource.report,story};const campaign=new Campaign(catalog,pack,state);return {campaign,imported:true,migrated:true};
 }
 const result=await importGbaSave(bytes,catalog,pack,layout);return {...result,imported:true};
}
export function activeAppSave(){
 if(globalThis.parent===globalThis||!globalThis.parent)return Promise.resolve(null);
 try{return globalThis.parent.BriskAppGame?.activeSave?.()||Promise.resolve(null);}catch{return Promise.resolve(null);}
}
