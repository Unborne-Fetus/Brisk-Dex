/* Adapt Dex public GitHub link importer.
 * Only publicly retrievable ROM files or compatible reference indexes.
 * Source-only repositories cannot be compiled in the browser.
 */
(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.AdaptGitHubSource=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
var ROM_LIMIT=128*1024*1024,JSON_LIMIT=20*1024*1024;
var ROM_EXT=/\.(?:gb|gbc|gba)$/i;
var INDEX_EXT=/\.json$/i;
function segment(s){
  return /^[a-zA-Z0-9_.-]+$/.test(s)&&s!=='.'&&s!=='..';
}
function parse(urlText){
  var url;
  try{url=new URL(String(urlText||'').trim());}
  catch(e){throw Error('Paste a full public GitHub URL starting with https://github.com/.');}
  if(url.protocol!=='https:'||url.username||url.password||url.port)
    throw Error('Only public HTTPS GitHub links are supported.');
  var host=url.hostname.toLowerCase(),parts=url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if(host==='raw.githubusercontent.com'){
    if(parts.length<4||!segment(parts[0])||!segment(parts[1])||!segment(parts[2]))
      throw Error('Invalid GitHub raw file URL.');
    return file(parts[0],parts[1],parts[2],parts.slice(3),false);
  }
  if(host!=='github.com')throw Error('Use a github.com or raw.githubusercontent.com link.');
  if(parts.length<2||!segment(parts[0])||!segment(parts[1]))
    throw Error('GitHub URL must include an owner and repository.');
  var owner=parts[0],repo=parts[1].replace(/\.git$/i,'');
  if(!segment(repo))throw Error('Invalid repository name.');
  if(parts.length===2)return {kind:'repository',owner:owner,repo:repo,ref:null};
  if(parts[2]==='tree'&&parts.length>=4&&segment(parts[3]))
    return {kind:'repository',owner:owner,repo:repo,ref:parts[3]};
  if((parts[2]==='blob'||parts[2]==='raw')&&parts.length>=5&&segment(parts[3]))
    return file(owner,repo,parts[3],parts.slice(4),false);
  if(parts[2]==='releases'&&parts[3]==='download'&&parts.length>=6)
    return file(owner,repo,parts[4],parts.slice(5),true);
  throw Error('Use a repository, a GitHub ROM/index file, or a release download link.');
}
function file(owner,repo,ref,pieces,isRelease){
  if(!pieces.length||pieces.some(x=>x==='..'||x==='.'||x.includes('\\')))
    throw Error('Invalid GitHub file path.');
  var name=pieces[pieces.length-1];
  var kind=ROM_EXT.test(name)?'rom':INDEX_EXT.test(name)?'index':null;
  if(!kind)throw Error('GitHub file must be .gb, .gbc, .gba, or a compatible .json index.');
  var encoded=pieces.map(encodeURIComponent).join('/');
  var href=isRelease?
    'https://github.com/'+encodeURIComponent(owner)+'/'+encodeURIComponent(repo)+'/releases/download/'+encodeURIComponent(ref)+'/'+encoded:
    'https://raw.githubusercontent.com/'+encodeURIComponent(owner)+'/'+encodeURIComponent(repo)+'/'+encodeURIComponent(ref)+'/'+encoded;
  return {kind:kind,owner:owner,repo:repo,ref:ref,url:href,name:name};
}
async function download(url,fetcher,limit){
  var response;
  try{response=await fetcher(url,{redirect:'follow',headers:{Accept:'application/octet-stream'}});}
  catch(e){throw Error('GitHub download failed (network or browser CORS). Try a raw file link or download the file manually.');}
  if(!response.ok)throw Error('GitHub returned HTTP '+response.status+' for the requested file.');
  var declared=Number(response.headers&&response.headers.get('content-length'));
  if(declared>limit)throw Error('GitHub file exceeds the '+Math.round(limit/(1024*1024))+' MiB limit.');
  if(response.body&&response.body.getReader){
    var reader=response.body.getReader(),chunks=[],length=0;
    while(true){
      var item=await reader.read();
      if(item.done)break;
      length+=item.value.byteLength;
      if(length>limit){await reader.cancel();throw Error('GitHub file exceeds the allowed size.');}
      chunks.push(item.value);
    }
    var out=new Uint8Array(length),pos=0;
    chunks.forEach(function(chunk){out.set(chunk,pos);pos+=chunk.byteLength;});
    return out;
  }
  var buf=await response.arrayBuffer();
  if(buf.byteLength>limit)throw Error('GitHub file exceeds the allowed size.');
  return new Uint8Array(buf);
}
function parseIndex(b){
  var raw;
  try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));}
  catch(e){throw Error('The GitHub JSON file is not a valid UTF-8 reference index.');}
  var data=raw&&raw.data&&typeof raw.data==='object'?raw.data:raw;
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Invalid game reference index.');
  var keys=['species','moves','abilities','items','trainerTeams','routeEncounters','mapCatalog'];
  if(!keys.some(k=>data[k]&&typeof data[k]==='object'&&Object.keys(data[k]).length))
    throw Error('No supported Pokémon game data found. Use a compatible Adapt Dex index or a ROM.');
  // Refuse prototype pollution keys before applying untrusted reference data.
  function clean(v,depth){
    if(depth>24)throw Error('Reference data is too deeply nested.');
    if(v===null||typeof v==='string'||typeof v==='number'||typeof v==='boolean')return v;
    if(Array.isArray(v))return v.map(x=>clean(x,depth+1));
    if(typeof v!=='object')return null;
    var result=Object.create(null);
    for(const k of Object.keys(v)){
      if(k==='__proto__'||k==='prototype'||k==='constructor')continue;
      result[k]=clean(v[k],depth+1);
    }
    return result;
  }
  var index=clean(data,0);
  return {data:index,assets:raw.assets&&typeof raw.assets==='object'?clean(raw.assets,0):null};
}
async function resolve(urlText,options){
  var fetcher=options&&options.fetch||((typeof fetch==='function')?fetch.bind(globalThis):null);
  if(!fetcher)throw Error('Network access is unavailable in this build.');
  var parsed=parse(urlText);
  if(parsed.kind==='repository'){
    var api='https://api.github.com/repos/'+encodeURIComponent(parsed.owner)+'/'+encodeURIComponent(parsed.repo);
    var branch=parsed.ref;
    if(!branch){
      var repoResponse=await fetcher(api,{headers:{Accept:'application/vnd.github+json'}});
      if(!repoResponse.ok)throw Error('Public GitHub repository not found (HTTP '+repoResponse.status+').');
      var info=await repoResponse.json();
      branch=info.default_branch;
      if(!branch||!segment(branch))throw Error('GitHub default branch could not be determined. Use a direct file link.');
    }
    var errors=[];
    var candidates=['adapt-dex-data.json','brisk-dex-data.json','adapt-dex-index.json','briskdex-rom-index.json'];
    for(const candidate of candidates){
      var parsedFile=file(parsed.owner,parsed.repo,branch,[candidate],false);
      try{
        var candidateBytes=await download(parsedFile.url,fetcher,JSON_LIMIT);
        var contents=parseIndex(candidateBytes);
        return {kind:'index',name:parsed.repo+' / '+candidate,sourceUrl:parsedFile.url,
          owner:parsed.owner,repo:parsed.repo,data:contents.data,assets:contents.assets};
      }catch(e){errors.push(String(e.message||e));}
    }
    // Some hack developers publish an already-built game in GitHub Releases.
    // ROM and data-index assets are not equivalent to a source-only project.
    var releaseUrl=api+'/releases/latest';
    var latest;
    try{
      var releasesResponse=await fetcher(releaseUrl,{headers:{Accept:'application/vnd.github+json'}});
      if(releasesResponse.ok)latest=await releasesResponse.json();
    }catch(e){}
    var assets=latest&&Array.isArray(latest.assets)?latest.assets:[];
    var romAssets=assets.filter(function(asset){
      return asset&&ROM_EXT.test(asset.name||'')&&asset.size>=0&&asset.size<=ROM_LIMIT
        &&typeof asset.browser_download_url==='string';
    });
    if(romAssets.length===1){
      var item=romAssets[0],downloadLink=parse(item.browser_download_url);
      if(downloadLink.kind==='rom'&&downloadLink.owner===parsed.owner&&downloadLink.repo===parsed.repo){
        try{
          var romBytes=await download(downloadLink.url,fetcher,ROM_LIMIT);
          if(romBytes.length<0x150)throw Error('The file is too small to be a ROM.');
          return {kind:'rom',name:item.name,sourceUrl:downloadLink.url,bytes:romBytes};
        }catch(err){
          throw Error('A ROM was found in GitHub Releases but the browser could not download it. Download the release file and choose it locally. Details: '+String(err.message||err));
        }
      }
    }
    if(romAssets.length>1)throw Error('This repository has multiple ROM release files. Paste the direct link to the version you want.');
    throw Error('This repository has no compatible Adapt Dex data index or single downloadable ROM release. If it contains only source or a patch, build/patch the game and select the resulting .gb, .gbc or .gba file.');
  }
  var limit=parsed.kind==='rom'?ROM_LIMIT:JSON_LIMIT;
  var bytes=await download(parsed.url,fetcher,limit);
  if(parsed.kind==='rom'){
    if(bytes.length<0x150)throw Error('GitHub ROM file is too small to be valid.');
    return {kind:'rom',name:parsed.name,sourceUrl:parsed.url,bytes:bytes};
  }
  var decoded=parseIndex(bytes);
  return {kind:'index',name:parsed.name,sourceUrl:parsed.url,
    owner:parsed.owner,repo:parsed.repo,data:decoded.data,assets:decoded.assets};
}
function referenceResult(res){
  if(!res||res.kind!=='index'||!res.data)throw Error('Not a GitHub reference index.');
  var d=res.data;
  var counts={
    species:Object.keys(d.species||{}).length,
    moves:Object.keys(d.moves||{}).length,
    abilities:Object.keys(d.abilities||{}).length,
    items:Object.keys(d.items||{}).length,
    trainers:Array.isArray(d.trainerTeams)?d.trainerTeams.length:0,
    routes:Array.isArray(d.routeEncounters)?d.routeEncounters.length:0,
    maps:Array.isArray(d.mapCatalog)?d.mapCatalog.length:0,
    icons:0
  };
  return {details:{title:res.repo||res.name,gameCode:'GITHUB',generation:null,
      platform:'GitHub reference index'},data:d,
    counts:counts,source:'github-reference-index',complete:false,
    icons:{},iconUrls:{},shinyIconUrls:{},saveSupport:'no-rom-no-edit',
    warnings:['Reference data only: a GitHub source index does not verify a ROM/save pairing. Load the matching game ROM before importing or editing a save.']};
}
return {parse:parse,resolve:resolve,referenceResult:referenceResult,parseIndex:parseIndex};
});