// Presentation coordinates are local to the current map. A connected crossing
// translates the previous position, so the camera and walking frame never snap.
export function mapOffset(map,link,pack){
 if(!['up','down','left','right'].includes(link.direction))return null;const dest=pack.maps[link.map];if(!dest)return null;
 return {x:link.direction==='left'?-dest.width:link.direction==='right'?map.width:link.offset,
 y:link.direction==='up'?-dest.height:link.direction==='down'?map.height:link.offset};
}
export class FieldMotion {
 update(position,pack,time,duration=150){
  const old=this.target;
  if(!old){this.from={...position};this.at=time;}
  else if(old.map!==position.map||old.x!==position.x||old.y!==position.y){
   const shown=this.sample(time),link=pack.maps[old.map]?.connections?.find(l=>l.map===position.map),offset=link&&mapOffset(pack.maps[old.map],link,pack);
   const from=old.map===position.map?shown:offset?{x:shown.x-offset.x,y:shown.y-offset.y}:position;
   const near=Math.abs(from.x-position.x)+Math.abs(from.y-position.y)<=2.1;
   this.from=near?{...from}:{...position};this.at=time;
  }
  this.target={...position};this.duration=duration;return this.sample(time);
 }
 sample(time){if(!this.target)return this.from;const progress=this.duration===0?1:Math.min(1,Math.max(0,(time-this.at)/(this.duration||150)));return {map:this.target.map,x:this.from.x+(this.target.x-this.from.x)*progress,y:this.from.y+(this.target.y-this.from.y)*progress,moving:progress<1&&(this.from.x!==this.target.x||this.from.y!==this.target.y)};}
}
// Breadth-first connected-map layout, culled to the visible camera rectangle.
export function visibleMaps(pack,map,camera,margin=2){
 const out=[],queue=[{map,x:0,y:0,depth:0}],seen=new Set([map.id]);
 while(queue.length){const entry=queue.shift(),m=entry.map;out.push(entry);if(entry.depth>=3)continue;
  for(const link of m.connections||[]){const dest=pack.maps[link.map],offset=mapOffset(m,link,pack);if(!dest||!offset||seen.has(dest.id))continue;const x=entry.x+offset.x,y=entry.y+offset.y;
   if(x+dest.width<camera.x-margin||y+dest.height<camera.y-margin||x>camera.x+15+margin||y>camera.y+10+margin)continue;
   seen.add(dest.id);queue.push({map:dest,x,y,depth:entry.depth+1});
  }
 }return out;
}
export class FieldInput {
 constructor({step,canMove=()=>true,interval=()=>150,onError=()=>{}}){Object.assign(this,{step,canMove,interval,onError});this.held=new Map();this.queue=[];this.last=-Infinity;this.running=false;this.waiters=[];}
 press(key,direction){if(this.held.has(key))return;this.held.set(key,direction);if(this.queue.length<8)this.queue.push(direction);}
 release(key){this.held.delete(key);}
 clear(){this.held.clear();this.queue.length=0;this.notify();}
 idle(){return !this.running&&!this.queue.length?Promise.resolve():new Promise(resolve=>this.waiters.push(resolve));}
 notify(){if(!this.running&&!this.queue.length)for(const resolve of this.waiters.splice(0))resolve();}
 async tick(time,forced=null){
  if(this.running)return;if(!this.canMove()){this.queue.length=0;this.notify();return;}if(time-this.last<this.interval())return;
  const direction=forced||this.queue.shift()||[...this.held.values()].at(-1);if(!direction){this.notify();return;}
  if(forced)this.queue.length=0;this.last=time;this.running=true;
  try{await this.step(...direction);}catch(error){this.onError(error);}finally{this.running=false;this.notify();}
 }
}
// Both background layers and individual changed metatiles use this same pixel
// origin. Two-pixel steps preserve the 2× source raster without sampling seams.
export function pixelCamera(x,y,tile=32){return {x:Math.round(x*tile/2)*2/tile,y:Math.round(y*tile/2)*2/tile};}
