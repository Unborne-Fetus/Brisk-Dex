'use strict';
const nativeButtonNames=['A','B','Select','Start','Right','Left','Up','Down','R','L'];
function renderNativeBindings(){
  const list=document.getElementById('native-binding-list');list.replaceChildren();
  nativeButtonNames.forEach((name,bit)=>{
    const row=document.createElement('div'),label=document.createElement('span'),key=document.createElement('button'),button=document.createElement('input');
    label.textContent=name+' ';key.type='button';key.textContent=nativeBinding?.bit===bit?'Press a key…':Object.keys(nativePreferences.keys).find(code=>nativePreferences.keys[code]===bit);
    key.setAttribute('aria-label','Remap '+name+' keyboard key');key.onclick=()=>{clearNativeInput();nativeBinding={bit};renderNativeBindings();};
    button.type='number';button.min='0';button.max='31';button.value=nativePreferences.buttons[bit];button.style.width='60px';button.setAttribute('aria-label',name+' controller button');
    button.onchange=()=>{const n=Number(button.value);if(!Number.isInteger(n)||n<0||n>31){renderNativeBindings();return;}const occupied=nativePreferences.buttons.indexOf(n),old=nativePreferences.buttons[bit];nativePreferences.buttons[bit]=n;if(occupied>=0&&occupied!==bit)nativePreferences.buttons[occupied]=old;saveNativePreferences();renderNativeBindings();};
    row.append(label,key,document.createTextNode(' Pad '),button);list.append(row);
  });
}
renderNativeBindings();
document.getElementById('native-game-settings').addEventListener('toggle',event=>{nativePanelPaused=event.target.open;clearNativeInput();nativeFastHeld=false;applyNativeOptions();});
for(const [id,property,type] of [['native-speed','speed','number'],['native-fast-speed','fastSpeed','number'],['native-mute','mute','boolean'],['native-blur-pause','pauseOnBlur','boolean']]){
  const field=document.getElementById(id);if(type==='boolean')field.checked=nativePreferences[property];else field.value=nativePreferences[property];
  field.addEventListener('change',()=>{nativePreferences[property]=type==='boolean'?field.checked:Number(field.value);if(property==='pauseOnBlur'&&!field.checked)nativeBlurPaused=false;saveNativePreferences();});
}
const fastKeyField=document.getElementById('native-fast-key');fastKeyField.value=nativePreferences.fastKey;
fastKeyField.addEventListener('keydown',event=>{event.preventDefault();event.stopPropagation();if(event.code==='Escape'){fastKeyField.blur();return;}if(!/^[A-Za-z][A-Za-z0-9]{0,30}$/.test(event.code)||Object.hasOwn(nativePreferences.keys,event.code)){document.getElementById('native-game-status').textContent='Choose a key that is not already a game control.';return;}nativePreferences.fastKey=event.code;fastKeyField.value=event.code;saveNativePreferences();fastKeyField.blur();});
document.getElementById('native-controls-reset').onclick=()=>{nativePreferences=BriskNativeControls.settings();saveNativePreferences();renderNativeBindings();for(const id of ['native-speed','native-fast-speed','native-mute','native-blur-pause']){const field=document.getElementById(id);const prop={'native-speed':'speed','native-fast-speed':'fastSpeed','native-mute':'mute','native-blur-pause':'pauseOnBlur'}[id];if(field.type==='checkbox')field.checked=nativePreferences[prop];else field.value=nativePreferences[prop];}fastKeyField.value=nativePreferences.fastKey;};
document.getElementById('native-game-pause').onclick=()=>{nativeUserPaused=!nativeUserPaused;document.getElementById('native-game-pause').textContent=nativeUserPaused?'Resume':'Pause';clearNativeInput();applyNativeOptions();};
document.getElementById('native-game-screenshot').onclick=()=>{const link=document.createElement('a');link.download='Brisk-Emerald-'+new Date().toISOString().replace(/[:.]/g,'-')+'.png';link.href=nativeCanvas.toDataURL('image/png');link.click();};
const updateMessage=document.getElementById('native-update-status');
async function refreshUpdateStatus(){
  if(!window.briskDexAPI?.updateStatus){for(const id of ['native-auto-updates','native-update-check'])document.getElementById(id).disabled=true;return;}
  try{const status=await window.briskDexAPI.updateStatus();document.getElementById('native-auto-updates').checked=status.automatic;document.getElementById('native-update-apply').disabled=!status.pending;document.getElementById('native-update-rollback').disabled=!status.canRollback;updateMessage.textContent=status.pending?'Update '+status.pending+' is ready. Save and stop the game before restarting.':'Installed version: '+status.current+(status.busy?' · Downloading update…':'');}catch(error){updateMessage.textContent=error.message;}
}
document.getElementById('native-update-check').onclick=async()=>{const button=document.getElementById('native-update-check');button.disabled=true;updateMessage.textContent='Checking and downloading updates…';try{const result=await window.briskDexAPI.checkForUpdates();await refreshUpdateStatus();updateMessage.textContent=result.message;}catch(error){updateMessage.textContent=error.message;}finally{button.disabled=false;}};
document.getElementById('native-auto-updates').onchange=event=>window.briskDexAPI?.automaticUpdates(event.target.checked).catch(error=>{updateMessage.textContent=error.message;});
for(const action of ['apply','rollback'])document.getElementById('native-update-'+action).onclick=async()=>{try{const result=await window.briskDexAPI[action==='apply'?'applyUpdate':'rollbackUpdate']();if(!result.ok)updateMessage.textContent=result.message;}catch(error){updateMessage.textContent=error.message;}};
refreshUpdateStatus();setInterval(()=>{if(currentMainTab==='game'&&document.getElementById('native-game-settings').open)refreshUpdateStatus();},10000);
window.briskDexAPI?.appReady?.().catch(console.warn);
