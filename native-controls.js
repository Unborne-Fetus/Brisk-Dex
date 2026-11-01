(function(root){
  'use strict';
  // Standard Gamepad mapping: south/east, back/start, shoulders and D-pad.
  const defaults={keys:{KeyZ:0,KeyX:1,Backspace:2,Enter:3,ArrowRight:4,ArrowLeft:5,ArrowUp:6,ArrowDown:7,KeyS:8,KeyA:9},buttons:[0,1,8,9,15,14,12,13,5,4],fastKey:'Tab',speed:1,fastSpeed:4,mute:false,pauseOnBlur:true};
  function settings(value={}){
    if(!value||typeof value!=='object'||Array.isArray(value))value={};
    const result={...defaults,...value,keys:{...defaults.keys},buttons:[...defaults.buttons]};
    if(value.keys&&Object.keys(value.keys).length===10&&new Set(Object.values(value.keys)).size===10&&Object.entries(value.keys).every(([key,bit])=>/^[A-Za-z][A-Za-z0-9]{0,30}$/.test(key)&&Number.isInteger(bit)&&bit>=0&&bit<10))result.keys={...value.keys};
    if(Array.isArray(value.buttons)&&value.buttons.length===10&&new Set(value.buttons).size===10&&value.buttons.every(n=>Number.isInteger(n)&&n>=0&&n<=31))result.buttons=[...value.buttons];
    for(const key of ['speed','fastSpeed'])if(![0,1,2,3,4].includes(result[key]))result[key]=defaults[key];
    for(const key of ['mute','pauseOnBlur'])result[key]=result[key]===true;
    if(!/^[A-Za-z][A-Za-z0-9]{0,30}$/.test(result.fastKey)||Object.hasOwn(result.keys,result.fastKey))result.fastKey='Tab';
    return result;
  }
  function gamepadMask(pad,buttons=defaults.buttons){
    if(!pad?.connected||pad.mapping!=='standard')return 0;
    const pressed=i=>pad.buttons[i]?.pressed===true;
    let mask=0;
    buttons.forEach((button,bit)=>{if(pressed(button))mask|=1<<bit;});
    const x=pad.axes[0]||0,y=pad.axes[1]||0;
    if(x>0.35)mask|=1<<4;
    if(x< -0.35)mask|=1<<5;
    if(y< -0.35)mask|=1<<6;
    if(y>0.35)mask|=1<<7;
    return mask;
  }
  class InputState{
    constructor(send){this.sources=new Map();this.mask=0;this.send=send;}
    set(source,mask){
      if(mask&1023)this.sources.set(source,mask&1023);else this.sources.delete(source);
      let combined=0;for(const value of this.sources.values())combined|=value;
      if(combined!==this.mask){this.mask=combined;this.send(combined);}
    }
    clear(){this.sources.clear();this.mask=0;this.send(0);}
  }
  const api={defaults,settings,gamepadMask,InputState};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BriskNativeControls=api;
})(globalThis);
