import {test} from 'node:test';import assert from 'node:assert/strict';
import {FieldMotion,FieldInput,visibleMaps} from '../../game/field-motion.mjs';
const pack={maps:{a:{id:'a',width:20,height:20,connections:[{map:'b',direction:'right',offset:3}]},b:{id:'b',width:20,height:20,connections:[{map:'a',direction:'left',offset:-3}]}}};
test('camera interpolates continuously in both directions across connected map origins',()=>{
 const m=new FieldMotion();m.update({map:'a',x:19,y:8},pack,0);assert.deepEqual(m.update({map:'b',x:0,y:5},pack,150),{map:'b',x:-1,y:5,moving:true});assert.equal(m.update({map:'b',x:0,y:5},pack,225).x,-.5);assert.equal(m.update({map:'b',x:0,y:5},pack,300).x,0);assert.equal(m.update({map:'a',x:19,y:8},pack,450).x,20);assert.equal(m.update({map:'a',x:19,y:8},pack,600).x,19);
});
test('warps teleport while connected-map layout uses source offsets without recursion loops',()=>{
 const m=new FieldMotion();m.update({map:'a',x:3,y:3},pack,0);assert.equal(m.update({map:'b',x:10,y:15},pack,100).x,10);const maps=visibleMaps(pack,pack.maps.a,{x:15,y:0});assert.equal(maps.length,2);assert.equal(maps[1].x,20);assert.equal(maps[1].y,3);
});
test('input serializes taps, prioritizes latest held direction and resets on blur/modal',async()=>{
 const steps=[],input=new FieldInput({step:async(...d)=>steps.push(d)});input.press('right',[1,0]);await input.tick(0);input.release('right');input.press('up',[0,-1]);await input.tick(40);assert.equal(steps.length,1);await input.tick(150);input.press('left',[-1,0]);await input.tick(300);await input.tick(450);assert.deepEqual(steps,[[1,0],[0,-1],[-1,0],[-1,0]]);input.clear();await input.tick(600);assert.equal(steps.length,4);await input.idle();
});
test('async events cannot overlap movement and queued taps are discarded when input is blocked',async()=>{
 let resolve,blocked=false,count=0;const input=new FieldInput({canMove:()=>!blocked,step:()=>{count++;return new Promise(r=>resolve=r);}});input.press('r',[1,0]);const first=input.tick(0);input.press('u',[0,-1]);await input.tick(300);assert.equal(count,1);blocked=true;resolve();await first;await input.tick(450);assert.equal(input.queue.length,0);await input.idle();
});

test('reduced-motion mode presents the destination without intermediate positions',()=>{const m=new FieldMotion();m.update({map:'a',x:3,y:3},pack,0,0);assert.equal(m.update({map:'a',x:4,y:3},pack,1,0).x,4);});
