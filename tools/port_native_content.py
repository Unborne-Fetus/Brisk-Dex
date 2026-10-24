#!/usr/bin/env python3
"""Build an Emerald-format source map/data port from a LOCAL Brisk source checkout.
Native cutscenes remain explicitly unresolved; no source scripts are evaluated.
"""
import argparse,json,re,struct,subprocess,sys
from pathlib import Path
from PIL import Image
from extract_data import extract_blocks,find_source,read_jasc_palette,parse_enums,add_invoked_species_macros,extract_macro_definitions

def build(repo,out):
    repo=Path(repo).resolve();out=Path(out).resolve();assets=out/'assets';assets.mkdir(exist_ok=True)
    root=out.parent;catalog=json.loads((root/'brisk-dex-data.json').read_text());species={s['constant']:int(i) for i,s in catalog['species'].items()};moves={m['constant']:int(i) for i,m in catalog['moveDetails'].items()};items={m['constant']:int(i) for i,m in catalog['itemDetails'].items()}
    items.update({'ITEM_'+name:id for name,id in parse_enums((repo/'include/constants/items.h').read_text(),'ITEM_').items() if name not in ['FIELD_ARROW','LIST_END']})
    from source_script_data import script_data
    script_export=script_data(repo,catalog,json.loads((root/'brisk-dex-trainer-teams.json').read_text())['trainers']);(out/'script-data.json').write_text(json.dumps(script_export,separators=(',',':'))+'\n')
    sha=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip();report={'source':sha,'maps':[],'unresolvedEvents':[],'externalWarps':[],'missingLearnsets':[]}
    species_text=find_source(repo,'src/data/pokemon/species_info.h','src/data/pokemon/species_info');blocks=extract_blocks(species_text,'SPECIES_')
    macros=extract_macro_definitions(species_text)
    tables={};learn_text=(repo/'src/data/pokemon/level_up_learnsets/gen_9.h').read_text()
    for f in (repo/'src/data/pokemon').glob('*learnsets.h'):learn_text+='\n'+f.read_text()
    for name,body in re.findall(r'(\w+)\[\]\s*=\s*\{(.*?)\};',learn_text,re.S):tables[name]=[{'level':int(level),'move':moves[move]} for level,move in re.findall(r'LEVEL_UP_MOVE\(\s*(\d+)\s*,\s*(MOVE_\w+)\s*\)',body) if move in moves and catalog['moveDetails'][str(moves[move])].get('pp',0)>0]
    aliases=dict(re.findall(r'#define\s+(s\w+LevelUpLearnset)\s+(s\w+LevelUpLearnset)',learn_text))
    for _ in range(10):
        for a,b in aliases.items():
            if b in tables:tables[a]=tables[b]
    form_tables=dict(re.findall(r'(s\w+)\[\]\s*=\s*\{(.*?)\};',(repo/'src/data/pokemon/form_change_tables.h').read_text(),re.S))
    native={'format':'brisk-native-catalog','schema':1,'source':sha,'species':{},'items':{},'extraItems':{}}
    for const,id in species.items():
        block=add_invoked_species_macros(blocks.get(const,''),macros);pointer=re.search(r'\.levelUpLearnset\s*=\s*(\w+)',block);learn=tables.get(pointer[1],[]) if pointer else []
        if not learn:report['missingLearnsets'].append(const)
        def number(field,default):
            match=re.search(r'\.'+field+r'\s*=\s*([^,\n]+)',block)
            if not match:return default
            expression=match[1];n=re.search(r'\?\s*(\d+)',expression) or re.match(r'\s*(\d+)\s*$',expression)
            return int(n[1]) if n else default
        native['species'][id]={'learnset':learn,'catchRate':number('catchRate',45),'expYield':number('expYield',60),'evYield':[number('evYield_'+stat,0) for stat in ['HP','Attack','Defense','Speed','SpAttack','SpDefense']]}
        form_pointer=re.search(r'\.formChangeTable\s*=\s*(\w+)',block);body=form_tables.get(form_pointer[1],'') if form_pointer else ''
        native['species'][id]['megaItems']=[{'species':species[target],'item':items[item]} for target,item in re.findall(r'FORM_CHANGE_BATTLE_MEGA_EVOLUTION_ITEM,\s*SPECIES_(\w+),\s*(ITEM_\w+)',body) if target in species and item in items]
    item_text=(repo/'src/data/items.h').read_text()
    for filename in re.findall(r'#include \"([^\"]+)\"',item_text):
        file=repo/'src/data'/filename
        if file.exists():item_text+='\n'+file.read_text()
    for const,block in extract_blocks(item_text,'ITEM_').items():
        if 'ITEM_'+const not in items:continue
        if str(items['ITEM_'+const]) not in catalog['items']:
            name=re.search(r'\.name\s*=\s*ITEM_NAME\("([^"]+)"\)',block)
            if name:native['extraItems'][items['ITEM_'+const]]={'name':name[1],'constant':'ITEM_'+const}
        match=re.search(r'\.price\s*=\s*(\d+|[^,\n]+\?\s*\d+)',block)
        if match:
            price=int(re.search(r'\?\s*(\d+)',match[1])[1]) if '?' in match[1] else int(match[1]);native['items'][items['ITEM_'+const]]={'price':price}
    (out/'native-catalog.json').write_text(json.dumps(native,separators=(',',':'))+'\n')
    # Resolve actual source tileset paths through symbol references.
    headers=(repo/'src/data/tilesets/headers.h').read_text();graphics=(repo/'src/data/tilesets/graphics.h').read_text()+'\n'+(repo/'src/graphics.c').read_text();metatiles=(repo/'src/data/tilesets/metatiles.h').read_text()
    tilesets={};tilecache={}
    def tileset(symbol):
        if symbol in tilesets:return tilesets[symbol]
        body=re.search(r'\b'+symbol+r'\s*=\s*\{(.*?)\};',headers,re.S)[1]
        def field(name):return re.search(r'\.'+name+r'\s*=\s*(\w+)',body)[1]
        def filepath(text,name):return re.search(r'\b'+name+r'\[\](?:\[16\])?\s*=\s*INC\w+\("([^"]+)"',text)[1]
        image=Image.open(repo/filepath(graphics,field('tiles')));directory=(repo/filepath(metatiles,field('metatiles'))).parent
        pals=[]
        for i in range(16):
            p=directory/'palettes'/f'{i:02}.pal';pals.append(read_jasc_palette(str(p)) if p.exists() else [(0,0,0)]*16)
        bank={'image':image,'dir':directory,'pals':pals,'metatiles':struct.unpack('<'+'H'*(len((directory/'metatiles.bin').read_bytes())//2),(directory/'metatiles.bin').read_bytes()),'attrs':struct.unpack('<'+'H'*(len((directory/'metatile_attributes.bin').read_bytes())//2),(directory/'metatile_attributes.bin').read_bytes())};tilesets[symbol]=bank;return bank
    def tile(entry,primary,secondary):
        key=(str(primary['dir']),str(secondary['dir']),entry)
        if key in tilecache:return tilecache[key]
        idx=entry&1023;bank=primary if idx<512 else secondary;idx=idx if idx<512 else idx-512;sheet=bank['image'];colors=(primary if entry>>12<6 else secondary)['pals'][entry>>12]
        canvas=Image.new('RGBA',(8,8));pixels=sheet.crop(((idx%16)*8,(idx//16)*8,(idx%16)*8+8,(idx//16)*8+8))
        if sheet.mode!='P':raise ValueError('Source tiles must be indexed PNG')
        canvas.putdata([(*colors[pixel],255) if pixel else (0,0,0,0) for pixel in pixels.getdata()]);
        if entry&1024:canvas=canvas.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        if entry&2048:canvas=canvas.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
        tilecache[key]=canvas;return canvas
    atlas_cache={}
    def atlas(primary,secondary,slug):
        key=(str(primary['dir']),str(secondary['dir']))
        if key in atlas_cache:return atlas_cache[key]
        ground=Image.new('RGBA',(512,512));top=Image.new('RGBA',(512,512));info={}
        for index in range(1024):
            bank=primary if index<512 else secondary;local=index if index<512 else index-512
            entries=bank['metatiles'][local*12:local*12+12]
            if len(entries)!=12 or local>=len(bank['attrs']):continue
            info[index]=behaviors.get(bank['attrs'][local]&255,'MB_NORMAL')
            for layer in range(3):
                for q in range(4):
                    (top if layer==2 else ground).alpha_composite(tile(entries[layer*4+q],primary,secondary),((index%32)*16+(q%2)*8,(index//32)*16+(q//2)*8))
        paths={'ground':f'assets/{slug}-atlas-ground.png','foreground':f'assets/{slug}-atlas-top.png','behaviors':info}
        ground.save(out/paths['ground']);top.save(out/paths['foreground']);atlas_cache[key]=paths;return paths
    layouts={l['id']:l for l in json.loads((repo/'data/layouts/layouts.json').read_text())['layouts']};map_names=sorted(p.parent.name for p in (repo/'data/maps').glob('*/map.json'));raw={n:json.loads((repo/'data/maps'/n/'map.json').read_text()) for n in map_names};byid={m['id']:name for name,m in raw.items()}
    behavior_text=(repo/'include/constants/metatile_behaviors.h').read_text();behaviors={};index=0
    for name,value in re.findall(r'^\s*(MB_\w+)(?:\s*=\s*(0x[0-9a-fA-F]+|\d+))?\s*,',behavior_text,re.M):
        if value:index=int(value,0)
        behaviors[index]=name;index+=1
    # Source object graphics, cropped with the exact source palette.
    objinfo=(repo/'src/data/object_events/object_event_graphics_info.h').read_text();pointers=(repo/'src/data/object_events/object_event_graphics_info_pointers.h').read_text();pics=(repo/'src/data/object_events/object_event_pic_tables.h').read_text();objgraphics=(repo/'src/data/object_events/object_event_graphics.h').read_text();sprites={}
    def objsprite(gfx):
        if gfx in sprites:return sprites[gfx]
        try:
            symbol=re.search(r'\['+re.escape(gfx)+r'\]\s*=\s*&(\w+)',pointers)[1];body=re.search(r'\b'+symbol+r'\s*=\s*\{(.*?)\};',objinfo,re.S)[1]
            width=int(re.search(r'\.width\s*=\s*(\d+)',body)[1]);height=int(re.search(r'\.height\s*=\s*(\d+)',body)[1]);pic=re.search(r'\.images\s*=\s*(\w+)',body)[1];frame=re.search(r'\b'+pic+r'\[\]\s*=\s*\{(.*?)\};',pics,re.S)[1];graphic=re.search(r'(gObjectEventPic_\w+)',frame)[1];filename=re.search(r'\b'+graphic+r'\[\]\s*=\s*INC\w+\("([^"]+)"',objgraphics)[1].replace('.4bpp','.png')
            palette=re.search(r'\.paletteTag\s*=\s*OBJ_EVENT_PAL_TAG_(\w+)',body)[1].lower();pal=repo/'graphics/object_events/palettes'/f'{palette}.pal';image=Image.open(repo/filename)
            if pal.exists() and image.mode=='P':
                colors=read_jasc_palette(str(pal));rgba=Image.new('RGBA',image.size);rgba.putdata([(*colors[v],255) if v else (0,0,0,0) for v in image.getdata()]);image=rgba
            else:image=image.convert('RGBA')
            filename='assets/'+gfx.lower()+'.png';image.save(out/filename);result={'path':filename,'width':width,'height':height,'frames':image.width//width};sprites[gfx]=result;return result
        except (TypeError,AttributeError,FileNotFoundError):sprites[gfx]=None;return None
    hero=objsprite('OBJ_EVENT_GFX_BRENDAN_NORMAL');female=objsprite('OBJ_EVENT_GFX_MAY_NORMAL')
    trainers={t['constant']:t for t in json.loads((root/'brisk-dex-trainer-teams.json').read_text())['trainers']};route_tables={r['id']:r for r in catalog['routeEncounters']};world={}
    def textlabel(script,label):
        match=re.search(r'^'+re.escape(label)+r'::?\s*\n(.*?)(?=^\w+::?|\Z)',script,re.S|re.M)
        if not match:return ''
        values=re.findall(r'\.string\s+"(.*)"',match[1]);text=''.join(values).replace('\\n',' ').replace('\\l',' ').replace('\\p','\n\n').replace('$','').replace('{PLAYER}','Trainer').replace('{RIVAL}','your rival')
        return text
    for name,map_ in raw.items():
        if map_['layout'] not in layouts:
            report.setdefault('unresolvedMaps',[]).append({'map':name,'reason':'dynamic layout'});continue
        if layouts[map_['layout']].get('layout_version','emerald')!='emerald':
            report.setdefault('unresolvedMaps',[]).append({'map':name,'reason':'FRLG layout format'});continue
        layout=layouts[map_['layout']];w,h=layout['width'],layout['height'];primary,secondary=tileset(layout['primary_tileset']),tileset(layout['secondary_tileset']);buf=(repo/layout['blockdata_filepath']).read_bytes();cells=struct.unpack('<'+'H'*(len(buf)//2),buf);ground=Image.new('RGBA',(w*16,h*16),(*primary['pals'][0][0],255));foreground=Image.new('RGBA',ground.size);rows=[];jumps={};counters=[];elevations=[];behavior_rows=[]
        for y in range(h):
            row='';elevation_row=[];behavior_row=[]
            for x in range(w):
                value=cells[y*w+x];idx=value&1023;bank=primary if idx<512 else secondary;local=idx if idx<512 else idx-512;behavior=behaviors.get(bank['attrs'][local]&255,'MB_NORMAL');entries=bank['metatiles'][local*12:local*12+12]
                for layer in range(3):
                    for q in range(4):
                        image=tile(entries[layer*4+q],primary,secondary);(foreground if layer==2 else ground).alpha_composite(image,(x*16+(q%2)*8,y*16+(q//2)*8))
                surf=any(v in behavior for v in ['WATER','POND','OCEAN','WATERFALL']) and 'SHALLOW' not in behavior
                char='~' if surf else '#' if value&0xc00 else 'g' if behavior in ['MB_TALL_GRASS','MB_LONG_GRASS','MB_LONG_GRASS_SOUTH_EDGE'] else '.'
                if behavior=='MB_COUNTER':counters.append(f'{x},{y}')
                if behavior.startswith('MB_JUMP_'):jumps[f'{x},{y}']=behavior.replace('MB_JUMP_','').lower()
                elevation_row.append(value>>12);behavior_row.append(behavior);row+=char
            rows.append(row);elevations.append(elevation_row);behavior_rows.append(behavior_row)
        slug=map_['id'].lower();ground.save(assets/f'{slug}-ground.png');foreground.save(assets/f'{slug}-top.png');script_file=repo/'data/maps'/name/'scripts.inc';script=script_file.read_text() if script_file.exists() else ''; events=[];outdoor=map_['map_type'] in ['MAP_TYPE_TOWN','MAP_TYPE_CITY','MAP_TYPE_ROUTE','MAP_TYPE_OCEAN_ROUTE']
        for object_index,obj in enumerate(map_.get('object_events',[])+map_.get('bg_events',[]),1):
            x,y=obj.get('x',0),obj.get('y',0)
            if not(0<=x<w and 0<=y<h):continue
            label=obj.get('script','');match=re.search(r'^'+re.escape(label)+r'::?\s*\n(.*?)(?=^\w+::?|\Z)',script,re.S|re.M);body=match[1] if match else ''
            event={'kind':'dialogue','x':x,'y':y,'sourceScript':label,'solid':'graphics_id' in obj,'hideFlag':obj.get('flag','0'),'localId':obj.get('local_id',str(object_index)) if 'graphics_id' in obj else None,'elevation':obj.get('elevation',0),'movementType':obj.get('movement_type')};visual=objsprite(obj.get('graphics_id',''))
            if visual:event['sprite']=visual
            if 'NURSE' in obj.get('graphics_id','') or 'PokemonCenter' in name and 'Nurse' in label or 'Bench' in label:event.update(kind='heal',text='Your Pokémon are fully healed. HP, PP and status have been restored.')
            else:
                battle=re.search(r'trainerbattle_(?:single|double)\s+(TRAINER_\w+)',body)
                if battle and battle[1] in trainers and trainers[battle[1]]['party']:
                    t=trainers[battle[1]];event.update(kind='trainer',id=battle[1],trainerName=t['name'],team=t['party'],species='ZIGZAGOON',level=3,text=' '.join(filter(None,[textlabel(script,v) for v in re.findall(r'(\w+_Text_\w+)',body)[:1]])) or 'Let’s battle!')
                elif 'pokemart' in body:
                    stocks=re.findall(r'\.2byte\s+(ITEM_\w+)',script);stock=[]
                    for const in dict.fromkeys(stocks):
                        id=items.get(const)
                        if id and id in native['items']:stock.append({'item':id,'price':native['items'][id]['price']})
                    if stock:event.update(kind='shop',stock=stock,text='Welcome! What can I get for you?')
                if event['kind']=='dialogue':
                    labels=re.findall(r'msgbox\s+(\w+)',body);text=textlabel(script,labels[0]) if labels else ''
                    event['text']=text or ("It's rude to read people's mail." if 'Mailbox' in label else 'This story interaction has not been ported yet.')
                    if not text or re.search(r'\b(?:goto_if|switch|compare|giveitem|givemon|special|setflag|setvar|call)\b',body):event['unresolved']=True;report['unresolvedEvents'].append({'map':map_['id'],'script':label})
            if event['kind']=='trainer' and any(re.sub(r'\s*\([MF]\)$','',member['species'],flags=re.I).lower()=='mothim' for member in event['team']):
                event.update(kind='dialogue',unresolved=True,text='This trainer uses Mothim, whose species record is missing from the current Dex catalog. This battle awaits that data port.');event['unportedTeam']=event.pop('team');report['unresolvedEvents'].append({'map':map_['id'],'script':label,'reason':'Mothim catalog record missing'})
            events.append(event)
        for warp in map_.get('warp_events',[]):
            x,y=warp['x'],warp['y'];destination=byid.get(warp['dest_map']);target=raw[destination]['warp_events'][int(warp['dest_warp_id'])] if destination and str(warp['dest_warp_id']).isdigit() and int(warp['dest_warp_id'])<len(raw[destination].get('warp_events',[])) else None
            if target and 0<=x<w and 0<=y<h and 0<=target['x']<layouts[raw[destination]['layout']]['width'] and 0<=target['y']<layouts[raw[destination]['layout']]['height']:
                events.append({'kind':'warp','x':x,'y':y,'map':warp['dest_map'].lower(),'toX':target['x'],'toY':target['y']});rows[y]=rows[y][:x]+'d'+rows[y][x+1:]
            else:report['externalWarps'].append({'map':map_['id'],'destination':warp['dest_map']})
        encounters=[];rate=0
        for method in route_tables.get(map_['id'],{}).get('methods',[]):
            if method['type']=='land_mons':
                rate=method.get('encounterRate',20)
                for slot in method['slots']:
                    s=catalog['species'].get(str(slot['species']))
                    if s:encounters.append({'species':s['constant'],'min':slot['minLevel'],'max':slot['maxLevel'],'weight':max(1,round(slot.get('chance',1)*100))})
        weather=map_.get('weather','WEATHER_SUNNY');natural={'WEATHER_RAIN':'rain','WEATHER_DOWNPOUR':'rain','WEATHER_SANDSTORM':'sand','WEATHER_DROUGHT':'sun','WEATHER_SNOW':'snow','WEATHER_FOG_HORIZONTAL':'fog','WEATHER_FOG_DIAGONAL':'fog'}
        world[slug]={'id':slug,'name':re.sub(r'(?<=[a-z])(?=[A-Z])',' ',name).replace('_',' '),'width':w,'height':h,'outdoor':outdoor,'weather':natural.get(weather,'clear'),'weatherLocked':weather in ['WEATHER_DOWNPOUR','WEATHER_SANDSTORM','WEATHER_DROUGHT','WEATHER_ABNORMAL','WEATHER_VOLCANIC_ASH','WEATHER_FOG_HORIZONTAL','WEATHER_FOG_DIAGONAL'],'tiles':rows,'events':events,'encounters':encounters,'encounterRate':rate,'ground':f'assets/{slug}-ground.png','foreground':f'assets/{slug}-top.png','connections':[{**c,'map':c['map'].lower()} for c in (map_.get('connections') or []) if c['map'] in byid],'jumps':jumps,'counters':counters,'elevations':elevations,'behaviors':behavior_rows,'coordEvents':map_.get('coord_events',[]),'sourceMap':map_['id'],'scriptText':script}
        world[slug]['metatileIds']=[[cells[y*w+x]&1023 for x in range(w)] for y in range(h)]
        if 'setmetatile' in script or 'Gym' in name:world[slug]['metatileAtlas']=atlas(primary,secondary,slug)
        report['maps'].append(name)
    for m in world.values():
        m['events']=[e for e in m['events'] if e['kind']!='warp' or e['map'] in world]
        m['connections']=[c for c in m['connections'] if c['map'] in world]
    # Imported warp targets can be doors marked blocked by the native collision bits.
    for m in world.values():
        for e in m['events']:
            if e['kind']=='warp':
                dest=world[e['map']];x,y=e['toX'],e['toY'];dest['tiles'][y]=dest['tiles'][y][:x]+'d'+dest['tiles'][y][x+1:]
    old=json.loads((out/'content.json').read_text());old['maps']={k:v for k,v in old['maps'].items() if not v.get('sourceMap')};old['maps'].update(world);old['version']='prototype-2';old['source']=sha;old['sharedScripts']=(repo/'data/event_scripts.s').read_text()+'\n'+'\n'.join(p.read_text() for p in sorted((repo/'data/scripts').glob('*.inc'))+sorted((repo/'data/text').glob('*.inc')));old['initialFlags']={flag:True for flag in re.findall(r'^\s*setflag\s+(FLAG_HIDE_\w+)',(repo/'data/scripts/new_game.inc').read_text(),re.M)};old['start']={'map':'map_littleroot_town','x':15,'y':14};old['playerSprites']={'Male':hero,'Female':female};old['travel']=[{'map':key,'x':next((x for y,row in enumerate(m['tiles']) for x,c in enumerate(row) if c=='.' and 3<x<m['width']-3 and 3<y<m['height']-3),1),'y':0} for key,m in world.items() if m['outdoor'] and any('.' in row for row in m['tiles'])]
    for t in old['travel']:
        m=world[t['map']];spots=[(x,y) for y,row in enumerate(m['tiles']) for x,c in enumerate(row) if c=='.' and 3<x<m['width']-3 and 3<y<m['height']-3 and not any(e['x']==x and e['y']==y for e in m['events'])];x,y=min(spots or [(x,y) for y,row in enumerate(m['tiles']) for x,c in enumerate(row) if c=='.'],key=lambda pos:(pos[0]-m['width']//2)**2+(pos[1]-m['height']//2)**2);t.update(x=x,y=y)
    (out/'content.json').write_text(json.dumps(old,separators=(',',':'))+'\n');(out/'port-report.json').write_text(json.dumps(report,indent=2)+'\n');print(f'Ported {len(world)} maps and {len(native["species"])} species records; {len(report["unresolvedEvents"])} events await script porting.')
    from export_field_data import build as build_field_data
    build_field_data(repo,out)
    subprocess.run([sys.executable,str(root/'tools/export_story_data.py'),str(repo)],check=True)
    subprocess.run([sys.executable,str(root/'tools/export_wild_sprites.py'),str(repo)],check=True)
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('source');parser.add_argument('--output',default=str(Path(__file__).resolve().parents[1]/'game'));args=parser.parse_args();build(args.source,args.output)
