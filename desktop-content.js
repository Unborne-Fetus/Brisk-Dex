const path=require('node:path');
// A standard secure origin lets modules, fetch, IndexedDB and Web Crypto work
// identically in an installed ASAR and in development, without a local server.
function assetPath(url,root){
  const parsed=new URL(url);if(parsed.protocol!=='brisk:'||parsed.hostname!=='app')return null;
  let name;try{name=decodeURIComponent(parsed.pathname);}catch{return null;}
  if(name.includes('\\')||name.includes('\0')||name.split('/').includes('..'))return null;
  const target=path.resolve(root,'.'+(name==='/'?'/index.html':name));
  return target.startsWith(path.resolve(root)+path.sep)?target:null;
}
module.exports={assetPath};
