'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const SAVE_BYTES=131072+28,MAX_BACKUP_BYTES=200000;
function crc32(bytes){
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}
function validateSave(save,profile){
  if(save.length!==SAVE_BYTES||save.subarray(0,8).toString('ascii')!=='PENSAVE\0')
    throw new Error('This is not a native Pokemon Brisk Emerald save. GBA saves require conversion.');
  if(save.readUInt32LE(8)!==1||save.readUInt32LE(12)!==64||save.readUInt32LE(16)!==(profile==='brisk'?0x42524b31:1)||save.readUInt32LE(20)!==131072)
    throw new Error('This save uses an incompatible game layout or platform.');
  if(save.readUInt32LE(24)!==crc32(save.subarray(28)))throw new Error('Save checksum failed; the backup is damaged.');
}
function validateClock(rtc){
  if(rtc!==null&&(typeof rtc!=='string'||! /^-?\d{1,16}\n$/.test(rtc)||Math.abs(Number(rtc))>2**50))
    throw new Error('The backup clock data is invalid.');
}
function saveDirectory(userData,profile){
  if(!['brisk','expansion'].includes(profile))throw new Error('Unknown game profile.');
  return path.join(userData,profile==='brisk'?'native-brisk-emerald':'native-expansion');
}
async function createBackup(userData,profile){
  const dir=saveDirectory(userData,profile);
  const save=await fs.readFile(path.join(dir,'pokeemerald.sav'));
  validateSave(save,profile);
  let rtc=null;
  try{rtc=await fs.readFile(path.join(dir,'pokeemerald.rtc'),'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
  validateClock(rtc);
  return JSON.stringify({format:'brisk-native-backup',version:1,profile,createdAt:new Date().toISOString(),save:save.toString('base64'),rtc},null,2)+'\n';
}
function parseBackup(text,profile){
  if(Buffer.byteLength(text)>MAX_BACKUP_BYTES)throw new Error('The backup is too large.');
  const backup=JSON.parse(text);
  if(!backup||backup.format!=='brisk-native-backup'||backup.version!==1||backup.profile!==profile||typeof backup.save!=='string')
    throw new Error('Choose a native backup for the currently installed game.');
  const save=Buffer.from(backup.save,'base64');
  if(save.toString('base64')!==backup.save)throw new Error('The backup save encoding is invalid.');
  validateSave(save,profile);validateClock(backup.rtc);
  return {save,rtc:backup.rtc};
}
async function restoreBackup(userData,profile,text){
  const backup=parseBackup(text,profile); // Validate everything before touching player files.
  const dir=saveDirectory(userData,profile),staging=dir+'.restore-'+randomUUID();
  const previous=dir+'.before-restore-'+randomUUID();
  let moved=false;
  await fs.mkdir(userData,{recursive:true});
  try{
    await fs.mkdir(staging);
    await fs.writeFile(path.join(staging,'pokeemerald.sav'),backup.save,{flag:'wx'});
    if(backup.rtc!==null)await fs.writeFile(path.join(staging,'pokeemerald.rtc'),backup.rtc,{flag:'wx'});
    try{await fs.copyFile(path.join(dir,'settings.ini'),path.join(staging,'settings.ini'));}catch(error){if(error.code!=='ENOENT')throw error;}
    try{await fs.rename(dir,previous);moved=true;}catch(error){if(error.code!=='ENOENT')throw error;}
    try{await fs.rename(staging,dir);}catch(error){if(moved)await fs.rename(previous,dir);throw error;}
    return {previous:moved?previous:null};
  }finally{await fs.rm(staging,{recursive:true,force:true});}
}
module.exports={MAX_BACKUP_BYTES,crc32,validateSave,saveDirectory,createBackup,parseBackup,restoreBackup};
