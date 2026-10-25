"""Pack the ROM's 32/64 pixel, horizontal/vertical follower sheets faithfully."""
import json,sys
from pathlib import Path
from PIL import Image
root=Path(__file__).resolve().parents[1];source=Path(sys.argv[1]);pokemon=source/'graphics/pokemon';data=json.loads((root/'brisk-dex-data.json').read_text());paths={p.parent.relative_to(pokemon).as_posix().replace('/','_').upper():p for p in pokemon.rglob('overworld.png')}
def palette(p):return [tuple(map(int,line.split())) for line in p.read_text().splitlines()[3:] if line.strip()]
entries=[];meta={};locations={};x=y=row=0;width=2048
for id,record in data['species'].items():
 p=paths.get(record['constant']) or paths.get(record['constant'].replace('_ALOLAN','_ALOLA').replace('_GALARIAN','_GALAR').replace('_HISUIAN','_HISUI').replace('_PALDEAN','_PALDEA')) or paths.get(record['constant'].split('_')[0])
 if not p:continue
 if p in locations:
  original=locations[p];meta[id]={**meta[original],'aliasOf':original,'reason':'regular source form'};continue
 im=Image.open(p);size=64 if im.height==64 else 32
 vertical=im.width==size and im.height>size;frames=(im.height if vertical else im.width)//size
 if frames<6:continue
 sheet_width=frames*size
 if x+sheet_width>width:x=0;y+=row;row=0
 locations[p]=id;entries.append((id,p,x,y,size,frames,vertical));meta[id]={'x':x,'y':y,'width':size,'height':size,'frames':frames,'sourceSpecies':record['constant']};x+=sheet_width;row=max(row,size)
height=y+row;atlases=[Image.new('RGBA',(width,height)) for _ in range(2)]
for id,p,x,y,size,frames,vertical in entries:
 im=Image.open(p)
 for variant,suffix in enumerate(['normal','shiny']):
  pal=p.parent/f'overworld_{suffix}.pal'
  if not pal.exists():pal=p.parent/'overworld_normal.pal'
  if im.mode=='P' and pal.exists():
   colors=palette(pal);sheet=Image.new('RGBA',im.size);sheet.putdata([(*colors[n%len(colors)],255) if n else (0,0,0,0) for n in im.getdata()])
  else:sheet=im.convert('RGBA')
  for frame in range(frames):
   sx,sy=(0,frame*size) if vertical else (frame*size,0);atlases[variant].alpha_composite(sheet.crop((sx,sy,sx+size,sy+size)),(x+frame*size,y))
# Reuse regular forms for missing form art and source family art for custom mons.
by_constant={s['constant']:id for id,s in data['species'].items()};parents={}
for id,s in data['species'].items():
 for evo in s.get('evolutions',[]):
  target=evo.get('target') or evo.get('species') or evo.get('to');target=by_constant.get(str(target).replace('SPECIES_',''),str(target));parents.setdefault(target,[]).append(id)
aliases={'HISSIORITE':'SIZZLIPEDE','COBARETT':'CENTISKORCH','PYTHONOVA':'CENTISKORCH','BAOBY':'EXEGGUTOR','BAOBARAFFE':'EXEGGUTOR_ALOLA','GIMMIGHOUL_ROAMING':'GIMMIGHOUL_CHEST' ,'IRON_FURNACE':'GARGANACL','STEAM_SHELL':'BLASTOISE','DRASHIMI':'TATSUGIRI_CURLY','TSUSHIMI':'TATSUGIRI_CURLY','TOBISHIMI':'TATSUGIRI_CURLY','MERLICUN':'LARVESTA','FIROMENIS':'VOLCARONA','ANU':'XATU','NUENFLU':'SNOM','SLUGAQUA':'SHELLOS_WEST','FLABAQUA':'GASTRODON_WEST','GLAUTILUS':'OMASTAR','BULBENT':'BELLSPROUT','MAGUORN':'WEEPINBELL','TREEWISE':'TREVENANT','LARFAE':'SEWADDLE','CHRYSANTLE':'SWADLOON','DRUICHY':'LEAVANNY','DUCHEFLY':'RIBOMBEE','FURFANG':'SWINUB','BOARHORN':'PILOSWINE'}
for id,s in data['species'].items():
 if id in meta:continue
 target=by_constant.get(aliases.get(s['constant'],''));reason='closest source species'
 if target not in meta:
  candidates=[i for i,t in data['species'].items() if i in meta and t.get('nationalDex')==s.get('nationalDex') and not t.get('formLabel')];target=candidates[0] if candidates else None;reason='regular form'
 if target not in meta:
  queue=parents.get(id,[])[:];seen=set()
  while queue:
   parent=queue.pop(0)
   if parent in seen:continue
   seen.add(parent)
   if parent in meta:target=parent;break
   queue.extend(parents.get(parent,[]))
  reason='evolution family'
 if target in meta:meta[id]={**meta[target],'aliasOf':target,'reason':reason}
# Player running sheets share the source object-event palette, rather than
# the embedded PNG preview palette.
objects=source/'graphics/object_events'
for gender in ['brendan','may']:
 p=objects/f'pics/people/{gender}/running.png';pal=objects/f'palettes/{gender}.pal'
 if not p.exists() or not pal.exists():continue
 im=Image.open(p);colors=palette(pal);sheet=Image.new('RGBA',im.size);sheet.putdata([(*colors[n],255) if n else (0,0,0,0) for n in im.getdata()]);sheet.save(root/f'game/assets/player-{gender}-running.png',optimize=True)
for im,suffix in zip(atlases,['normal','shiny']):im.save(root/f'game/assets/wild-{suffix}.png',optimize=True)
(root/'game/wild-sprites.json').write_text(json.dumps({'schema':2,'normal':'assets/wild-normal.png','shiny':'assets/wild-shiny.png','species':meta},separators=(',',':'))+'\n');print('Packed',len(entries),'exact sheets;',len(meta),'species including explicit source-form/family aliases')
