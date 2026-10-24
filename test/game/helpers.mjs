import fs from 'node:fs';
import {Catalog} from '../../game/model.mjs';
import {Campaign} from '../../game/world.mjs';
export const data=JSON.parse(fs.readFileSync(new URL('../../brisk-dex-data.json',import.meta.url)));
export const pack=JSON.parse(fs.readFileSync(new URL('../../game/content.json',import.meta.url)));
export const catalog=new Catalog(data);
export const fresh=(seed=42)=>Campaign.start(catalog,structuredClone(pack),'TREECKO',seed);
