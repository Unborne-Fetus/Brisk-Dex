"""Extract source battle environments, window frame and Latin pixel font."""
import json,re,struct,sys
from pathlib import Path
from PIL import Image
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
root=Path(__file__).resolve().parents[1];source=Path(sys.argv[1]);assets=root/'game/assets'
def palette(p):return [tuple(map(int,s.split())) for s in p.read_text().splitlines()[3:] if s.strip()]
for folder in sorted((source/'graphics/battle_environment').iterdir()):
 if not (folder/'map.bin').exists() or not (folder/'palette.pal').exists():continue
 im=Image.open(folder/'tiles.png');colors=palette(folder/'palette.pal');entries=struct.unpack('<2048H',(folder/'map.bin').read_bytes());canvas=Image.new('RGBA',(256,512))
 for i,entry in enumerate(entries):
  tile=entry&1023;x=tile%(im.width//8)*8;y=tile//(im.width//8)*8;piece=im.crop((x,y,x+8,y+8));rgba=Image.new('RGBA',(8,8));rgba.putdata([(*colors[n%16],255) for n in piece.getdata()])
  if entry&1024:rgba=rgba.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
  if entry&2048:rgba=rgba.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
  canvas.alpha_composite(rgba,(i%32*8,i//32*8))
 canvas.crop((0,0,240,112)).save(assets/f'battle-{folder.name}.png')
im=Image.open(source/'graphics/text_window/1.png');colors=[tuple(im.getpalette()[i:i+3]) for i in range(0,48,3)];frame=Image.new('RGBA',im.size);frame.putdata([(*colors[n%16],255) if n else (0,0,0,0) for n in im.getdata()]);frame.save(assets/'dialogue-frame.png')
font=Image.open(source/'graphics/fonts/latin_normal.png');widths=list(map(int,re.findall(r'\d+',re.search(r'gFontNormalLatinGlyphWidths\[\]\s*=\s*\{(.*?)\};',(source/'src/fonts.c').read_text(),re.S)[1])));chars={c:int(n,16) for c,n in re.findall(r"^'(.)'\s*=\s*([0-9A-F]{2})(?:\s|$)",(source/'charmap.txt').read_text(),re.M)};chars[' ']=0;glyphs={};metrics={};cmap={};fontWidths={}
for char,index in chars.items():
 name='uni'+format(ord(char),'04X');pen=TTGlyphPen(None);tile=font.crop((index%16*16,index//16*16,index%16*16+16,index//16*16+16))
 for y in range(16):
  for x in range(16):
   if tile.getpixel((x,y))==1:
    a=x*64;b=(15-y)*64;pen.moveTo((a,b));pen.lineTo((a+64,b));pen.lineTo((a+64,b+64));pen.lineTo((a,b+64));pen.closePath()
 glyphs[name]=pen.glyph();metrics[name]=(widths[index]*64,0);cmap[ord(char)]=name;fontWidths[char]=widths[index]
glyphs['.notdef']=TTGlyphPen(None).glyph();metrics['.notdef']=(384,0);builder=FontBuilder(1024,isTTF=True);builder.setupGlyphOrder(['.notdef']+[k for k in glyphs if k!='.notdef']);builder.setupCharacterMap(cmap);builder.setupGlyf(glyphs);builder.setupHorizontalMetrics(metrics);builder.setupHorizontalHeader(ascent=1024,descent=-128);builder.setupNameTable({'familyName':'Brisk Emerald','styleName':'Regular','uniqueFontIdentifier':'BriskSourceNormal','fullName':'Brisk Emerald Source Normal','psName':'BriskEmeraldNormal'});builder.setupOS2(sTypoAscender=1024,sTypoDescender=-128,usWinAscent=1024,usWinDescent=128);builder.setupPost();builder.font.flavor='woff';builder.font.save(assets/'emerald-normal.woff');(root/'game/font-metrics.json').write_text(json.dumps(fontWidths,ensure_ascii=False,separators=(',',':'))+'\n');print('Exported source battle backgrounds and pixel font')
