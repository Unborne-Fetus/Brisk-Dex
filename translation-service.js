const https=require('https');
const ALLOWED=new Set(['es','it','fr','ru','ja','zh-CN','ar']);
function getJson(url){return new Promise((resolve,reject)=>{const req=https.get(url,{headers:{'User-Agent':'BriskDex/1.0'}},res=>{let body='';res.on('data',c=>{body+=c;if(body.length>200000){req.destroy();reject(new Error('Translation response too large'));}});res.on('end',()=>{try{if(res.statusCode!==200)throw new Error('Translation service returned '+res.statusCode);resolve(JSON.parse(body));}catch(e){reject(e);}});});req.setTimeout(15000,()=>req.destroy(new Error('Translation timed out')));req.on('error',reject);});}
async function translateText(text,language){
 if(!ALLOWED.has(language))throw new Error('Unsupported language');
 if(typeof text!=='string'||text.length>12000)throw new Error('Invalid translation text');
 const pieces=text.match(/.{1,120}(?:\s|$)|.{1,120}/gs)||[text],translated=[];
 for(const part of pieces){const data=await getJson('https://api.mymemory.translated.net/get?q='+encodeURIComponent(part)+'&langpair=en%7C'+encodeURIComponent(language));if(Number(data.responseStatus)!==200||data.quotaFinished)throw new Error(data.responseDetails||'Translation service limit reached');translated.push(data.responseData.translatedText);}
 return translated.join(' ');
}
module.exports={translateText};
