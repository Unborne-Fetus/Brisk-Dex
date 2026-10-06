import { Capacitor, registerPlugin } from '@capacitor/core';
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

