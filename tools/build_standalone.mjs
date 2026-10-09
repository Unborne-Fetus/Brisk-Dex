import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

// Run this once by the developer; users only receive standalone/index.html.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'standalone', 'index.html');
const assetDirs = [
  'brisk-dex-icons', 'brisk-dex-sprites', 'brisk-dex-items',
  'brisk-dex-trainers', 'brisk-dex-trainer-pics', 'brisk-dex-cries',
  'brisk-dex-asset-patches'
];
const mimeTypes = {
  '.json':'application/json', '.png':'image/png', '.gif':'image/gif',
  '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp',
  '.svg':'image/svg+xml', '.ogg':'audio/ogg', '.mp3':'audio/mpeg',
  '.wav':'audio/wav', '.woff':'font/woff', '.woff2':'font/woff2',
  '.css':'text/css', '.txt':'text/plain', '.bin':'application/octet-stream'
};
const mediaExtensions = new Set(Object.keys(mimeTypes));
const packed = {};
const add = (name, bytes) => {
  const ext = path.extname(name).toLowerCase();
  packed[name] = [mimeTypes[ext] || 'application/octet-stream', gzipSync(bytes).toString('base64')];
};
async function addDir(folder) {
  let entries;
  try { entries = await fs.readdir(path.join(root, folder), {withFileTypes:true}); }
  catch(err) { if(err.code === 'ENOENT') return; throw err; }
  for(const entry of entries) {
    const relative = path.posix.join(folder, entry.name);
    if(entry.isDirectory()) await addDir(relative);
    else if(entry.isFile() && mediaExtensions.has(path.extname(entry.name).toLowerCase())) {
      add(relative, await fs.readFile(path.join(root, relative)));
    }
  }
}
for(const dir of assetDirs) await addDir(dir);
for(const filename of ['brisk-dex-data.json','brisk-dex-trainer-teams.json']) {
  add(filename, await fs.readFile(path.join(root, filename)));
}
const icons = {}, shinyIcons = {};
for(const name of Object.keys(packed)) {
  const match = /^brisk-dex-icons\/(\d+)(_shiny)?\.png$/i.exec(name);
  if(match) (match[2] ? shinyIcons : icons)[match[1]] = name;
}
add('brisk-dex-icon-manifest.json', Buffer.from(JSON.stringify({icons, shinyIcons})));

let html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
for(const name of ['asset-loader.js','localization.js']) {
  const tag = '<script src="' + name + '"></script>';
  if(!html.includes(tag)) throw new Error('Expected external script: ' + name);
  const source = (await fs.readFile(path.join(root, name), 'utf8'))
    .replace(/<\/script/gi, '<\\/script');
  html = html.replace(tag, '<script>\n' + source + '\n</script>');
}
// The original source intentionally protects users who directly open index.html.
// This generated edition has its own embedded fetch implementation.
const guard = "if (location.protocol === 'file:' && !IS_ELECTRON && !IS_ANDROID && !IS_IOS) {";
if(!html.includes(guard)) throw new Error('Direct-file browser guard changed; review standalone build');
html = html.replace(guard, 'if (false && location.protocol === \'file:\') {');
const reconnect = 'if(ONLINE_STATE.roomCode&&ONLINE_STATE.playerId){';
if(!html.includes(reconnect)) throw new Error('Online reconnect guard changed');
html = html.replace(reconnect, 'if(false && ONLINE_STATE.roomCode && ONLINE_STATE.playerId){');
const cryFunction = 'function playDexCry(url){';
const cryAudio = 'dexCryAudio=new Audio(url);';
if(!html.includes(cryFunction) || !html.includes(cryAudio)) throw new Error('Dex cry playback changed');
html = html.replace(cryFunction, 'async function playDexCry(url){');
html = html.replace(cryAudio, 'dexCryAudio=new Audio(await window.BriskStandalone.assetUrl(url));');

const bootstrap = `
<style>
#tab-online,#tab-trading,#online-tab-panel,#trading-tab-panel { display:none !important; }
</style>
<script id="brisk-standalone-runtime">
(function(){
'use strict';
const packed = __PACKED__;
const cache = new Map();
const urls = new Map();
const originalFetch = window.fetch.bind(window);
const textDecoder = new TextDecoder();
function keyFor(input) {
  let value = typeof input === 'string' ? input : (input && input.url || '');
  if(!value || /^(data:|blob:)/i.test(value)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    let url;
    try { url = new URL(value); } catch { return null; }
    if(url.origin !== location.origin || url.protocol !== location.protocol) return null;
    const dir = location.pathname.slice(0, location.pathname.lastIndexOf('/')+1);
    if(!url.pathname.startsWith(dir)) return null;
    value = decodeURIComponent(url.pathname.slice(dir.length));
  }
  value = value.split(/[?#]/)[0].replace(/^\\.\\//,'').replace(/^\\//,'');
  return Object.prototype.hasOwnProperty.call(packed, value) ? value : null;
}
async function bytesFor(key) {
  if(!cache.has(key)) cache.set(key, (async()=>{
    const base64 = packed[key][1];
    const bytes = Uint8Array.from(atob(base64), c=>c.charCodeAt(0));
    const zipped = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(zipped).arrayBuffer());
  })());
  return cache.get(key);
}
window.fetch = async function(input, options) {
  const key = keyFor(input);
  if(!key) return originalFetch(input, options);
  const method = (options && options.method || 'GET').toUpperCase();
  if(method !== 'GET' && method !== 'HEAD') return new Response('Method not allowed', {status:405});
  const bytes = method === 'HEAD' ? null : await bytesFor(key);
  return new Response(bytes, {status:200,headers:{'Content-Type':packed[key][0]}});
};
async function resolveImage(img) {
  const original = img.getAttribute('src');
  const key = keyFor(original);
  if(!key || img.dataset.briskEmbeddedKey === key) return;
  img.dataset.briskEmbeddedKey = key;
  try {
    if(!urls.has(key)) urls.set(key, bytesFor(key).then(bytes=>
      URL.createObjectURL(new Blob([bytes],{type:packed[key][0]}))));
    const objectUrl = await urls.get(key);
    if(img.dataset.briskEmbeddedKey === key) img.src = objectUrl;
  } catch(error) { console.error('Could not display bundled graphic:', key, error); }
}
function scan(node) {
  if(node.nodeType !== 1) return;
  if(node.tagName === 'IMG') resolveImage(node);
  node.querySelectorAll && node.querySelectorAll('img').forEach(resolveImage);
}
const observer = new MutationObserver(records=>{
  for(const record of records) {
    if(record.type === 'attributes') resolveImage(record.target);
    else record.addedNodes.forEach(scan);
  }
});
observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src']});
document.addEventListener('DOMContentLoaded', ()=>scan(document.body));
window.BriskStandalone = {
  assetCount:Object.keys(packed).length,
  assetUrl:async function(url) {
    const key=keyFor(url);
    if(!key) return url;
    if(!urls.has(key)) urls.set(key, bytesFor(key).then(bytes=>
      URL.createObjectURL(new Blob([bytes],{type:packed[key][0]}))));
    return urls.get(key);
  }
};
})();
</script>`;
html = html.replace('</head>', bootstrap.replace('__PACKED__', JSON.stringify(packed)) + '\n</head>');
await fs.mkdir(path.dirname(output), {recursive:true});
await fs.writeFile(output, html);
const size = (await fs.stat(output)).size;
console.log('Standalone Brisk Dex: ' + output);
console.log(Object.keys(packed).length + ' resources embedded (' + (size/1048576).toFixed(1) + ' MiB HTML).');
console.log('Share ONLY standalone/index.html; no installation, web hosting, or additional files required.');
