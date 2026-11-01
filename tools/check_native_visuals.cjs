'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
function ppm(file){
 const bytes=fs.readFileSync(file),match=/^P6\s+240\s+160\s+255\s/.exec(bytes.subarray(0,80).toString('ascii'));
 assert.ok(match,'Expected a native 240×160 P6 screenshot: '+file);
 const pixels=bytes.subarray(match[0].length);assert.equal(pixels.length,240*160*3);return pixels;
}
function variedPixels(pixels,x0,y0,x1,y1){
 const counts=new Map();let total=0;
 for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const at=(y*240+x)*3,key=(pixels[at]<<16)|(pixels[at+1]<<8)|pixels[at+2];counts.set(key,(counts.get(key)||0)+1);total++;}
 return total-Math.max(...counts.values());
}
function check(directory){
 const naming=ppm(path.join(directory,'04_naming.ppm'));
 assert.ok(variedPixels(naming,40,70,170,145)>250,'Naming keyboard is missing (flat background in the key area)');
 for(const scene of ['06_house','09_outside']){
  const image=ppm(path.join(directory,scene+'.ppm'));let lit=0;
  for(let p=0;p<image.length;p+=3)if(image[p]||image[p+1]||image[p+2])lit++;
  assert.ok(lit>240*160*0.5,scene+': background tiles are missing or black');
 }
 console.log('Native visual checks passed: naming keyboard, house and outdoor background layers.');
}
module.exports={ppm,variedPixels,check};
if(require.main===module)check(process.argv[2]);
