#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const source=process.env.BRISK_NATIVE_SOURCE_DIR||path.join(root,'native-src','brisk-emerald-native');
const executable=path.join(root,'native-game','linux','pokeemerald-native');
const work=fs.mkdtempSync(path.join(os.tmpdir(),'brisk-playthrough-'));
const output=path.join(work,'out');fs.mkdirSync(output);
const smoke=path.join(source,'tests','smoke');
const profileGate=`wait-until task_first=Task_SelectBriskSaveSlot max 2000
expect native_heap_bytes=16777216
expect brisk_species_count=1818
expect brisk_trainer_count=1489
press A
wait-until task_first=Task_HandleMainMenuInput max 1000`;
let start=fs.readFileSync(path.join(smoke,'opening_start.replay'),'utf8');
start=start.replace('wait-until task_first=Task_HandleMainMenuInput max 600',profileGate);
fs.writeFileSync(path.join(smoke,'brisk_opening_start.replay'),start);
let replay=fs.readFileSync(path.join(smoke,'opening.replay'),'utf8');
replay=replay.replace('include opening_start.replay','include brisk_opening_start.replay');
replay=replay.replace('wait-until task_first=Task_HandleMainMenuInput max 600',profileGate);
replay+=`
expect brisk_profile=0
expect brisk_slot0_used=1
expect brisk_slot1_used=0
# Check the other profile remains empty, then return to the original save.
restart
wait-until task_first=Task_TitleScreenPhase3 max 30000
press START
wait-until task_first=Task_SelectBriskSaveSlot max 2000
press DOWN
press A
wait-until task_first=Task_HandleMainMenuInput max 1000
expect brisk_profile=1
expect brisk_slot0_used=1
expect brisk_slot1_used=0
dump 28_second_profile_empty
press B
wait-until task_first=Task_TitleScreenPhase3 max 30000
press START
wait-until task_first=Task_SelectBriskSaveSlot max 2000
press A
wait-until task_first=Task_HandleMainMenuInput max 1000
press A
wait-until callback2=CB2_Overworld max 2000
wait 20
expect brisk_profile=0
expect party0_species=252
expect player_name=Ab
expect save_counter=1
dump 29_profile0_restored
`;
const script=path.join(smoke,'brisk_opening.replay');fs.writeFileSync(script,replay);
const args=['--headless','--silent','--unthrottled','--rtc-fixed','1700000000',
 '--save',path.join(work,'brisk.sav'),'--rtc-offset',path.join(work,'brisk.rtc'),
 '--replay',script,'--out',output];
const env={...process.env};delete env.BRISK_FRAME_STREAM;
const child=spawn(executable,args,{cwd:source,env,stdio:['ignore','pipe','pipe']});
let stdout='',stderr='';
child.stdout.on('data',b=>{stdout=(stdout+b).slice(-12000);});
child.stderr.on('data',b=>{stderr=(stderr+b).slice(-16000);});
const timer=setTimeout(()=>{child.kill('SIGKILL');console.error('Brisk playthrough timed out');process.exitCode=1;},240000);
child.once('error',e=>{clearTimeout(timer);console.error(e);process.exitCode=1;});
child.once('exit',code=>{
 clearTimeout(timer);
 try{
  assert.equal(code,0,'Brisk playthrough failed\n'+stdout+'\n'+stderr);
  const final=fs.readFileSync(path.join(output,'29_profile0_restored.txt'),'utf8');
  console.log('Brisk opening, first battle, in-game save, cold reload, and profile isolation passed.');
  console.log(final.split('\n').filter(l=>/^(native_heap|brisk_|party0_|player_name|map_name|save_counter)/.test(l)).join('\n'));
  const save=fs.readFileSync(path.join(work,'brisk.sav'));
  assert.equal(save.readUInt32LE(16),0x42524b31,'Brisk save uses its own layout identifier');
  assert.equal(save.length,131072+28,'Two compact profiles use the native flash container');
  fs.rmSync(work,{recursive:true,force:true});
 }catch(error){console.error(error.message);console.error('Replay diagnostics:',work);process.exitCode=1;}
});
