"""Pack Brisk's actual follower sheets and normal/shiny palettes for map wildlife."""
import json,sys
from pathlib import Path
from PIL import Image
root=Path(__file__).resolve().parents[1];source=Path(sys.argv[1]);pokemon=source/'graphics/pokemon';data=json.loads((root/'brisk-dex-data.json').read_text());paths={p.parent.relative_to(pokemon).as_posix().replace('/','_').upper():p for p in pokemon.rglob('overworld.png')}
entries=[]
for id,record in data['species'].items():
 p=paths.get(record['constant'])
 if p:entries.append((id,p))
def palette(p):
 rows=p.read_text().splitlines();return [tuple(map(int,line.split())) for line in rows[3:] if line.strip()]
cols=5;width=960;height=((len(entries)+cols-1)//cols)*32;atlases=[Image.new('RGBA',(width,height)) for _ in range(2)];meta={}
for index,(id,p) in enumerate(entries):
 im=Image.open(p);x=index%cols*192;y=index//cols*32
 if im.size!=(192,32):continue
 for variant,suffix in enumerate(['normal','shiny']):
  pal=p.parent/f'overworld_{suffix}.pal'
  if not pal.exists():pal=p.parent/'overworld_normal.pal'
  if im.mode=='P' and pal.exists():
   colors=palette(pal);sheet=Image.new('RGBA',im.size);sheet.putdata([(*colors[n%len(colors)],255) if n else (0,0,0,0) for n in im.getdata()])
  else:sheet=im.convert('RGBA')
  atlases[variant].alpha_composite(sheet,(x,y))
 meta[id]={'x':x,'y':y,'width':32,'height':32,'frames':6}
for im,suffix in zip(atlases,['normal','shiny']):im.save(root/f'game/assets/wild-{suffix}.png',optimize=True)
(root/'game/wild-sprites.json').write_text(json.dumps({'schema':1,'normal':'assets/wild-normal.png','shiny':'assets/wild-shiny.png','species':meta},separators=(',',':'))+'\n');print('Packed',len(meta),'source overworld sprites, with both palettes')
