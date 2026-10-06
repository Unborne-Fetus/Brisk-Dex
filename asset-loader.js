/* Lazy-load corrected game graphics; keep PNG/GIF data intact, including animation. */
(function(){
 const packs=new Map(),urls=new Map(),pending=new WeakMap();let manifest;
 async function loadJSON(path){
  if(window.briskDexAPI&&window.briskDexAPI.loadAssetPatch)return JSON.parse(await window.briskDexAPI.loadAssetPatch(path));
  const response=await fetch(path);if(!response.ok)throw new Error('Could not load game graphics');return response.json();
 }
 async function resolve(url){
  const key=String(url).replace(/^\.\//,'').split('?')[0];
  if(!/^(brisk-dex-sprites|brisk-dex-items)\//.test(key))return null;
  if(urls.has(key))return urls.get(key);
  if(!manifest)manifest=loadJSON('brisk-dex-asset-patches/manifest.json');
  const info=await manifest,file=info[key];if(!file)return null;
  if(!packs.has(file))packs.set(file,(async()=>{
   const base64=await loadJSON('brisk-dex-asset-patches/'+file),bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
   const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
   const entries=JSON.parse(await new Response(stream).text());Object.entries(entries).forEach(([k,v])=>urls.set(k,v));return entries;
  })());
  await packs.get(file);return urls.get(key);
 }
 async function patchImage(img){
  const original=img.getAttribute('src');if(!original||original.startsWith('data:')||pending.get(img)===original)return;
  pending.set(img,original);
  try{const corrected=await resolve(original);if(corrected&&img.getAttribute('src')===original)img.src=corrected;}catch(e){console.warn(e.message);}
 }
 window.BriskAssets={resolve,patchImage};
 new MutationObserver(records=>{records.forEach(r=>{if(r.type==='attributes'&&r.target.tagName==='IMG')patchImage(r.target);else r.addedNodes.forEach(n=>{if(n.nodeType!==1)return;if(n.tagName==='IMG')patchImage(n);n.querySelectorAll('img').forEach(patchImage);});});}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['src']});
 document.querySelectorAll('img').forEach(patchImage);
})();
