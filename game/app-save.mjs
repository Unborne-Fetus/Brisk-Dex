import {sha256} from './storage.mjs';
import {importGbaSave} from './gba-import.mjs';
export async function resumeAppSave(bytes,current,catalog,pack,layout){
 const fingerprint=await sha256(bytes);
 if(current?.state.gbaSource?.sha256===fingerprint)return {campaign:current,imported:false};
 const result=await importGbaSave(bytes,catalog,pack,layout);return {...result,imported:true};
}
export function activeAppSave(){
 if(globalThis.parent===globalThis||!globalThis.parent)return Promise.resolve(null);
 try{return globalThis.parent.BriskAppGame?.activeSave?.()||Promise.resolve(null);}catch{return Promise.resolve(null);}
}
