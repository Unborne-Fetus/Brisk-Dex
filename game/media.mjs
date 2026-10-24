// Reuse Brisk Dex's corrected/lazy graphics, including custom forms and shinies.
const resolved=new Map(),packs=new Map();let manifest;
async function json(url){const response=await fetch(url);if(!response.ok)throw new Error('Graphic pack unavailable');return response.json();}
export async function resolveSprite(url){
  const key=url.replace(/^\.\.\//,'');if(resolved.has(key))return resolved.get(key);
  manifest??=json('../brisk-dex-asset-patches/manifest.json');const file=(await manifest)[key];if(!file)return url;
  if(!packs.has(file))packs.set(file,(async()=>{const text=await json('../brisk-dex-asset-patches/'+file),bytes=Uint8Array.from(atob(text),c=>c.charCodeAt(0)),stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),entries=JSON.parse(await new Response(stream).text());for(const [path,data] of Object.entries(entries))resolved.set(path,data);})());
  await packs.get(file);return resolved.get(key)||url;
}
export function loadSprite(img,url){img.src=url;resolveSprite(url).then(corrected=>{if(img.getAttribute('src')===url)img.src=corrected;}).catch(()=>{});}
