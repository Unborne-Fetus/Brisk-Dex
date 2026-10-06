/* Translate every visible text node and UI attribute, retaining English originals.
   Game descriptions and dynamic messages use the same pipeline as navigation. */
(function(){
'use strict';
const supported=['en','es','it','fr','ru','ja','zh-CN','ar'];
let language='en',generation=0,timer,inFlight=0,pending=new Map(),active=new Map(),failed=new Set(),cache={};
const originals=new WeakMap(),attributes=new WeakMap();
try{cache=JSON.parse(localStorage.getItem('briskdex_translations')||'{}');}catch(_){}
const headers={
  'Settings':['Ajustes','Impostazioni','Paramètres','Настройки','設定','设置','الإعدادات'],
  'Language':['Idioma','Lingua','Langue','Язык','言語','语言','اللغة'],
  'Appearance':['Apariencia','Aspetto','Apparence','Оформление','外観','外观','المظهر'],
  'Zoom':['Zoom','Zoom','Zoom','Масштаб','ズーム','缩放','التكبير'],
  'Dark':['Oscuro','Scuro','Sombre','Тёмная','ダーク','深色','داكن'],
  'Light':['Claro','Chiaro','Clair','Светлая','ライト','浅色','فاتح'],
  'System':['Sistema','Sistema','Système','Системная','システム','跟随系统','النظام'],
  'Bag':['Bolsa','Borsa','Sac','Сумка','バッグ','背包','الحقيبة'],
  'External Item Storage':['Almacenamiento externo de objetos','Deposito esterno degli strumenti','Stockage externe des objets','Внешнее хранилище предметов','外部道具ストレージ','外部道具存储','التخزين الخارجي للأدوات'],
  'Items':['Objetos','Strumenti','Objets','Предметы','道具','道具','الأدوات'],
  'Moves':['Movimientos','Mosse','Capacités','Приёмы','技','招式','الحركات'],
  'Abilities':['Habilidades','Abilità','Talents','Способности','特性','特性','القدرات'],
  'Trainers':['Entrenadores','Allenatori','Dresseurs','Тренеры','トレーナー','训练家','المدربون'],
  'Guide':['Guía','Guida','Guide','Руководство','ガイド','指南','الدليل'],
  'Changes':['Cambios','Modifiche','Changements','Изменения','変更点','变更','التغييرات'],
  'Move':['Mover','Sposta','Déplacer','Переместить','移動','移动','نقل'],
  'Cancel':['Cancelar','Annulla','Annuler','Отмена','キャンセル','取消','إلغاء'],
  'Quantity':['Cantidad','Quantità','Quantité','Количество','数量','数量','الكمية'],
  'Saving…':['Guardando…','Salvataggio…','Enregistrement…','Сохранение…','保存中…','正在保存…','جارٍ الحفظ…'],
  'Saved automatically':['Guardado automáticamente','Salvato automaticamente','Enregistré automatiquement','Сохранено автоматически','自動保存しました','已自动保存','تم الحفظ تلقائيًا'],
  'Front':['Frente','Fronte','Face','Спереди','正面','正面','الأمام'],
  'Back':['Atrás','Retro','Dos','Сзади','背面','背面','الخلف'],
  'Base Stats':['Estadísticas base','Statistiche base','Statistiques de base','Базовые характеристики','種族値','种族值','الإحصائيات الأساسية']
};
function cached(text,lang){
 if(lang==='en')return text;
 if(headers[text])return headers[text][supported.indexOf(lang)-1];
 return cache[lang+'\n'+text];
}
function visible(el){return el && !el.closest('script,style,code,pre,[translate="no"],.online-code,#translation-status') && el.getClientRects().length && el.getBoundingClientRect().bottom>=0 && el.getBoundingClientRect().top<innerHeight;}
function eligible(text){return text.trim() && /[A-Za-z]/.test(text) && !/^https?:\/\//.test(text.trim());}
function status(message){const el=document.getElementById('translation-status');if(el)el.textContent=message;}
async function request(text,lang){
 if(window.briskDexAPI && window.briskDexAPI.translateText)return window.briskDexAPI.translateText(text,lang);
 const parts=text.match(/.{1,120}(?:\s|$)|.{1,120}/gs)||[text];let output=[];
 for(const part of parts){
  const response=await fetch('https://api.mymemory.translated.net/get?q='+encodeURIComponent(part)+'&langpair=en%7C'+encodeURIComponent(lang));
  if(!response.ok)throw new Error('Translation service unavailable');
  const result=await response.json();if(Number(result.responseStatus)!==200 || result.quotaFinished)throw new Error(result.responseDetails||'Translation service limit reached');
  output.push(result.responseData.translatedText);
 }
 return output.join(' ');
}
function enqueue(text,apply){
 const translated=cached(text,language);if(translated!==undefined){apply(translated);return;}
 const key=language+'\n'+text;if(failed.has(key))return;let entry=pending.get(key)||active.get(key);if(!entry){entry={text,lang:language,generation,callbacks:[]};pending.set(key,entry);}entry.callbacks.push(apply);pump();
}
function pump(){
 while(inFlight<2 && pending.size){
  const [key,entry]=pending.entries().next().value;pending.delete(key);active.set(key,entry);inFlight++;
  request(entry.text,entry.lang).then(value=>{
   if(!value || typeof value!=='string')throw new Error('Invalid translation response');
   const decoded=document.createElement('textarea');decoded.innerHTML=value;value=decoded.value;
   cache[key]=value;try{localStorage.setItem('briskdex_translations',JSON.stringify(cache));}catch(_){}
   if(entry.generation===generation){entry.callbacks.forEach(f=>f(value));status('');}
  }).catch(error=>{failed.add(key);if(entry.generation===generation)status('Translation paused: '+error.message+'. English text remains available.');})
   .finally(()=>{active.delete(key);inFlight--;pump();});
 }
}
function scan(){
 const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;
 while((node=walker.nextNode())){
  const el=node.parentElement;if(!visible(el))continue;
  let record=originals.get(node);
  if(!record || (node.nodeValue!==record.output && node.nodeValue!==record.source)){record={source:node.nodeValue,output:node.nodeValue};originals.set(node,record);}
  const current=node,version=generation;if(!eligible(record.source))continue;
  enqueue(record.source.trim(),text=>{if(version!==generation||!current.isConnected)return;record.output=record.source.match(/^\s*/)[0]+text+record.source.match(/\s*$/)[0];if(current.nodeValue!==record.output)current.nodeValue=record.output;});
 }
 document.querySelectorAll('[placeholder],[title],[aria-label]').forEach(el=>{
  if(!visible(el))return;let records=attributes.get(el)||{};attributes.set(el,records);
  ['placeholder','title','aria-label'].forEach(attr=>{const val=el.getAttribute(attr);if(!val)return;let r=records[attr];if(!r||(val!==r.output&&val!==r.source))r=records[attr]={source:val,output:val};const version=generation;if(eligible(r.source))enqueue(r.source,text=>{if(version===generation){r.output=text;if(el.getAttribute(attr)!==text)el.setAttribute(attr,text);}});});
 });
}
function schedule(){clearTimeout(timer);timer=setTimeout(scan,180);}
function setLanguage(lang){
 language=supported.includes(lang)?lang:'en';generation++;pending.clear();failed.clear();
 document.documentElement.lang=language;document.documentElement.dir=language==='ar'?'rtl':'ltr';
 const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while((n=walker.nextNode())){const r=originals.get(n);if(r){n.nodeValue=r.source;r.output=r.source;}}
 document.querySelectorAll('[placeholder],[title],[aria-label]').forEach(el=>{const records=attributes.get(el)||{};Object.entries(records).forEach(([attr,r])=>{el.setAttribute(attr,r.source);r.output=r.source;});});
 schedule();
}
window.BriskLocalization={setLanguage,scan,request,supported};
new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['placeholder','title','aria-label','style']});
addEventListener('scroll',schedule,true);addEventListener('resize',schedule);
})();
