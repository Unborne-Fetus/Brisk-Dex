const cache=new Map(),motion=new WeakMap();
function image(url){if(!url)return null;if(!cache.has(url)){const img=new Image();if(globalThis.BriskGameAssets)globalThis.BriskGameAssets.assetUrl(url).then(src=>img.src=src);else img.src=url;cache.set(url,img);}const img=cache.get(url);return img.complete&&img.naturalWidth?img:null;}
export function drawNative(ctx,campaign,pack,facing,time){
  const m=campaign.map,current=campaign.state.position;let animation=motion.get(campaign);
  if(!animation||animation.map!==current.map){animation={...current,fromX:current.x,fromY:current.y,at:time};motion.set(campaign,animation);}
  else if(animation.x!==current.x||animation.y!==current.y){const near=Math.abs(animation.x-current.x)+Math.abs(animation.y-current.y)===1;animation={...current,fromX:near?animation.x:current.x,fromY:near?animation.y:current.y,at:time};motion.set(campaign,animation);}
  const progress=Math.min(1,Math.max(0,(time-animation.at)/150)),moving=progress<1&&(animation.fromX!==animation.x||animation.fromY!==animation.y),p={...current,x:animation.fromX+(current.x-animation.fromX)*progress,y:animation.fromY+(current.y-animation.fromY)*progress},t=32,cx=m.width<15?-(15-m.width)/2:Math.max(0,Math.min(m.width-15,p.x-7)),cy=m.height<10?-(10-m.height)/2:Math.max(0,Math.min(m.height-10,p.y-5));
  ctx.fillStyle='#172d29';ctx.fillRect(0,0,480,320);const base=image(m.ground),top=image(m.foreground);const changes=campaign.state.metatiles?.[m.id];
  function layer(source,atlasPath){if(!source)return;if(!changes){ctx.drawImage(source,-cx*t,-cy*t,m.width*t,m.height*t);return;}const atlas=image(atlasPath);for(let y=Math.max(0,Math.floor(cy));y<Math.min(m.height,Math.ceil(cy+10));y++)for(let x=Math.max(0,Math.floor(cx));x<Math.min(m.width,Math.ceil(cx+15));x++){const change=changes[`${x},${y}`];if(change&&atlas)ctx.drawImage(atlas,(change.id%32)*16,Math.floor(change.id/32)*16,16,16,(x-cx)*t,(y-cy)*t,t,t);else ctx.drawImage(source,x*16,y*16,16,16,(x-cx)*t,(y-cy)*t,t,t);}}
  layer(base,m.metatileAtlas?.ground);
  const actors=campaign.visibleEvents().filter(e=>e.sprite&&e.kind!=='warp').map(e=>({...e,isPlayer:false}));actors.push({...p,sprite:pack.playerSprites?.[campaign.state.trainer.gender||'Male'],isPlayer:true});actors.sort((a,b)=>a.y-b.y);
  for(const actor of actors){
    const sheet=image(actor.sprite?.path);if(!sheet)continue;
    const s=actor.sprite;let frame=/FACE_UP/.test(actor.movementType)?1:/FACE_(?:LEFT|RIGHT)/.test(actor.movementType)?2:0,flip=/FACE_RIGHT/.test(actor.movementType);
    if(actor.isPlayer){if(facing[1]<0)frame=1;else if(facing[0]){frame=2;flip=facing[0]>0;}if(moving&&s.frames>=9){const base=frame;frame=[base===0?3:base===1?5:7,base,base===0?4:base===1?6:8,base][Math.floor(time/100)%4];}}
    const dx=(actor.x-cx)*t+16-s.width,dy=(actor.y-cy+1)*t-s.height*2;
    ctx.save();if(flip){ctx.translate(dx+s.width*2,dy);ctx.scale(-1,1);ctx.drawImage(sheet,frame*s.width,0,s.width,s.height,0,0,s.width*2,s.height*2);}else ctx.drawImage(sheet,frame*s.width,0,s.width,s.height,dx,dy,s.width*2,s.height*2);ctx.restore();
  }
  layer(top,m.metatileAtlas?.foreground);
}
