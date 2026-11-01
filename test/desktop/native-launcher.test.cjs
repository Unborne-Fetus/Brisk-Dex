const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {validateNativeExecutable}=require('../../native-launcher');
test('Windows executable must have the correct name and SDL2.dll',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'brisk-native-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const exe=path.join(dir,'pokeemerald-native.exe');
 await fs.writeFile(exe,'fixture');
 assert.equal((await validateNativeExecutable(exe,'win32')).ok,false);
 await fs.writeFile(path.join(dir,'SDL2.dll'),'fixture');
 assert.equal((await validateNativeExecutable(exe,'win32')).ok,true);
 assert.equal((await validateNativeExecutable(path.join(dir,'other.exe'),'win32')).ok,false);
});
test('Linux builds need an executable bit; unsupported platforms are rejected',{skip:process.platform==='win32'},async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'brisk-native-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const exe=path.join(dir,'pokeemerald-native');
 await fs.writeFile(exe,'fixture',{mode:0o600});
 assert.equal((await validateNativeExecutable(exe,'linux')).ok,false);
 await fs.chmod(exe,0o700);
 assert.equal((await validateNativeExecutable(exe,'linux')).ok,true);
 assert.equal((await validateNativeExecutable(exe,'darwin')).ok,false);
});
