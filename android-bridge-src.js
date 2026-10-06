import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

const SaveFilePicker = registerPlugin('SaveFilePicker');

function bytesToBase64(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < data.length; i += chunkSize) {
    binary += String.fromCharCode(...data.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function cleanFileName(name) {
  return String(name || 'brisk-dex-export')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/^\.+/, '')
    .slice(0, 120) || 'brisk-dex-export';
}

async function shareBase64(data, fileName, mimeType) {
  const safeName = cleanFileName(fileName);
  const path = `brisk-dex/${Date.now()}-${safeName}`;
  const written = await Filesystem.writeFile({
    path,
    data,
    directory: Directory.Cache,
    recursive: true
  });
  const uri = written.uri || (await Filesystem.getUri({ path, directory: Directory.Cache })).uri;
  await Share.share({
    title: safeName,
    text: 'Exported from Brisk Dex',
    files: [uri],
    dialogTitle: 'Save or share ' + safeName
  });
  return { ok: true, uri, mimeType };
}

const platform = Capacitor.getPlatform();
const mobileAPI = {
  isNative: Capacitor.isNativePlatform(),
  isAndroid: Capacitor.isNativePlatform() && platform === 'android',
  isIOS: Capacitor.isNativePlatform() && platform === 'ios',
  async discoverBattleRelay() {
    return SaveFilePicker.discoverBattleRelay({port:8787,timeoutMs:2600});
  },
  async battleRequest(url, options) {
    let parsed=new URL(url);
    if(!['http:','https:'].includes(parsed.protocol))throw new Error('Use an HTTP or HTTPS relay address.');
    if (['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)) {
      const found=await SaveFilePicker.discoverBattleRelay({port:Number(parsed.port)||8787,timeoutMs:2200});
      if(!found||!found.url)throw new Error('No Brisk battle relay was found on this Wi-Fi network. Start Host Battle on another device, or enter its relay address manually.');
      const base=new URL(found.url);
      parsed.protocol=base.protocol; parsed.hostname=base.hostname; parsed.port=base.port;
      url=parsed.toString();
      try{
        localStorage.setItem('briskdex_battle_relay',found.url);
        const relay=document.getElementById('online-relay');
        if(relay)relay.value=found.url;
      }catch(_){}
    }
    const response=await CapacitorHttp.request({url,method:options.method||'GET',headers:{'Content-Type':'application/json'},data:options.body?JSON.parse(options.body):undefined,connectTimeout:10000,readTimeout:15000});
    const data=typeof response.data==='string'?JSON.parse(response.data):response.data;
    if(response.status<200||response.status>=300)throw new Error(data.error||('Battle server returned '+response.status));
    return data;
  },
  async openSaveFile() {
    if (platform !== 'android') return null;
    return SaveFilePicker.openSaveFile();
  },
  async readSaveFile(uri) {return SaveFilePicker.readSaveFile({uri});},
  async writeSaveFile(uri, bytes) {return SaveFilePicker.writeSaveFile({uri,data:bytesToBase64(bytes)});},
  saveBytes(bytes, fileName, mimeType) {
    return shareBase64(bytesToBase64(bytes), fileName, mimeType || 'application/octet-stream');
  },
  saveText(text, fileName, mimeType) {
    return shareBase64(btoa(unescape(encodeURIComponent(String(text)))), fileName, mimeType || 'text/plain');
  }
};
window.briskMobileAPI = mobileAPI;
window.briskAndroidAPI = mobileAPI;
window.briskIOSAPI = mobileAPI;

