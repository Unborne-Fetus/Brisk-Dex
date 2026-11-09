'use strict';
const assert=require('assert');
const crypto=require('crypto');
const R=require('../gba-rom-import.js');
async function run(){
  assert.strictEqual(R.portableSha256(new Uint8Array(0)),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.strictEqual(R.portableSha256(new Uint8Array([97,98,99])),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const megabyte=Buffer.alloc(1024*1024,0xAB);
  assert.strictEqual(R.portableSha256(megabyte),
    crypto.createHash('sha256').update(megabyte).digest('hex'));

  const rom=new Uint8Array(8192).fill(0xFF);
  rom[0xB2]=0x96;rom[0xA0]=66;rom[0xA1]=68;rom[0x200]=17;
  const live=0x201;
  const fingerprint={
    algorithm:'sha256',liveRomLength:live,
    sha256:crypto.createHash('sha256').update(Buffer.from(rom.subarray(0,live))).digest('hex')
  };
  const manifest={format:'briskdex-rom-v1',meta:{sourceFingerprint:fingerprint},data:{}};
  const valid=await R.verifyIndexedSource(rom,manifest);
  assert.strictEqual(valid.status,'verified');
  assert.strictEqual(valid.sha256,fingerprint.sha256);
  assert.strictEqual((await R.verifyIndexedSource(rom,{meta:{}})).status,'legacy');
  const modified=rom.slice();
  modified[0x200]^=0x01;
  await assert.rejects(()=>R.verifyIndexedSource(modified,manifest),/SHA-256 mismatch/);
  await assert.rejects(()=>R.verifyIndexedSource(rom,{meta:{sourceFingerprint:{
    algorithm:'sha256',liveRomLength:0,sha256:fingerprint.sha256
  }}}),/invalid source fingerprint/);
  console.log('ROM/index SHA-256 binding and changed-ROM rejection passed');
}
run().catch(err=>{console.error(err);process.exitCode=1;});
