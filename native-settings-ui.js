'use strict';
const nativeUI=window.BriskNativeUI;
const nativeButtonNames=['A','B','Select','Start','Right','Left','Up','Down','R','L'];
function renderNativeBindings(){
  const list=document.getElementById('native-binding-list');list.replaceChildren();
  nativeButtonNames.forEach((name,bit)=>{
    const row=document.createElement('div'),label=document.createElement('span'),key=document.createElement('button'),button=document.createElement('input');
    label.textContent=name+' ';key.type='button';key.textContent=nativeUI.binding?.bit===bit?'Press a key…':Object.keys(nativeUI.preferences.keys).find(code=>nativeUI.preferences.keys[code]===bit);
    key.setAttribute('aria-label','Remap '+name+' keyboard key');key.onclick=()=>{nativeUI.clearInput();nativeUI.binding={bit};renderNativeBindings();};
    button.type='number';button.min='0';button.max='31';button.value=nativeUI.preferences.buttons[bit];button.style.width='60px';button.setAttribute('aria-label',name+' controller button');
    button.onchange=()=>{const n=Number(button.value);if(!Number.isInteger(n)||n<0||n>31){renderNativeBindings();return;}const occupied=nativeUI.preferences.buttons.indexOf(n),old=nativeUI.preferences.buttons[bit];nativeUI.preferences.buttons[bit]=n;if(occupied>=0&&occupied!==bit)nativeUI.preferences.buttons[occupied]=old;nativeUI.savePreferences();renderNativeBindings();};
    row.append(label,key,document.createTextNode(' Pad '),button);list.append(row);
  });
}
renderNativeBindings();
document.getElementById('native-game-settings').addEventListener('toggle',event=>{nativeUI.panelPaused=event.target.open;nativeUI.clearInput();nativeUI.fastHeld=false;nativeUI.applyOptions();});
for(const [id,property,type] of [['native-speed','speed','number'],['native-fast-speed','fastSpeed','number'],['native-mute','mute','boolean'],['native-blur-pause','pauseOnBlur','boolean']]){
  const field=document.getElementById(id);if(type==='boolean')field.checked=nativeUI.preferences[property];else field.value=nativeUI.preferences[property];
  field.addEventListener('change',()=>{nativeUI.preferences[property]=type==='boolean'?field.checked:Number(field.value);if(property==='pauseOnBlur'&&!field.checked)nativeUI.blurPaused=false;nativeUI.savePreferences();});
}
const fastKeyField=document.getElementById('native-fast-key');fastKeyField.value=nativeUI.preferences.fastKey;
fastKeyField.addEventListener('keydown',event=>{event.preventDefault();event.stopPropagation();if(event.code==='Escape'){fastKeyField.blur();return;}if(!/^[A-Za-z][A-Za-z0-9]{0,30}$/.test(event.code)||Object.hasOwn(nativeUI.preferences.keys,event.code)){document.getElementById('native-game-status').textContent='Choose a key that is not already a game control.';return;}nativeUI.preferences.fastKey=event.code;fastKeyField.value=event.code;nativeUI.savePreferences();fastKeyField.blur();});
document.getElementById('native-controls-reset').onclick=()=>{nativeUI.preferences=BriskNativeControls.settings();nativeUI.savePreferences();renderNativeBindings();for(const id of ['native-speed','native-fast-speed','native-mute','native-blur-pause']){const field=document.getElementById(id);const prop={'native-speed':'speed','native-fast-speed':'fastSpeed','native-mute':'mute','native-blur-pause':'pauseOnBlur'}[id];if(field.type==='checkbox')field.checked=nativeUI.preferences[prop];else field.value=nativeUI.preferences[prop];}fastKeyField.value=nativeUI.preferences.fastKey;};
document.getElementById('native-game-pause').onclick=()=>{nativeUI.userPaused=!nativeUI.userPaused;document.getElementById('native-game-pause').textContent=nativeUI.userPaused?'Resume':'Pause';nativeUI.clearInput();nativeUI.applyOptions();};
document.getElementById('native-game-screenshot').onclick=()=>{const link=document.createElement('a');link.download='Brisk-Emerald-'+new Date().toISOString().replace(/[:.]/g,'-')+'.png';link.href=nativeUI.canvas.toDataURL('image/png');link.click();};
document.getElementById('native-game-diagnostics').onclick=async()=>{
  const status=document.getElementById('native-game-status');
  try{
    const result=await window.briskDexAPI?.exportNativeDiagnostics?.();
    if(!result?.ok){status.textContent=result?.error||'Diagnostics are available in the desktop application.';return;}
    const file=new Blob([JSON.stringify(result.diagnostic,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(file),link=document.createElement('a');
    link.href=url;link.download='brisk-native-diagnostics.json';link.click();
    setTimeout(()=>URL.revokeObjectURL(url),3000);
    status.textContent='Native diagnostic exported. No save or Pokémon data is included.';
  }catch(error){status.textContent='Unable to export diagnostics: '+error.message;}
};
const updateMessage=document.getElementById('native-update-status');
async function refreshUpdateStatus(){
  if(!window.briskDexAPI?.updateStatus){for(const id of ['native-auto-updates','native-update-check'])document.getElementById(id).disabled=true;return;}
  try{const status=await window.briskDexAPI.updateStatus();document.getElementById('native-auto-updates').checked=status.automatic;document.getElementById('native-update-apply').disabled=!status.pending;document.getElementById('native-update-rollback').disabled=!status.canRollback;updateMessage.textContent=status.pending?'Update '+status.pending+' is downloaded. It will install automatically next time you open the app. Save your game before closing.':'Installed version: '+status.current+(status.busy?' · Downloading update…':'');}catch(error){updateMessage.textContent=error.message;}
}
document.getElementById('native-update-check').onclick=async()=>{const button=document.getElementById('native-update-check');button.disabled=true;updateMessage.textContent='Checking and downloading updates…';try{const result=await window.briskDexAPI.checkForUpdates();await refreshUpdateStatus();updateMessage.textContent=result.message;}catch(error){updateMessage.textContent=error.message;}finally{button.disabled=false;}};
document.getElementById('native-auto-updates').onchange=event=>window.briskDexAPI?.automaticUpdates(event.target.checked).catch(error=>{updateMessage.textContent=error.message;});
for(const action of ['apply','rollback'])document.getElementById('native-update-'+action).onclick=async()=>{try{const result=await window.briskDexAPI[action==='apply'?'applyUpdate':'rollbackUpdate']();if(!result.ok)updateMessage.textContent=result.message;}catch(error){updateMessage.textContent=error.message;}};
refreshUpdateStatus();setInterval(()=>{if(nativeUI.tab==='game'&&document.getElementById('native-game-settings').open)refreshUpdateStatus();},10000);
window.briskDexAPI?.appReady?.().catch(console.warn);
