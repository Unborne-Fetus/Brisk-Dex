"""Export map-specific encounters, tile attributes and Emerald field-move rules."""
import json,re,subprocess,sys,struct
from pathlib import Path
from PIL import Image
from extract_data import read_jasc_palette

def build(repo,out):
    repo=Path(repo).resolve();out=Path(out).resolve();root=out.parent
    catalog=json.loads((root/'brisk-dex-data.json').read_text());constants=json.loads((out/'script-data.json').read_text())['constants']
    result={'format':'brisk-native-field-data','schema':1,'source':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),'maps':{},'mapNames':{},'tileAttributes':{},'fieldMoves':{},'playerSprites':{},'surfBlob':{},'unresolvedSpecies':[]}
    result['defaultElevation']=int(re.search(r'ELEVATION_DEFAULT\s*=\s*(\d+)',(repo/'include/global.fieldmap.h').read_text())[1])
    behavior=(repo/'src/metatile_behavior.c').read_text();table=re.search(r'sTileBitAttributes\[.*?\]\s*=\s*\{(.*?)\};',behavior,re.S)[1]
    fishable=re.search(r'bool8 MetatileBehavior_IsSurfableFishableWater\([^)]*\)\s*\{(.*?)\n\}',behavior,re.S)[1];result['fishableBehaviors']=re.findall(r'metatileBehavior == (MB_\w+)',fishable)
    for name,flags in re.findall(r'\[(MB_\w+)\]\s*=\s*([^,\n]+)',table):result['tileAttributes'][name]={'surfable':'TILE_FLAG_SURFABLE' in flags,'encounters':'TILE_FLAG_HAS_ENCOUNTERS' in flags}
    layouts={l['id']:l for l in json.loads((repo/'data/layouts/layouts.json').read_text())['layouts']};native=json.loads((out/'content.json').read_text())['maps']
    for file in (repo/'data/maps').glob('*/map.json'):
        m=json.loads(file.read_text());result['mapNames'][file.parent.name]=m['id'].lower();result['maps'][m['id'].lower()]={'mapType':m['map_type'],'encounters':{}}
        key=m['id'].lower();layout=layouts.get(m['layout']);target=native.get(key)
        if layout and target:
            data=(repo/layout['blockdata_filepath']).read_bytes();cells=struct.unpack('<'+'H'*(len(data)//2),data);w=layout['width'];result['maps'][key]['blockedWater']=[f'{x},{y}' for y,row in enumerate(target['behaviors']) for x,behavior in enumerate(row) if result['tileAttributes'].get(behavior,{}).get('surfable') and (cells[y*w+x]&0xc00)]
    for group in json.loads((repo/'src/data/wild_encounters.json').read_text())['wild_encounter_groups']:
        if not group.get('for_maps'):continue
        fields={f['type']:f for f in group['fields']}
        for area in group['encounters']:
            key=area['map'].lower()
            if key not in result['maps']:continue
            for kind,field in fields.items():
                if kind not in area:continue
                source=area[kind];slots=[]
                for index,entry in enumerate(source['mons']):
                    name=entry['species'];id=constants.get(name);species=catalog['species'].get(str(id))
                    if name=='SPECIES_NONE':species=None
                    elif not species:result['unresolvedSpecies'].append({'map':key,'method':kind,'slot':index,'species':name})
                    weight=1 if kind in ['land_mons','water_mons'] else field['encounter_rates'][index] if index<len(field['encounter_rates']) else 1
                    slots.append({'species':species['constant'] if species else None,'min':entry['min_level'],'max':entry['max_level'],'weight':weight,'sourceSlot':index})
                # Brisk chooses equally among occupied land/water slots; preserve
                # empty authored slots separately instead of replacing them.
                record={'rate':source['encounter_rate'],'slots':slots}
                if field.get('groups'):record['groups']=field['groups']
                result['maps'][key]['encounters'][kind]=record
    info=(repo/'src/field_move.c').read_text()
    for name,body in re.findall(r'\[(FIELD_MOVE_\w+)\]\s*=\s*\{(.*?)\}',info,re.S):
        unlock=re.search(r'\.unlockType\s*=\s*(\w+)',body);move=re.search(r'\.moveID\s*=\s*(MOVE_\w+)',body);badge=re.findall(r'FLAG_TO_BADGE\((FLAG_\w+)\)',body)
        if unlock:result['fieldMoves'][name]={'unlockType':unlock[1],'badge':badge[-1] if badge else None,'move':move[1] if move else None,'requiresKnownMove':False}
    # Reproduce source object sheets/palettes; Surf's picture table uses frames 0,2,4.
    infos=(repo/'src/data/object_events/object_event_graphics_info.h').read_text();pointers=(repo/'src/data/object_events/object_event_graphics_info_pointers.h').read_text();pics=(repo/'src/data/object_events/object_event_pic_tables.h').read_text();graphics=(repo/'src/data/object_events/object_event_graphics.h').read_text()
    for mode,suffix in [('surf','SURFING'),('underwater','UNDERWATER')]:
        result['playerSprites'][mode]={}
        for gender,person in [('Male','BRENDAN'),('Female','MAY')]:
            gfx=f'OBJ_EVENT_GFX_{person}_{suffix}';symbol=re.search(r'\['+gfx+r'\]\s*=\s*&(\w+)',pointers)[1];body=re.search(r'\b'+symbol+r'\s*=\s*\{(.*?)\};',infos,re.S)[1]
            width=int(re.search(r'\.width\s*=\s*(\d+)',body)[1]);height=int(re.search(r'\.height\s*=\s*(\d+)',body)[1]);pic=re.search(r'\.images\s*=\s*(\w+)',body)[1];frames=re.search(r'\b'+pic+r'\[\]\s*=\s*\{(.*?)\};',pics,re.S)[1];graphic=re.search(r'gObjectEventPic_\w+',frames)[0];filename=re.search(r'\b'+graphic+r'\[\]\s*=\s*INC\w+\("([^"]+)"',graphics)[1].replace('.4bpp','.png')
            pal=re.search(r'\.paletteTag\s*=\s*OBJ_EVENT_PAL_TAG_(\w+)',body)[1].lower();colors=read_jasc_palette(str(repo/'graphics/object_events/palettes'/f'{pal}.pal'));image=Image.open(repo/filename);rgba=Image.new('RGBA',image.size);rgba.putdata([(*colors[v],255) if v else (0,0,0,0) for v in image.getdata()]);path=f'assets/field-{mode}-{gender.lower()}.png';rgba.save(out/path)
            frame_map=[int(n) for n in re.findall(r'overworld_frame\([^\n]*,\s*(\d+)\)',frames)[:3]]
            if mode=='surf':
                blob=Image.open(repo/'graphics/field_effects/pics/surf_blob.png');surface=Image.new('RGBA',blob.size);surface.putdata([(*colors[v],255) if v else (0,0,0,0) for v in blob.getdata()]);blob_path=f'assets/field-surf-blob-{gender.lower()}.png';surface.save(out/blob_path);result['surfBlob'][gender]={'path':blob_path,'width':32,'height':32}
            result['playerSprites'][mode][gender]={'path':path,'width':width,'height':height,'frames':image.width//width,'frameMap':frame_map or [0,1,2]}
    (out/'field-data.json').write_text(json.dumps(result,separators=(',',':'))+'\n')
    print(f'Exported {len(result["maps"])} map field records; {len(result["unresolvedSpecies"])} species references require review.')
if __name__=='__main__':build(sys.argv[1],sys.argv[2] if len(sys.argv)>2 else Path(__file__).resolve().parents[1]/'game')
