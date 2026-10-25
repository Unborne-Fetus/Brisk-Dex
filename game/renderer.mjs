import {FieldMotion,visibleMaps,pixelCamera} from './field-motion.mjs';
import {resolveSprite} from './media.mjs';
const cache=new Map(),motion=new WeakMap();
function image(url){if(!url)return null;if(!cache.has(url)){const img=new Image();if(globalThis.BriskGameAssets)globalThis.BriskGameAssets.assetUrl(url).then(src=>img.src=src);else {img.src=url;if(url.startsWith('../brisk-dex-sprites/'))resolveSprite(url).then(src=>img.src=src).catch(()=>{});}cache.set(url,img);}const img=cache.get(url);return img.complete&&img.naturalWidth?img:null;}
export function drawNative(ctx,campaign,pack,facing,time){
  const m=campaign.map,current=campaign.state.position;let animation=motion.get(campaign);
  if(!animation){animation=new FieldMotion();motion.set(campaign,animation);}
  const p=animation.update(current,pack,time,campaign.presentationStepMs??150),moving=p.moving,t=32;
  const connected=m.outdoor&&(m.connections||[]).some(l=>['up','down','left','right'].includes(l.direction)),rawCx=connected?p.x-7:m.width<15?-(15-m.width)/2:campaign.state.sceneMap===m.id?p.x-7:Math.max(0,Math.min(m.width-15,p.x-7)),rawCy=connected?p.y-5:m.height<10?-(10-m.height)/2:campaign.state.sceneMap===m.id?p.y-5:Math.max(0,Math.min(m.height-10,p.y-5));
  const {x:cx,y:cy}=pixelCamera(rawCx,rawCy,t);
  ctx.fillStyle='#172d29';ctx.fillRect(0,0,480,320);const base=image(m.ground),top=image(m.foreground);const changes=campaign.state.metatiles?.[m.id];
  function layer(source,atlasPath){if(!source)return;if(!changes){ctx.drawImage(source,-cx*t,-cy*t,m.width*t,m.height*t);return;}const atlas=image(atlasPath);for(let y=Math.max(0,Math.floor(cy));y<Math.min(m.height,Math.ceil(cy+10));y++)for(let x=Math.max(0,Math.floor(cx));x<Math.min(m.width,Math.ceil(cx+15));x++){const change=changes[`${x},${y}`];if(change&&atlas)ctx.drawImage(atlas,(change.id%32)*16,Math.floor(change.id/32)*16,16,16,(x-cx)*t,(y-cy)*t,t,t);else ctx.drawImage(source,x*16,y*16,16,16,(x-cx)*t,(y-cy)*t,t,t);}}
  // Extend border tiles under the connected scene instead of exposing black gaps.
  if(base)for(let y=Math.floor(cy);y<Math.ceil(cy+10);y++)for(let x=Math.floor(cx);x<Math.ceil(cx+15);x++)if(x<0||y<0||x>=m.width||y>=m.height)ctx.drawImage(base,Math.max(0,Math.min(m.width-1,x))*16,Math.max(0,Math.min(m.height-1,y))*16,16,16,(x-cx)*t,(y-cy)*t,t,t);
  const neighbors=visibleMaps(pack,m,{x:cx,y:cy}).filter(e=>e.map.id!==m.id).map(e=>({dest:e.map,x:e.x,y:e.y}));
  for(const {dest,x,y}of neighbors){const pic=image(dest.ground);if(pic)ctx.drawImage(pic,(x-cx)*t,(y-cy)*t,dest.width*t,dest.height*t);image(dest.foreground);for(const e of campaign.visibleEvents(dest))if(e.sprite)image(e.sprite.path);}
  layer(base,m.metatileAtlas?.ground);
  function drawWild(actor){
    const wild=campaign.catalog.wildSprites,source=wild?.species[actor.mon.species],species=campaign.catalog.species(actor.mon.species),pic=image(source?(actor.mon.shiny?wild.shiny:wild.normal):'../'+(actor.mon.shiny?species.frontShinySprite:species.frontSprite));if(!pic)return;
    const x=(actor.x-cx)*t,y=(actor.y-cy)*t;ctx.fillStyle='#152e3155';ctx.beginPath();ctx.ellipse(x+16,y+27,12,4,0,0,Math.PI*2);ctx.fill();
    if(source){const size=source.width||32,height=source.height||32,asymmetric=source.frames>=8,frame=({down:0,up:2,left:4,right:asymmetric?6:4}[actor.facing]||0)+Math.floor(time/200)%2,dw=size*2,dh=height*2,dx=x+16-dw/2,dy=y+32-dh;ctx.save();if(actor.facing==='right'&&!asymmetric){ctx.translate(dx+dw,dy);ctx.scale(-1,1);ctx.drawImage(pic,source.x+frame*size,source.y,size,height,0,0,dw,dh);}else ctx.drawImage(pic,source.x+frame*size,source.y,size,height,dx,dy,dw,dh);ctx.restore();}else ctx.drawImage(pic,x-4,y-12,40,40);
    if(actor.mon.shiny){ctx.fillStyle='#ffe482';ctx.fillRect(x+29,y,3,3);}
  }
  const actors=[...campaign.visibleEvents(),...neighbors.flatMap(({dest,x,y})=>campaign.visibleEvents(dest).map(e=>({...e,x:e.x+x,y:e.y+y})))].filter(e=>e.sprite&&e.kind!=='warp').map(e=>({...e,isPlayer:false}));actors.push({...p,sprite:campaign.catalog.fieldData?.playerSprites?.[campaign.mode]?.[campaign.state.trainer.gender||'Male']||pack.playerSprites?.[campaign.state.trainer.gender||'Male'],isPlayer:true});if(campaign.state.options.encounters&&campaign.state.options.overworldEncounters&&campaign.state.wildlife?.map===m.id)actors.push(...campaign.state.wildlife.actors.map(a=>({...a,isWild:true})));actors.sort((a,b)=>a.y-b.y);
  for(const actor of actors){
    if(actor.isWild){drawWild(actor);continue;}
    if(actor.isPlayer&&moving&&campaign.presentationRunning)actor.sprite={path:'assets/player-'+(campaign.state.trainer.gender==='Female'?'may':'brendan')+'-running.png',width:16,height:32,frames:9};
    const sheet=image(actor.sprite?.path);if(!sheet)continue;
    const s=actor.sprite;let frame=/FACE_UP/.test(actor.movementType)?1:/FACE_(?:LEFT|RIGHT)/.test(actor.movementType)?2:0,flip=/FACE_RIGHT/.test(actor.movementType);
    if(actor.isPlayer){if(facing[1]<0)frame=1;else if(facing[0]){frame=2;flip=facing[0]>0;}if(s.frameMap)frame=s.frameMap[frame]??0;else if(moving&&s.frames>=9){const base=frame;frame=[base===0?3:base===1?5:7,base,base===0?4:base===1?6:8,base][Math.floor(time/100)%4];}}
    if(!actor.isPlayer&&actor.walking&&s.frames>=9)frame=[frame===0?3:frame===1?5:7,frame,frame===0?4:frame===1?6:8,frame][Math.floor(time/100)%4];
    const phase=Math.floor(time*60/1000)%32,bob=actor.isPlayer&&campaign.mode!=='land'?(phase<16?-Math.floor(phase/4):-4+Math.floor((phase-16)/4))*2:0;
    const dx=Math.round(((actor.x-cx)*t+16-s.width)/2)*2,dy=Math.round(((actor.y-cy+1)*t-s.height*2+bob)/2)*2;
    if(actor.isPlayer&&campaign.mode==='surf'){const blob=campaign.catalog.fieldData?.surfBlob?.[campaign.state.trainer.gender||'Male'],pic=image(blob?.path),blobFrame=facing[1]<0?1:facing[0]?2:0;if(pic){ctx.save();if(flip){ctx.translate(dx+64,dy+16);ctx.scale(-1,1);ctx.drawImage(pic,blobFrame*32,0,32,32,0,0,64,64);}else ctx.drawImage(pic,blobFrame*32,0,32,32,dx,dy+16,64,64);ctx.restore();}}

    const emote=actor.isPlayer?campaign.state.playerEmote:actor.emote;if(emote){const text=emote.includes('question')?'?':emote.includes('heart')?'♥':emote.includes('double')?'‼':'!';ctx.fillStyle='#fff';ctx.fillRect(dx+s.width-8,dy-26,16,22);ctx.fillStyle='#303030';ctx.font='20px Emerald,monospace';ctx.textAlign='center';ctx.fillText(text,dx+s.width,dy-8);ctx.textAlign='start';}
    ctx.save();if(flip){ctx.translate(dx+s.width*2,dy);ctx.scale(-1,1);ctx.drawImage(sheet,frame*s.width,0,s.width,s.height,0,0,s.width*2,s.height*2);}else ctx.drawImage(sheet,frame*s.width,0,s.width,s.height,dx,dy,s.width*2,s.height*2);ctx.restore();
  }
  for(const {dest,x,y}of neighbors){const pic=image(dest.foreground);if(pic)ctx.drawImage(pic,(x-cx)*t,(y-cy)*t,dest.width*t,dest.height*t);}
  layer(top,m.metatileAtlas?.foreground);
  if(campaign.storyInfo.requiresFlash&&campaign.state.flashLevel!==0){const x=(p.x-cx)*t+16,y=(p.y-cy)*t+16,shade=ctx.createRadialGradient(x,y,40,x,y,140);shade.addColorStop(0,'#0000');shade.addColorStop(1,'#000f');ctx.fillStyle=shade;ctx.fillRect(0,0,480,320);}
}
