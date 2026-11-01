(function(root){
  'use strict';
  // Standard Gamepad mapping: south/east, back/start, shoulders and D-pad.
  function gamepadMask(pad){
    if(!pad?.connected||pad.mapping!=='standard')return 0;
    const pressed=i=>pad.buttons[i]?.pressed===true;
    let mask=0;
    for(const [button,bit] of [[0,0],[1,1],[8,2],[9,3],[15,4],[14,5],[12,6],[13,7],[5,8],[4,9]])
      if(pressed(button))mask|=1<<bit;
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
  const api={gamepadMask,InputState};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BriskNativeControls=api;
})(globalThis);
