import {assert, ENGINE_VERSION} from './model.mjs';
import {sha256} from './storage.mjs';
import {validatePack} from './world.mjs';
async function readBounded(response,limit) {
  const reader=response.body.getReader(),chunks=[];let size=0;
  try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;assert(size<=limit,'Download exceeds declared size');chunks.push(value);}}catch(error){await reader.cancel();throw error;}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
// No production endpoint or timer is installed. Host must explicitly supply one.
export class ContentUpdates {
  constructor({records,fetcher=globalThis.fetch,manifestURL,allowedOrigin}={}) {
    this.records=records;this.fetcher=fetcher;this.manifestURL=manifestURL;this.allowedOrigin=allowedOrigin;
  }
  url(value,base) {
    const url=new URL(value,base);assert(url.protocol==='https:'&&url.origin===this.allowedOrigin,'Content updates must use the configured HTTPS origin');assert(!url.username&&!url.password,'Credentials are not allowed in update URLs');return url;
  }
  async check(currentVersion) {
    assert(this.manifestURL&&this.allowedOrigin,'Automatic updates are not connected');
    const response=await this.fetcher(this.url(this.manifestURL),{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});assert(response.ok,'Could not check for content updates');
    const manifest=JSON.parse(new TextDecoder().decode(await readBounded(response,65536)));
    assert(manifest.format==='brisk-native-release'&&manifest.schema===1,'Unsupported release manifest');
    assert(typeof manifest.version==='string'&&manifest.version.length<=80,'Invalid release version');
    assert(Number.isInteger(manifest.minimumEngine)&&manifest.minimumEngine>=1&&manifest.minimumEngine<=ENGINE_VERSION,'Update requires a newer application');
    assert(/^[a-f0-9]{64}$/.test(manifest.sha256)&&Number.isInteger(manifest.bytes)&&manifest.bytes>0&&manifest.bytes<=8000000,'Invalid content download');this.url(manifest.url,this.manifestURL);
    return manifest.version===currentVersion?null:manifest;
  }
  async stage(manifest) {
    // Revalidate caller-provided manifests; do not trust only check().
    assert(manifest?.format==='brisk-native-release'&&manifest.schema===1&&Number.isInteger(manifest.minimumEngine)&&manifest.minimumEngine>=1&&manifest.minimumEngine<=ENGINE_VERSION,'Unsupported update');
    assert(Number.isInteger(manifest.bytes)&&manifest.bytes>0&&manifest.bytes<=8000000&&/^[a-f0-9]{64}$/.test(manifest.sha256),'Invalid content download');
    const response=await this.fetcher(this.url(manifest.url,this.manifestURL),{redirect:'error',signal:AbortSignal.timeout(30000)});assert(response.ok,'Content download failed');
    const bytes=await readBounded(response,manifest.bytes),size=bytes.length;
    assert(size===manifest.bytes,'Incomplete content download');
    assert(await sha256(bytes)===manifest.sha256,'Content checksum mismatch');const pack=validatePack(JSON.parse(new TextDecoder().decode(bytes)));assert(pack.version===manifest.version,'Content version mismatch');return pack;
  }
  async activate(pack, campaign) {
    validatePack(pack);assert(this.records,'No transactional content store configured');
    // Compatibility is checked before touching the active pack. Keep story IDs/maps stable.
    const state=campaign.snapshot(),candidate=structuredClone(state);candidate.contentVersion=pack.version;
    const {Campaign}=await import('./world.mjs');new Campaign(campaign.catalog,pack,candidate);
    const previous=await this.records.read('active');
    await this.records.writeMany([['rollback',{pack:previous,state}],['active',pack],['campaign',candidate]]);
    return {pack,state:candidate};
  }
}
