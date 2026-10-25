"""Export source-only opening, object identities and field restrictions."""
import json,re,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1];source=Path(sys.argv[1]);maps={}
for p in sorted((source/'data/maps').glob('*/map.json')):
 m=json.loads(p.read_text());maps[m['id'].lower()]={'localIds':{o['local_id']:i for i,o in enumerate(m.get('object_events',[]),1) if o.get('local_id')},'objectGraphics':{o.get('local_id',str(i)):o.get('graphics_id') for i,o in enumerate(m.get('object_events',[]),1)},'trainers':{o.get('local_id',str(i)):{'range':int(o.get('trainer_sight_or_berry_tree_id','0'))} for i,o in enumerate(m.get('object_events',[]),1) if o.get('trainer_type')=='TRAINER_TYPE_NORMAL' and str(o.get('trainer_sight_or_berry_tree_id','0')).isdigit()},'requiresFlash':m.get('requires_flash',False),'allowEscaping':m.get('allow_escaping',False),'warpEvents':m.get('warp_events',[])}
layouts={l['id']:l for l in json.loads((source/'data/layouts/layouts.json').read_text())['layouts']}
for p in sorted((source/'data/maps').glob('*/map.json')):
 m=json.loads(p.read_text());layout=layouts.get(m['layout'])
 if layout:maps[m['id'].lower()]['coordEvents']=[{**e,'x':min(e['x'],layout['width']-1),'y':min(e['y'],layout['height']-1)} for e in m.get('coord_events',[]) if e.get('type')=='trigger']
text=(source/'src/ui_birch_case.c').read_text();starters=re.findall(r'^\s*\[BALL_\w+\]\s*=\s*RANDOM_STARTER\(SPECIES_(\w+)\)',text,re.M)
strings=(source/'src/strings.c').read_text();speech={}
for name,body in re.findall(r'const u8 (gText_Birch\w*|gText_ThisIsAPokemon)\[\]\s*=\s*_\((.*?)\);',strings,re.S):speech[name]=''.join(re.findall(r'"((?:[^"\\]|\\.)*)"',body))
birch=(source/'data/text/birch_speech.inc').read_text()
for name,body in re.findall(r'^(gText_\w+)::?\s*\n(.*?)(?=^\w+::?|\Z)',birch,re.M|re.S):speech[name]=''.join(re.findall(r'\.string\s+"(.*)"',body))
heals=json.loads((source/'src/data/heal_locations.json').read_text())['heal_locations']
from source_save_constants import save_constants
def layout_for(constants):
 flag_bytes=(constants['FLAGS_COUNT']+7)//8
 return {'flagsOffset':0x1270,'flagBytes':flag_bytes,'varsOffset':(0x1270+flag_bytes+1)&~1,'varsStart':constants['VARS_START'],'varsCount':constants['VARS_COUNT'],'trainerFlagsStart':constants['TRAINER_FLAGS_START'],'flags':{k:v for k,v in constants.items() if k.startswith('FLAG_') and 0<v<constants['FLAGS_COUNT']},'vars':{k:v for k,v in constants.items() if k.startswith('VAR_') and constants['VARS_START']<=v<=constants['VARS_END']},'trainers':{k:v for k,v in constants.items() if k.startswith('TRAINER_') and 0<v<constants['MAX_TRAINERS_COUNT']}}
save_layout=layout_for(save_constants(source));legacy_layout=layout_for(save_constants(source,864))
script_constants=json.loads((root/'game/script-data.json').read_text())['constants'];content=json.loads((root/'game/content.json').read_text());sprites={}
for map_ in content['maps'].values():
 for event in map_.get('events',[]):
  sprite=event.get('sprite')
  if not sprite:continue
  key=Path(sprite['path']).stem.upper();id=script_constants.get(key)
  if id is not None:sprites[str(id)]=sprite
menu_source=(source/'src/data/script_menu.h').read_text();text_values={**json.loads((root/'game/script-data.json').read_text())['text'],**{n:b for n,b in re.findall(r'const u8 (\w+)\[\]\s*=\s*_\("([^"]*)"\)',menu_source)}};lists={}
for name,body in re.findall(r'(MultichoiceList_\w+)\[\]\s*=\s*\{(.*?)\};',menu_source,re.S):
 options=[]
 for literal,key in re.findall(r'\{\s*(?:COMPOUND_STRING\("([^"]*)"\)|(g\w+))\s*\}',body):options.append(literal or text_values.get(key,key.removeprefix('gText_')))
 if options:lists[name]=options
menus={id:lists[name] for id,name in re.findall(r'\[(MULTI_\w+)\]\s*=\s*MULTICHOICE\((\w+)\)',menu_source) if name in lists}
result={'saveLayouts':{'14':legacy_layout,'20':save_layout},'menus':menus,'objectSprites':sprites,'saveLayout':save_layout,'healLocations':{h['id']:{'map':h['map'].lower(),'x':h['x'],'y':h['y']} for h in heals},'schema':1,'maps':maps,'starters':starters,'speech':speech}
(root/'game/story-data.json').write_text(json.dumps(result,separators=(',',':'))+'\n');print('Exported',len(maps),'maps and',len(starters),'Brisk starters')
