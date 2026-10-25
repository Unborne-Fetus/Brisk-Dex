export function dialoguePages(text,widths={},maxWidth=208){
 const measure=s=>[...s].reduce((n,c)=>n+(widths[c]??6),0),pages=[];
 for(const paragraph of String(text).split('\f')){
  const lines=[];
  for(const raw of paragraph.split('\n')){
   let line='';for(const word of raw.split(/\s+/).filter(Boolean)){if(line&&measure(line+' '+word)>maxWidth){lines.push(line);line='';}if(measure(word)>maxWidth){for(const c of word){if(measure(line+c)>maxWidth){lines.push(line);line='';}line+=c;}}else line+=(line?' ':'')+word;}lines.push(line);
  }
  for(let i=0;i<lines.length;i+=2)pages.push(lines.slice(i,i+2).join('\n'));
 }
 return pages.length?pages:[''];
}
export function battleEnvironment(campaign){
 const type=campaign.mapInfo.mapType,behavior=campaign.behavior(campaign.state.position.x,campaign.state.position.y);
 return type==='MAP_TYPE_UNDERWATER'?'underwater':campaign.mode==='surf'?'water':['MAP_TYPE_CAVE','MAP_TYPE_UNDERGROUND'].includes(type)?'cave':!campaign.map.outdoor?'building':campaign.map.weather==='snow'?'snow':/LONG_GRASS/.test(behavior)?'long_grass':/SAND/.test(behavior)?'sand':/ROCK/.test(behavior)?'rock':'tall_grass';
}
