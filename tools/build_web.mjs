import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'web-dist');
await fs.rm(output, {recursive:true,force:true});
await fs.mkdir(output, {recursive:true});
const files = ['index.html','brisk-dex-data.json','brisk-dex-trainer-teams.json','asset-loader.js','localization.js'];
const dirs = ['brisk-dex-asset-patches','brisk-dex-icons','brisk-dex-trainers','brisk-dex-items','brisk-dex-trainer-pics','brisk-dex-sprites','brisk-dex-cries'];
for(const filename of files) await fs.copyFile(path.join(root,filename),path.join(output,filename));
for(const dir of dirs){
  try{await fs.cp(path.join(root,dir),path.join(output,dir),{recursive:true});}
  catch(error){if(error.code!=='ENOENT')throw error;}
}
const names = await fs.readdir(path.join(root,'brisk-dex-icons'));
const icons={},shinyIcons={};
for(const name of names){
  const match=name.match(/^(\d+)(_shiny)?\.png$/i);
  if(match)(match[2]?shinyIcons:icons)[match[1]]='brisk-dex-icons/'+name;
}
await fs.writeFile(path.join(output,'brisk-dex-icon-manifest.json'),JSON.stringify({icons,shinyIcons}));
await fs.writeFile(path.join(output,'.nojekyll'),'');
console.log('Web edition ready in web-dist; '+Object.keys(icons).length+' normal icons.');
