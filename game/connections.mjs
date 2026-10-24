export function connectedPosition(pack,map,x,y){
 if(x>=0&&y>=0&&x<map.width&&y<map.height)return {map:map.id,x,y};
 const direction=x<0?'left':x>=map.width?'right':y<0?'up':'down';
 for(const link of map.connections||[]){if(link.direction!==direction)continue;const dest=pack.maps[link.map];if(!dest)continue;const nx=direction==='left'?dest.width+x:direction==='right'?x-map.width:x-link.offset,ny=direction==='up'?dest.height+y:direction==='down'?y-map.height:y-link.offset;if(nx>=0&&ny>=0&&nx<dest.width&&ny<dest.height)return {map:dest.id,x:nx,y:ny};}return null;
}
