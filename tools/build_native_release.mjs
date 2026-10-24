#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {validatePack} from '../game/world.mjs';
import {sha256} from '../game/storage.mjs';
const [source,output]=process.argv.slice(2);
if(!source||!output){console.error('Usage: node tools/build_native_release.mjs <content.json> <output-directory>');process.exitCode=1;}
else{
  const pack=validatePack(JSON.parse(await fs.readFile(source,'utf8'))),bytes=new TextEncoder().encode(JSON.stringify(pack)),destination=path.resolve(output);
  await fs.mkdir(destination,{recursive:true});
  const manifest={format:'brisk-native-release',schema:1,version:pack.version,minimumEngine:1,url:'./content.json',bytes:bytes.length,sha256:await sha256(bytes)};
  await fs.writeFile(path.join(destination,'content.json'),bytes);await fs.writeFile(path.join(destination,'release.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(`Built ${pack.version} content release (${bytes.length} bytes). No upload, publication or updater connection performed.`);
}
