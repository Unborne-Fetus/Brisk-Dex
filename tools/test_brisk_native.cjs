#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const source=process.env.BRISK_NATIVE_SOURCE_DIR||path.join(root,'native-src','brisk-emerald-native');
const target=process.argv[2]||'linux';
const executable=path.join(root,'native-game',target==='windows'?'win32':'linux',target==='windows'?'pokeemerald-native.exe':'pokeemerald-native');
const work=fs.mkdtempSync(path.join(os.tmpdir(),'brisk-playthrough-'));
const output=path.join(work,'out');fs.mkdirSync(output);
const smoke=path.join(source,'tests','smoke');
const profileGate=`wait-until task_first=Task_SelectBriskSaveSlot max 2000
expect native_heap_bytes=16777216
press A
wait-until task_first=Task_HandleMainMenuInput max 1000`;
let start=fs.readFileSync(path.join(smoke,'opening_start.replay'),'utf8');
start=start.replace('wait-until task_first=Task_HandleMainMenuInput max 600',profileGate);
fs.writeFileSync(path.join(smoke,'brisk_opening_start.replay'),start);
let replay=fs.readFileSync(path.join(smoke,'opening.replay'),'utf8');
replay=replay.replace('include opening_start.replay','include brisk_opening_start.replay');
replay=replay.replace('wait-until task_first=Task_HandleMainMenuInput max 600',profileGate);
// Brisk exposes DexNav from the start, before Pokemon/Bag/Player/Save.
replay=replay.replace('# POKeMON, BAG, the player, SAVE: three down', '# DEXNAV, POKeMON, BAG, the player, SAVE: four down\npress DOWN\nwait 8');
// Brisk's Route 101 is taller and uses its own nine-starter case.
const bagStart=replay.indexOf("# Birch's bag lies");
const battleStart=replay.indexOf('wait-until in_battle=1',bagStart);
assert.ok(bagStart>=0 && battleStart>bagStart,'Upstream opening structure changed');
replay=replay.slice(0,bagStart)+`# Brisk bag at (10,17); approach it from the north after the chase.
hold DOWN
wait-until pos=11,16 max 200
release DOWN
hold LEFT
wait-until pos=10,16 max 200
release LEFT
wait 20
press DOWN
wait 10
press A
wait-until task_first=Task_BirchCaseMain max 1200
press DOWN
wait-until task_first=Task_BirchCaseMain max 300
wait 20
press A
wait-until task_first=Task_BirchCaseConfirmSelection max 300
press A
wait-until task_first=Task_BirchCaseRecievedMon max 300
press B
`+replay.slice(battleStart);

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
const debug=process.env.BRISK_REPLAY_DEBUG==='1';
const debugScript=path.join(work,'visual-debug.gdb');
fs.writeFileSync(debugScript,`set pagination off
break video_write_frame_ppm
commands
silent
printf "GPU snapshot: %s\\n", path
x/24xh 0x04000000
x/8xh 0x04000040
x/16xh 0x05000000
continue
end
run
thread apply all bt
`);
const child=spawn(debug?'gdb':executable,debug?['-batch','-x',debugScript,'--args',executable,...args]:args,{cwd:source,env,stdio:['ignore','pipe','pipe']});
let stdout='',stderr='';
child.stdout.on('data',b=>{stdout=(stdout+b).slice(-64000);});
child.stderr.on('data',b=>{stderr=(stderr+b).slice(-16000);});
const timer=setTimeout(()=>{child.kill('SIGKILL');console.error('Brisk playthrough timed out');process.exitCode=1;},240000);
child.once('error',e=>{clearTimeout(timer);console.error(e);process.exitCode=1;});
child.once('exit',(code,signal)=>{
 clearTimeout(timer);
 if(debug)console.log(stdout+'\n'+stderr);
 try{
  assert.equal(code,0,'Brisk playthrough failed ('+signal+')\n'+stdout+'\n'+stderr);
  require('./check_native_visuals.cjs').check(output);
  const final=fs.readFileSync(path.join(output,'29_profile0_restored.txt'),'utf8');
  const facts=Object.fromEntries(final.split('\n').map(line=>line.split('=')));
  for(const key of ['brisk_species_count','brisk_trainer_count'])assert.ok(Number(facts[key])>1000,key+' unexpectedly small');
  console.log('Brisk opening, first battle, in-game save, cold reload, and profile isolation passed.');
  console.log(final.split('\n').filter(l=>/^(native_heap|brisk_|party0_|player_name|map_name|save_counter)/.test(l)).join('\n'));
  const save=fs.readFileSync(path.join(work,'brisk.sav'));
  assert.equal(save.readUInt32LE(16),0x42524b31,'Brisk save uses its own layout identifier');
  assert.equal(save.length,131072+28,'Two compact profiles use the native flash container');
  fs.rmSync(work,{recursive:true,force:true});
 }catch(error){fs.cpSync(output,path.join(root,'native-diagnostics'),{recursive:true});console.error(error.message);console.error('Replay diagnostics:',work);for(const name of fs.readdirSync(output).filter(n=>n.endsWith('.txt')).sort().slice(-3)){console.error(name+'\n'+fs.readFileSync(path.join(output,name),'utf8'));}process.exitCode=1;}
});
