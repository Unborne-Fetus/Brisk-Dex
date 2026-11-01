'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const testOnLinux=(name,fn)=>test(name,{skip:process.platform==='win32'},fn);
const script=path.resolve(__dirname,'../../tools/setup-native-deps.sh');
async function sandbox(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'brisk-deps-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const bin=path.join(dir,'bin');await fs.mkdir(bin);
 const stub=async(name,body)=>fs.writeFile(path.join(bin,name),'#!/bin/bash\n'+body,{mode:0o755});
 // No package manager or real compiler is invoked by these tests.
 for(const name of ['gcc','make','git','python3','pkg-config','curl','tar','sha256sum','clang','x86_64-w64-mingw32-gcc','x86_64-w64-mingw32-windres','x86_64-w64-mingw32-as'])
  await stub(name,'exit 0\n');
 await stub('id','echo 0\n');
 await stub('apt-get','printf "%s\\n" "$*" >> "$BRISK_TEST_LOG"\nexit "${BRISK_TEST_APT_EXIT:-0}"\n');
 return {dir,stub,run:mode=>spawnSync('/bin/bash',[script,'windows',mode],{
  env:{...process.env,PATH:bin,BRISK_TEST_LOG:path.join(dir,'apt.log')},encoding:'utf8'
 })};
}
testOnLinux('native preflight skips installation when tools are ready',async t=>{
 const s=await sandbox(t);const r=s.run('--install');assert.equal(r.status,0,r.stderr);
 await assert.rejects(fs.stat(path.join(s.dir,'apt.log')),{code:'ENOENT'});
});
testOnLinux('native preflight reports the missing multilib and never installs in check mode',async t=>{
 const s=await sandbox(t);await s.stub('gcc','exit 1\n');const r=s.run('--check');
 assert.equal(r.status,1);assert.match(r.stderr,/gcc-multilib libc6-dev-i386/);
 await assert.rejects(fs.stat(path.join(s.dir,'apt.log')),{code:'ENOENT'});
});
testOnLinux('native setup installs the missing packages before returning success',async t=>{
 const s=await sandbox(t);await s.stub('gcc','exit 1\n');const r=s.run('--install');
 assert.equal(r.status,0,r.stderr);
 assert.equal(await fs.readFile(path.join(s.dir,'apt.log'),'utf8'),
  'update\ninstall -y --no-install-recommends gcc-multilib libc6-dev-i386\n');
});
testOnLinux('native setup stops on a package index failure',async t=>{
 const s=await sandbox(t);await s.stub('gcc','exit 1\n');await s.stub('apt-get','echo update >> "$BRISK_TEST_LOG"\nexit 42\n');
 const r=s.run('--install');assert.equal(r.status,42);
 assert.equal(await fs.readFile(path.join(s.dir,'apt.log'),'utf8'),'update\n');
});

 testOnLinux('Windows native preflight includes host SDL for the data-layout submake',async t=>{
 const s=await sandbox(t);
 await s.stub('pkg-config','if [ "$2" = sdl2 ]; then exit 1; fi\nexit 0\n');
 const r=s.run('--check');assert.equal(r.status,1);
 assert.match(r.stderr,/libsdl2-dev/);
 });
