import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

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

window.briskAndroidAPI = {
  isAndroid: Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android',
  saveBytes(bytes, fileName, mimeType) {
    return shareBase64(bytesToBase64(bytes), fileName, mimeType || 'application/octet-stream');
  },
  saveText(text, fileName, mimeType) {
    return shareBase64(btoa(unescape(encodeURIComponent(String(text)))), fileName, mimeType || 'text/plain');
  }
};
