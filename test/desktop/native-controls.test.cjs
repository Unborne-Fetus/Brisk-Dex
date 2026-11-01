'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {gamepadMask,InputState,settings}=require('../../native-controls');
function pad(buttons=[],axes=[0,0]){return {connected:true,mapping:'standard',buttons:Array.from({length:16},(_,i)=>({pressed:buttons.includes(i)})),axes};}
test('standard controller forwards every GBA button and ignores stick drift',()=>{
  assert.equal(gamepadMask(pad([0,1,8,9,15,14,12,13,5,4])),1023);
  assert.equal(gamepadMask(pad([],[0.2,-0.2])),0);
  assert.equal(gamepadMask(pad([],[-0.7,0.8])),(1<<5)|(1<<7));
  assert.equal(gamepadMask({...pad([0]),connected:false}),0);
  assert.equal(gamepadMask({...pad([0]),mapping:''}),0);
});
test('releasing one input source leaves another held key active; focus loss clears all',()=>{
  const sent=[],input=new InputState(mask=>sent.push(mask));
  input.set('keyboard',1);input.set('controller',1);input.set('keyboard',0);
  assert.deepEqual(sent,[1]);
  input.set('touch1',2);input.set('controller',0);
  assert.deepEqual(sent,[1,3,2]);
  input.clear();assert.equal(input.mask,0);assert.equal(input.sources.size,0);
  assert.deepEqual(sent,[1,3,2,0]);
});
test('control preferences support alternate keys and controller buttons, rejecting corrupt settings',()=>{
 const custom=settings();delete custom.keys.KeyZ;custom.keys.KeyC=0;
 [custom.buttons[0],custom.buttons[1]]=[custom.buttons[1],custom.buttons[0]];
 const loaded=settings(JSON.parse(JSON.stringify(custom)));
 assert.equal(loaded.keys.KeyC,0);assert.equal(loaded.keys.KeyZ,undefined);
 assert.equal(gamepadMask(pad([1]),loaded.buttons),1);
 assert.equal(settings({speed:900,buttons:Array(10).fill(0),keys:{KeyC:0}}).speed,1);
 assert.equal(settings({buttons:Array(10).fill(0)}).buttons[1],1);
});
