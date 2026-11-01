#!/usr/bin/env node
'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {gzipSync}=require('node:zlib');
const {sha256,safePath,unpack,validateManifest}=require('../native-updater');
(async()=>{
 const platform=process.argv[2],output=path.resolve(process.argv[3]||'update-dist');
 if(!['win32','linux'].includes(platform))throw new Error('Usage: node tools/build_update_bundle.cjs win32|linux [output]');
 const root=path.resolve(__dirname,'..'),pkg=require('../package.json'),files=[];
 async function add(name){
  if(!safePath(name))throw new Error('Unsafe bundle path: '+name);
  const absolute=path.join(root,name),stat=await fs.lstat(absolute);
  if(stat.isSymbolicLink())throw new Error('Symlinks are not allowed in updates.');
  if(stat.isDirectory()){for(const child of (await fs.readdir(absolute)).sort())await add(name+'/'+child);return;}
  if(!stat.isFile()||name.endsWith('.symbols')||files.some(f=>f.path===name))return;
  const data=await fs.readFile(absolute);files.push({path:name,mode:platform==='linux'&&name==='native-game/linux/pokeemerald-native'?0o755:0o644,sha256:sha256(data),data:data.toString('base64')});
 }
 for(const pattern of pkg.build.files)await add(pattern.replace(/\/\*\*\/\*$/,''));
 await add('package.json');await add('native-game/'+platform);
 const payload={format:'brisk-runtime',api:1,platform,arch:'x64',files};
 const bytes=gzipSync(Buffer.from(JSON.stringify(payload)),{level:9}),hash=sha256(bytes);
 const manifest={format:'brisk-update',api:1,platform,arch:'x64',version:pkg.version,sequence:Number(process.env.GITHUB_RUN_NUMBER||Math.floor(Date.now()/1000)),revision:process.env.GITHUB_SHA||'local',saveLayout:0x42524b31,sha256:hash,bytes:bytes.length,asset:'runtime-'+hash+'.json.gz'};
 validateManifest(manifest,platform,'x64');unpack(bytes,manifest);
 await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,manifest.asset),bytes);await fs.writeFile(path.join(output,'latest-'+platform+'-x64.json'),JSON.stringify(manifest,null,2)+'\n');
 console.log('Validated update bundle:',files.length,'files,',bytes.length,'bytes,',hash);
})().catch(error=>{console.error(error);process.exitCode=1;});
