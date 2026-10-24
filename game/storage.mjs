import {assert, clone} from './model.mjs';
export async function sha256(bytes) {
  const digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export async function encodeSave(state) {
  const payload=JSON.stringify(state);return {format:'brisk-native-backup',version:1,payload,sha256:await sha256(new TextEncoder().encode(payload))};
}
export async function decodeSave(envelope) {
  assert(envelope?.format==='brisk-native-backup'&&envelope.version===1,'This is not a standalone Brisk save (GBA saves are not supported yet)');
  assert(typeof envelope.payload==='string'&&envelope.payload.length<=16000000,'Invalid save size');
  assert(await sha256(new TextEncoder().encode(envelope.payload))===envelope.sha256,'Save checksum mismatch');return JSON.parse(envelope.payload);
}
// One transaction writes the backup and current state together. Separate DB from Dex.
export class SaveStore {
  constructor(indexedDB=globalThis.indexedDB) {this.indexedDB=indexedDB;}
  async open() {
    if(this.db)return this.db; assert(this.indexedDB,'Persistent storage is unavailable; export a save instead');
    this.db=await new Promise((resolve,reject)=>{const request=this.indexedDB.open('brisk-native-campaign',1);request.onupgradeneeded=()=>request.result.createObjectStore('records');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Close other prototype windows before saving'));});
    this.db.onversionchange=()=>{this.db.close();this.db=null;};return this.db;
  }
  async read(key='current') {
    const db=await this.open();return new Promise((resolve,reject)=>{const tx=db.transaction('records','readonly'),req=tx.objectStore('records').get(key);tx.oncomplete=()=>resolve(req.result??null);tx.onabort=tx.onerror=()=>reject(tx.error||new Error('Could not read saved campaign'));});
  }
  async commit(state) {
    const envelope=await encodeSave(state),db=await this.open();
    await new Promise((resolve,reject)=>{const tx=db.transaction('records','readwrite'),s=tx.objectStore('records'),read=s.get('current');read.onsuccess=()=>{if(read.result)s.put(read.result,'backup');s.put(envelope,'current');};tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error||new Error('Save failed'));});
  }
  async load(key='current'){const value=await this.read(key);return value?decodeSave(value):null;}
}
// Test/host adapter with the same commit/read contract. It never touches Dex storage.
export class MemoryRecords {
  constructor(){this.records=new Map();}
  async read(key){return clone(this.records.get(key)??null);}
  async writeMany(entries){const next=new Map(this.records);for(const [key,value] of entries)next.set(key,clone(value));this.records=next;}
}

// Persistent transactional records for staged content packs; no live source is configured.
export class ContentRecords {
  constructor(indexedDB=globalThis.indexedDB){this.saves=new SaveStore(indexedDB);}
  read(key){return this.saves.read('content:'+key);}
  async writeMany(entries){
    const db=await this.saves.open();
    await new Promise((resolve,reject)=>{const tx=db.transaction('records','readwrite'),s=tx.objectStore('records');try{for(const [key,value] of entries)s.put(value,'content:'+key);}catch(error){tx.abort();reject(error);return;}tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error||new Error('Could not activate content'));});
  }
}
