import {assert,clone,integer} from './model.mjs';
// Native script DATA only: no eval, Function constructor or JavaScript imports.
export function compileScripts(source){
  const labels={};let current=null;
  for(const raw of source.split(/\r?\n/)){
    const line=raw.trim();const label=line.match(/^(\w+)::?$/);if(label){current=labels[label[1]]=[];continue;}
    if(current&&line&&!line.startsWith('//'))current.push(line.replace(/\s+\/\/.*$/,''));
  }
  return labels;
}
const IGNORE=new Set(['lock','lockall','release','releaseall','faceplayer','waitmessage','closemessage','waitbuttonpress','waitfanfare','waitse','nop']);
export function planScript(campaign,source,entry){
  const labels=compileScripts(source),draft=clone(campaign.snapshot()),messages=[],calls=[];let label=entry,index=0,steps=0,comparison=null;
  const itemIds=new Map(Object.entries(campaign.catalog.data.itemDetails).map(([id,item])=>[item.constant,Number(id)]));
  const value=token=>{token=String(token).trim();if(/^0x[0-9a-f]+$/i.test(token))return parseInt(token,16);if(/^\d+$/.test(token))return Number(token);if(token==='TRUE'||token==='YES')return 1;if(token==='FALSE'||token==='NO')return 0;if(/^VAR_/.test(token))return draft.vars?.[token]||0;throw new Error('Unresolved value '+token);};
  const text=target=>{
    assert(labels[target],'Missing text '+target);const lines=labels[target].filter(line=>line.startsWith('.string'));
    assert(lines.length,'Missing text '+target);
    return lines.map(line=>{const match=line.match(/^\.string\s+"(.*)"$/);assert(match,'Unsupported text');return match[1].replace(/\\[nl]/g,' ').replace(/\\p/g,'\n\n').replace(/\\"/g,'"').replace(/\$/g,'');}).join('').replaceAll('{PLAYER}',draft.trainer.name).replaceAll('{RIVAL}',draft.trainer.gender==='Female'?'Brendan':'May');
  };
  while(++steps<=256){
    assert(labels[label],'Unported script '+label);const line=labels[label][index++];assert(line!==undefined,'Script has no ending');const [opcode,...rest]=line.split(/\s+/),args=rest.join(' ').split(',').map(s=>s.trim());
    if(IGNORE.has(opcode))continue;
    if(['playse','playfanfare','delay'].includes(opcode))continue;
    if(opcode==='end')return {state:draft,messages,steps};
    if(opcode==='return'){if(!calls.length)return {state:draft,messages,steps};[label,index]=calls.pop();continue;}
    if(opcode==='goto'||opcode==='call'){if(opcode==='call')calls.push([label,index]);label=args[0];index=0;continue;}
    if(opcode==='goto_if_set'||opcode==='goto_if_unset'){const set=!!draft.flags[args[0]];if(set===(opcode==='goto_if_set')){label=args[1];index=0;}continue;}
    if(opcode==='setflag'||opcode==='clearflag'){assert(/^FLAG_\w+$/.test(args[0]),'Invalid flag');draft.flags[args[0]]=opcode==='setflag';continue;}
    if(['setvar','addvar','subvar','copyvar'].includes(opcode)){
      assert(/^VAR_\w+$/.test(args[0]),'Invalid variable');draft.vars??={};const v=value(args[1]),old=draft.vars[args[0]]||0;draft.vars[args[0]]=opcode==='addvar'?old+v:opcode==='subvar'?old-v:v;integer(draft.vars[args[0]],0,65535,'script variable');continue;
    }
    if(opcode==='compare'){comparison=value(args[0])-value(args[1]);continue;}
    if(['goto_if_eq','goto_if_ne','goto_if_lt','goto_if_gt','goto_if_le','goto_if_ge'].includes(opcode)){
      let target;if(args.length===3){comparison=value(args[0])-value(args[1]);target=args[2];}else target=args[0];assert(comparison!==null,'Comparison missing');const yes={goto_if_eq:comparison===0,goto_if_ne:comparison!==0,goto_if_lt:comparison<0,goto_if_gt:comparison>0,goto_if_le:comparison<=0,goto_if_ge:comparison>=0}[opcode];if(yes){label=target;index=0;}continue;
    }
    if(opcode==='msgbox'||opcode==='message'){
      assert(!args.includes('MSGBOX_YESNO'),'A choice is required; this event is not ported');messages.push(text(args[0]));continue;
    }
    if(opcode==='giveitem'){
      const id=itemIds.get(args[0]),count=args[1]?value(args[1]):1;assert(id,'Unknown reward item');integer(count,1,999,'reward quantity');const total=(draft.inventory[id]||0)+count;integer(total,0,999999,'bag capacity');draft.inventory[id]=total;messages.push(`Received ${campaign.catalog.data.items[id]} × ${count}!`);continue;
    }
    throw new Error('Unported command '+opcode);
  }
  throw new Error('Script exceeded the execution limit');
}
export function runScript(campaign,source,entry){
  const result=planScript(campaign,source,entry);
  // Validate the entire result before committing any reward, variable or story flag.
  const previous=campaign.state;try{campaign.state=result.state;campaign.validate();}catch(error){campaign.state=previous;throw error;}
  return result.messages;
}
