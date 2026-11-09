'use strict';
const assert=require('node:assert/strict');
const Github=require('../github-rom-source.js');
assert.equal(Github.parse('https://github.com/Trainer/CustomHack').kind,'repository');
assert.equal(Github.parse('https://github.com/Trainer/CustomHack/tree/adapt-dex').ref,'adapt-dex');
const raw=Github.parse('https://github.com/Trainer/CustomHack/blob/main/test.gba');
assert.equal(raw.kind,'rom');
assert.equal(raw.url,'https://raw.githubusercontent.com/Trainer/CustomHack/main/test.gba');
assert.equal(Github.parse('https://raw.githubusercontent.com/Trainer/CustomHack/main/metadata.json').kind,'index');
assert.equal(Github.parse('https://github.com/Trainer/CustomHack/releases/download/v1/MyHack.gbc').kind,'rom');
assert.throws(()=>Github.parse('https://example.com/a.gba'),/github/i);
assert.throws(()=>Github.parse('http://github.com/Trainer/CustomHack'),/HTTPS/i);
assert.throws(()=>Github.parse('https://github.com/Trainer/CustomHack/blob/main/README.md'),/\.gb|\.json/);
function mock(body,status=200,mime='application/octet-stream'){
  const bytes=body instanceof Uint8Array?body:new TextEncoder().encode(JSON.stringify(body));
  return {ok:status===200,status:status,headers:{get:k=>k==='content-length'?String(bytes.byteLength):null},
    body:null,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),
    json:async()=>JSON.parse(new TextDecoder().decode(bytes))};
}
const index={species:{'1':{name:'Testmon'}},routeEncounters:[{id:'MAP_FOO',name:'Custom Road'}]};
const rom=new Uint8Array(0x200).fill(255);rom[0xB2]=0x96;
const urls={
 'https://api.github.com/repos/Trainer/CustomHack':mock({default_branch:'main'}),
 'https://raw.githubusercontent.com/Trainer/CustomHack/main/adapt-dex-data.json':mock(index),
 'https://raw.githubusercontent.com/Trainer/CustomHack/main/test.gba':mock(rom),
 'https://raw.githubusercontent.com/Trainer/CustomHack/main/evil.json':mock('invalid')
};
urls['https://api.github.com/repos/Trainer/ReleasedHack']=mock({default_branch:'main'});
urls['https://api.github.com/repos/Trainer/ReleasedHack/releases/latest']=mock({assets:[
  {name:'ReleasedHack.gba',size:rom.length,browser_download_url:'https://github.com/Trainer/ReleasedHack/releases/download/v1/ReleasedHack.gba'}
]});
urls['https://github.com/Trainer/ReleasedHack/releases/download/v1/ReleasedHack.gba']=mock(rom);
const fetcher=async(url)=>urls[url]||mock({},404);
(async()=>{
 const repo=await Github.resolve('https://github.com/Trainer/CustomHack',{fetch:fetcher});
 assert.equal(repo.kind,'index');
 assert.equal(repo.data.species[1].name,'Testmon');
 const result=Github.referenceResult(repo);
 assert.equal(result.source,'github-reference-index');
 assert.equal(result.complete,false);
 assert.equal(result.counts.species,1);
 assert.equal(result.saveSupport,'no-rom-no-edit');
 const release=await Github.resolve('https://github.com/Trainer/ReleasedHack',{fetch:fetcher});
 assert.equal(release.kind,'rom');
 assert.equal(release.name,'ReleasedHack.gba');
 assert.equal(release.bytes.length,rom.length);
 const direct=await Github.resolve('https://github.com/Trainer/CustomHack/blob/main/test.gba',{fetch:fetcher});
 assert.equal(direct.kind,'rom');
 assert.equal(direct.bytes.length,rom.length);
 await assert.rejects(Github.resolve('https://github.com/Trainer/SourceOnly',{fetch:fetcher}),/repository not found/i);
 assert.equal(Github.parseIndex(new TextEncoder().encode(JSON.stringify(
  {species:{'1':{name:'SafeMon'}},__proto__:{polluted:true}}
 ))).data.species['1'].name,'SafeMon');
 const dangerous=Github.parseIndex(new TextEncoder().encode(
  '{"species":{"1":{"name":"Safe"}},"__proto__":{"polluted":true}}'));
 assert.equal(Object.prototype.hasOwnProperty.call(dangerous.data,'__proto__'),false);
 assert.throws(()=>Github.parseIndex(new TextEncoder().encode('{"hello":"world"}')),/No supported Pokémon/);
 console.log('GitHub repository, direct ROM URL, source-index and safety tests passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
