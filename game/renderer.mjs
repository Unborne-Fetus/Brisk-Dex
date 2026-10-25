import {resolveSprite} from './media.mjs';
const cache=new Map(),motion=new WeakMap();
function image(url){if(!url)return null;if(!cache.has(url)){const img=new Image();if(globalThis.BriskGameAssets)globalThis.BriskGameAssets.assetUrl(url).then(src=>img.src=src);else {img.src=url;if(url.startsWith('../brisk-dex-sprites/'))resolveSprite(url).then(src=>img.src=src).catch(()=>{});}cache.set(url,img);}const img=cache.get(url);return img.complete&&img.naturalWidth?img:null;}
export function drawNative(ctx,campaign,pack,facing,time){
  const m=campaign.map,current=campaign.state.position;let animation=motion.get(campaign);
  if(!animation||animation.map!==current.map){animation={...current,fromX:current.x,fromY:current.y,at:time};motion.set(campaign,animation);}
  else if(animation.x!==current.x||animation.y!==current.y){const near=Math.abs(animation.x-current.x)+Math.abs(animation.y-current.y)===1;animation={...current,fromX:near?animation.x:current.x,fromY:near?animation.y:current.y,at:time};motion.set(campaign,animation);}
  const progress=Math.min(1,Math.max(0,(time-animation.at)/150)),moving=progress<1&&(animation.fromX!==animation.x||animation.fromY!==animation.y),p={...current,x:animation.fromX+(current.x-animation.fromX)*progress,y:animation.fromY+(current.y-animation.fromY)*progress},t=32,cx=m.width<15?-(15-m.width)/2:campaign.state.sceneMap===m.id?p.x-7:Math.max(0,Math.min(m.width-15,p.x-7)),cy=m.height<10?-(10-m.height)/2:campaign.state.sceneMap===m.id?p.y-5:Math.max(0,Math.min(m.height-10,p.y-5));
  ctx.fillStyle='#172d29';ctx.fillRect(0,0,480,320);const base=image(m.ground),top=image(m.foreground);const changes=campaign.state.metatiles?.[m.id];
  function layer(source,atlasPath){if(!source)return;if(!changes){ctx.drawImage(source,-cx*t,-cy*t,m.width*t,m.height*t);return;}const atlas=image(atlasPath);for(let y=Math.max(0,Math.floor(cy));y<Math.min(m.height,Math.ceil(cy+10));y++)for(let x=Math.max(0,Math.floor(cx));x<Math.min(m.width,Math.ceil(cx+15));x++){const change=changes[`${x},${y}`];if(change&&atlas)ctx.drawImage(atlas,(change.id%32)*16,Math.floor(change.id/32)*16,16,16,(x-cx)*t,(y-cy)*t,t,t);else ctx.drawImage(source,x*16,y*16,16,16,(x-cx)*t,(y-cy)*t,t,t);}}
  const neighbors=[];for(const link of m.connections||[]){const dest=pack.maps[link.map];if(!dest||!['up','down','left','right'].includes(link.direction))continue;const x=link.direction==='left'?-dest.width:link.direction==='right'?m.width:link.offset,y=link.direction==='up'?-dest.height:link.direction==='down'?m.height:link.offset;neighbors.push({dest,x,y});const pic=image(dest.ground);if(pic)ctx.drawImage(pic,(x-cx)*t,(y-cy)*t,dest.width*t,dest.height*t);}
  layer(base,m.metatileAtlas?.ground);
  for(const actor of campaign.state.options.encounters&&campaign.state.wildlife?.map===m.id?campaign.state.wildlife.actors:[]){
    const wild=campaign.catalog.wildSprites,source=wild?.species[actor.mon.species],species=campaign.catalog.species(actor.mon.species),pic=image(source?(actor.mon.shiny?wild.shiny:wild.normal):'../'+(actor.mon.shiny?species.frontShinySprite:species.frontSprite));if(!pic)continue;
    const x=(actor.x-cx)*t,y=(actor.y-cy)*t;ctx.fillStyle='#152e3155';ctx.beginPath();ctx.ellipse(x+16,y+27,12,4,0,0,Math.PI*2);ctx.fill();
    if(source){const frame=({down:0,up:2,left:4,right:4}[actor.facing]||0)+Math.floor(time/400)%2;ctx.save();if(actor.facing==='right'){ctx.translate(x+48,y-32);ctx.scale(-1,1);ctx.drawImage(pic,source.x+frame*32,source.y,32,32,0,0,64,64);}else ctx.drawImage(pic,source.x+frame*32,source.y,32,32,x-16,y-32,64,64);ctx.restore();}else ctx.drawImage(pic,x-4,y-12,40,40);
    if(actor.mon.shiny){ctx.fillStyle='#ffe482';ctx.fillRect(x+29,y,3,3);}
  }
  const actors=campaign.visibleEvents().filter(e=>e.sprite&&e.kind!=='warp').map(e=>({...e,isPlayer:false}));actors.push({...p,sprite:campaign.catalog.fieldData?.playerSprites?.[campaign.mode]?.[campaign.state.trainer.gender||'Male']||pack.playerSprites?.[campaign.state.trainer.gender||'Male'],isPlayer:true});actors.sort((a,b)=>a.y-b.y);
  for(const actor of actors){
    const sheet=image(actor.sprite?.path);if(!sheet)continue;
    const s=actor.sprite;let frame=/FACE_UP/.test(actor.movementType)?1:/FACE_(?:LEFT|RIGHT)/.test(actor.movementType)?2:0,flip=/FACE_RIGHT/.test(actor.movementType);
    if(actor.isPlayer){if(facing[1]<0)frame=1;else if(facing[0]){frame=2;flip=facing[0]>0;}if(s.frameMap)frame=s.frameMap[frame]??0;else if(moving&&s.frames>=9){const base=frame;frame=[base===0?3:base===1?5:7,base,base===0?4:base===1?6:8,base][Math.floor(time/100)%4];}}
    if(!actor.isPlayer&&actor.walking&&s.frames>=9)frame=[frame===0?3:frame===1?5:7,frame,frame===0?4:frame===1?6:8,frame][Math.floor(time/100)%4];
    const phase=Math.floor(time*60/1000)%32,bob=actor.isPlayer&&campaign.mode!=='land'?(phase<16?-Math.floor(phase/4):-4+Math.floor((phase-16)/4))*2:0;
    const dx=(actor.x-cx)*t+16-s.width,dy=(actor.y-cy+1)*t-s.height*2+bob;
    if(actor.isPlayer&&campaign.mode==='surf'){const blob=campaign.catalog.fieldData?.surfBlob?.[campaign.state.trainer.gender||'Male'],pic=image(blob?.path),blobFrame=facing[1]<0?1:facing[0]?2:0;if(pic){ctx.save();if(flip){ctx.translate(dx+64,dy+16);ctx.scale(-1,1);ctx.drawImage(pic,blobFrame*32,0,32,32,0,0,64,64);}else ctx.drawImage(pic,blobFrame*32,0,32,32,dx,dy+16,64,64);ctx.restore();}}

    const emote=actor.isPlayer?campaign.state.playerEmote:actor.emote;if(emote){const text=emote.includes('question')?'?':emote.includes('heart')?'♥':emote.includes('double')?'‼':'!';ctx.fillStyle='#fff';ctx.fillRect(dx+s.width-8,dy-26,16,22);ctx.fillStyle='#303030';ctx.font='20px Emerald,monospace';ctx.textAlign='center';ctx.fillText(text,dx+s.width,dy-8);ctx.textAlign='start';}
    ctx.save();if(flip){ctx.translate(dx+s.width*2,dy);ctx.scale(-1,1);ctx.drawImage(sheet,frame*s.width,0,s.width,s.height,0,0,s.width*2,s.height*2);}else ctx.drawImage(sheet,frame*s.width,0,s.width,s.height,dx,dy,s.width*2,s.height*2);ctx.restore();
  }
  for(const {dest,x,y}of neighbors){const pic=image(dest.foreground);if(pic)ctx.drawImage(pic,(x-cx)*t,(y-cy)*t,dest.width*t,dest.height*t);}
  layer(top,m.metatileAtlas?.foreground);
  if(campaign.storyInfo.requiresFlash&&campaign.state.flashLevel!==0){const x=(p.x-cx)*t+16,y=(p.y-cy)*t+16,shade=ctx.createRadialGradient(x,y,40,x,y,140);shade.addColorStop(0,'#0000');shade.addColorStop(1,'#000f');ctx.fillStyle=shade;ctx.fillRect(0,0,480,320);}
}
