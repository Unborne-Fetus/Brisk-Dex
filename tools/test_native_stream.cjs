#!/usr/bin/env node
'use strict';
// CI builds from source but never uploads the game executable or compiled assets.
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {PacketDecoder}=require('../native-embedded');
const executable=path.join(__dirname,'..','native-game','linux','pokeemerald-native');
if(!fs.existsSync(executable)){console.error('Native game not compiled');process.exit(1);}
const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'brisk-native-smoke-'));
let frames=0;
const child=spawn(executable,['--headless','--silent','--frames','30','--data-dir',dataDir],
 {env:{...process.env,BRISK_FRAME_STREAM:'1'},stdio:['pipe','pipe','pipe']});
const decoder=new PacketDecoder(()=>frames++);
child.stdout.on('data',b=>decoder.push(b));
let err='';child.stderr.on('data',b=>{err=(err+b.toString()).slice(-3000);});
const timeout=setTimeout(()=>{child.kill('SIGKILL');console.error('Native smoke timeout');process.exitCode=1;},120000);
child.once('exit',(code)=>{
 clearTimeout(timeout);fs.rmSync(dataDir,{recursive:true,force:true});
 if(code!==0||frames<2){console.error('Native smoke failed:',{code,frames,error:err});process.exitCode=1;}
 else console.log('Native engine ran headless and emitted '+frames+' game frames');
});
