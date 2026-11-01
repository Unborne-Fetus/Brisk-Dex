'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
async function validateNativeExecutable(file,platform=process.platform){
  if(!['win32','linux'].includes(platform))return {ok:false,error:'Native expansion supports Windows and Linux only.'};
  if(typeof file!=='string'||!file.trim())return {ok:false,error:'Choose a built native executable.'};
  const executable=path.resolve(file),name=platform==='win32'?'pokeemerald-native.exe':'pokeemerald-native';
  if(path.basename(executable)!==name)return {ok:false,error:'Expected '+name+' from the native expansion build.'};
  try{
    const stat=await fs.stat(executable);
    if(!stat.isFile())return {ok:false,error:'Native executable path is not a file.'};
    if(platform==='linux'&&(stat.mode&0o111)===0)return {ok:false,error:'Linux native game is not executable.'};
    if(platform==='win32'&&!(await fs.stat(path.join(path.dirname(executable),'SDL2.dll'))).isFile())
      return {ok:false,error:'SDL2.dll is not a file.'};
    return {ok:true,executable};
  }catch(e){return {ok:false,error:e.code==='ENOENT'?'Native game or SDL2.dll not found.':'Cannot inspect native game: '+e.message};}
}
module.exports={validateNativeExecutable};
