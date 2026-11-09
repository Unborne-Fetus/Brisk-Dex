import fs from 'node:fs/promises';
import path from 'node:path';

// Standalone static site, with no Electron or Capacitor bridge.
const root=process.cwd(),dest=path.join(root,'web-dist');
await fs.rm(dest,{recursive:true,force:true});
await fs.mkdir(dest,{recursive:true});
const files=[
  'index.html','asset-loader.js','localization.js',
  'emerald-compat.js','gba-rom-import.js','classic-rom-import.js',
  'rom-compat-audit.js','github-rom-source.js','brisk-dex-data.json','brisk-dex-trainer-teams.json'
];
for(const name of files)await fs.copyFile(path.join(root,name),path.join(dest,name));
const dirs=[
  'brisk-dex-icons','brisk-dex-asset-patches','brisk-dex-items',
  'brisk-dex-sprites','brisk-dex-cries','brisk-dex-trainers','brisk-dex-trainer-pics'
];
for(const name of dirs){
  try{await fs.cp(path.join(root,name),path.join(dest,name),{recursive:true});}
  catch(error){if(error.code!=='ENOENT')throw error;}
}
const icons=await fs.readdir(path.join(dest,'brisk-dex-icons'));
const manifest={icons:{},shinyIcons:{}};
for(const name of icons){
  const match=name.match(/^(\d+)(_shiny)?\.png$/i);
  if(match)(match[2]?manifest.shinyIcons:manifest.icons)[match[1]]='brisk-dex-icons/'+name;
}
await fs.writeFile(path.join(dest,'brisk-dex-icon-manifest.json'),JSON.stringify(manifest));
await fs.writeFile(path.join(dest,'.nojekyll'),'');
console.log('Adapt Dex web bundle built: '+Object.keys(manifest.icons).length+' icons and '+Object.keys(manifest.shinyIcons).length+' shiny icons.');
