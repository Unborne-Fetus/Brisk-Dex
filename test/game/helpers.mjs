import fs from 'node:fs';
import {Catalog} from '../../game/model.mjs';
import {Campaign} from '../../game/world.mjs';
export const data=JSON.parse(fs.readFileSync(new URL('../../brisk-dex-data.json',import.meta.url)));
export const pack=JSON.parse(fs.readFileSync(new URL('../../game/content.json',import.meta.url)));
export const native=JSON.parse(fs.readFileSync(new URL('../../game/native-catalog.json',import.meta.url)));
pack.start={map:'field',x:12,y:10};
export const catalog=new Catalog(data,native);
export const fresh=(seed=42)=>Campaign.start(catalog,structuredClone(pack),'TREECKO',seed);
