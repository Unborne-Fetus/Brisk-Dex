"""Export source-only opening, object identities and field restrictions."""
import json,re,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1];source=Path(sys.argv[1]);maps={}
for p in sorted((source/'data/maps').glob('*/map.json')):
 m=json.loads(p.read_text());maps[m['id'].lower()]={'localIds':{o['local_id']:i for i,o in enumerate(m.get('object_events',[]),1) if o.get('local_id')},'trainers':{o.get('local_id',str(i)):{'range':int(o.get('trainer_sight_or_berry_tree_id','0'))} for i,o in enumerate(m.get('object_events',[]),1) if o.get('trainer_type')=='TRAINER_TYPE_NORMAL' and str(o.get('trainer_sight_or_berry_tree_id','0')).isdigit()},'requiresFlash':m.get('requires_flash',False),'allowEscaping':m.get('allow_escaping',False),'warpEvents':m.get('warp_events',[])}
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
result={'healLocations':{h['id']:{'map':h['map'].lower(),'x':h['x'],'y':h['y']} for h in heals},'schema':1,'maps':maps,'starters':starters,'speech':speech}
(root/'game/story-data.json').write_text(json.dumps(result,separators=(',',':'))+'\n');print('Exported',len(maps),'maps and',len(starters),'Brisk starters')
