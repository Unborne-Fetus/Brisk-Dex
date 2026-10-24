const cache=new Map();
function image(url){if(!url)return null;if(!cache.has(url)){const img=new Image();img.src=url;cache.set(url,img);}const img=cache.get(url);return img.complete&&img.naturalWidth?img:null;}
export function drawNative(ctx,campaign,pack,facing,time){
  const m=campaign.map,p=campaign.state.position,t=24,cx=m.width<26?-(26-m.width)/2:Math.max(0,Math.min(m.width-26,p.x-13)),cy=m.height<18?-(18-m.height)/2:Math.max(0,Math.min(m.height-18,p.y-9));
  ctx.fillStyle='#172d29';ctx.fillRect(0,0,624,432);const base=image(m.ground),top=image(m.foreground);if(base)ctx.drawImage(base,-cx*t,-cy*t,m.width*t,m.height*t);
  const actors=m.events.filter(e=>e.sprite&&e.kind!=='warp').map(e=>({...e,isPlayer:false}));actors.push({...p,sprite:pack.playerSprites?.[campaign.state.trainer.gender||'Male'],isPlayer:true});actors.sort((a,b)=>a.y-b.y);
  for(const actor of actors){
    const sheet=image(actor.sprite?.path);if(!sheet)continue;
    const s=actor.sprite;let frame=0,flip=false;
    if(actor.isPlayer){if(facing[1]<0)frame=1;else if(facing[0]){frame=2;flip=facing[0]>0;}}
    const dx=(actor.x-cx)*t+12-s.width*.75,dy=(actor.y-cy+1)*t-s.height*1.5;
    ctx.save();if(flip){ctx.translate(dx+s.width*1.5,dy);ctx.scale(-1,1);ctx.drawImage(sheet,frame*s.width,0,s.width,s.height,0,0,s.width*1.5,s.height*1.5);}else ctx.drawImage(sheet,frame*s.width,0,s.width,s.height,dx,dy,s.width*1.5,s.height*1.5);ctx.restore();
  }
  if(top)ctx.drawImage(top,-cx*t,-cy*t,m.width*t,m.height*t);
}
