// Generated from the existing Dex reader. Never writes GBA data.
import {experience as experienceForLevel} from './model.mjs';
export function createGbaReader(data){const NAME_DATA=data,GAME_SHINY_ODDS=data.shinyOdds||8;
var CHARMAP = {};
(function(){
  var t = CHARMAP;
  t[0x00] = ' ';
  var accented = {0x01:'À',0x02:'Á',0x03:'Â',0x04:'Ç',0x05:'È',0x06:'É',0x07:'Ê',0x08:'Ë',0x09:'Ì',0x0B:'Î',0x0C:'Ï',0x0D:'Ò',0x0E:'Ó',0x0F:'Ô',
    0x10:'Œ',0x11:'Ù',0x12:'Ú',0x13:'Û',0x14:'Ñ',0x15:'ß',0x16:'à',0x17:'á',0x19:'ç',0x1A:'è',0x1B:'é',0x1C:'ê',0x1D:'ë',0x1E:'ì',
    0x20:'î',0x21:'ï',0x22:'ò',0x23:'ó',0x24:'ô',0x25:'œ',0x26:'ù',0x27:'ú',0x28:'û',0x29:'ñ',0x2A:'º',0x2B:'ª',0x2D:'&',0x2E:'+',
    0x34:'Lv',0x35:'=',0x36:';',
    0x50:' ',0x51:'¿',0x52:'¡',0x5A:'Í',0x5B:'%',0x5C:'(',0x5D:')',
    0x68:'â',0x6F:'í',
    0x79:'↑',0x7A:'↓',0x7B:'←',0x7C:'→',
    0x84:'e',0x85:'<',0x86:'>',
    0xA0:'re',0xA1:'0',0xA2:'1',0xA3:'2',0xA4:'3',0xA5:'4',0xA6:'5',0xA7:'6',0xA8:'7',0xA9:'8',0xAA:'9',
    0xAB:'!',0xAC:'?',0xAD:'.',0xAE:'-',0xAF:'·',
    0xB0:'…',0xB1:'“',0xB2:'”',0xB3:'‘',0xB4:'’',0xB5:'♂',0xB6:'♀',0xB7:'$',0xB8:',',0xB9:'×',0xBA:'/'
  };
  Object.keys(accented).forEach(function(k){ t[k] = accented[k]; });
  var upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (var i=0;i<26;i++){ t[0xBB+i] = upper[i]; }
  var lower = "abcdefghijklmnopqrstuvwxyz";
  for (var i=0;i<26;i++){ t[0xD5+i] = lower[i]; }
  t[0xF0] = ':'; t[0xF1]='Ä'; t[0xF2]='Ö'; t[0xF3]='Ü'; t[0xF4]='ä'; t[0xF5]='ö'; t[0xF6]='ü';
  t[0xEF] = '►';
})();


var SUB_ORDERS = [
  "GAEM","GAME","GEAM","GEMA","GMAE","GMEA",
  "AGEM","AGME","AEGM","AEMG","AMGE","AMEG",
  "EGAM","EGMA","EAGM","EAMG","EMGA","EMAG",
  "MGAE","MGEA","MAGE","MAEG","MEGA","MEAG"
];
var NATURES = ["Hardy","Lonely","Brave","Adamant","Naughty","Bold","Docile","Relaxed","Impish","Lax",
  "Timid","Hasty","Serious","Jolly","Naive","Modest","Mild","Quiet","Bashful","Rash",
  "Calm","Gentle","Sassy","Careful","Quirky"];
function decodeGen3String(bytes){
  var out = '';
  for (var i=0;i<bytes.length;i++){
    var b = bytes[i];
    if (b === 0xFF) break;
    out += (CHARMAP[b] !== undefined) ? CHARMAP[b] : '';
  }
  return out.trim();
}
function decodePokemon(rec, isPartySlot){
  if (rec.length < 80) return null;
  var view = new DataView(rec.buffer, rec.byteOffset, rec.length);
  var personality = u32(view, 0x00);
  var otId = u32(view, 0x04);

  if (personality === 0 && otId === 0){
    return { empty:true };
  }

  var nickname = decodeGen3String(rec.subarray(0x08, 0x08+10));
  var language = u8(view, 0x12);
  var otName = decodeGen3String(rec.subarray(0x14, 0x14+7));
  var markings = u8(view, 0x1B);
  var checksum = u16(view, 0x1C);

  // decrypt 48-byte data section
  var key = (otId ^ personality) >>> 0;
  var dataBytes = new Uint8Array(48);
  dataBytes.set(rec.subarray(0x20, 0x20+48));
  var dataView = new DataView(dataBytes.buffer);
  for (var w=0; w<12; w++){
    var word = dataView.getUint32(w*4, true);
    var dec = (word ^ key) >>> 0;
    dataView.setUint32(w*4, dec, true);
  }

  var calculatedChecksum = 0;
  for (var cw=0; cw<24; cw++) calculatedChecksum = (calculatedChecksum + dataView.getUint16(cw*2, true)) & 0xFFFF;
  var checksumValid = calculatedChecksum === checksum;
  // Bit 15 of the word at 0x1E is reserved by Brisk Emerald as the competitive provenance bit.
  var competitiveLegal = ((u16(view, 0x1E) >>> 15) & 1) === 1;

  var order = SUB_ORDERS[personality % 24];
  var subOffsets = {};
  for (var i=0;i<4;i++){ subOffsets[order[i]] = i*12; }

  var gOff = subOffsets['G'], aOff = subOffsets['A'], eOff = subOffsets['E'], mOff = subOffsets['M'];

  var speciesAndTera = dataView.getUint16(gOff+0, true);
  var species = speciesAndTera & 0x07FF;
  var teraType = (speciesAndTera >>> 11) & 0x1F;
  var heldItem = dataView.getUint16(gOff+2, true) & 0x03FF;
  var experience = dataView.getUint32(gOff+4, true) & 0x001FFFFF;
  var ppBonuses = dataView.getUint8(gOff+8);
  var friendship = dataView.getUint8(gOff+9);

  var moves = [
    dataView.getUint16(aOff+0, true) & 0x07FF,
    dataView.getUint16(aOff+2, true) & 0x07FF,
    dataView.getUint16(aOff+4, true) & 0x07FF,
    dataView.getUint16(aOff+6, true) & 0x07FF
  ];
  var pp = [
    dataView.getUint8(aOff+8) & 0x7F,
    dataView.getUint8(aOff+9) & 0x7F,
    dataView.getUint8(aOff+10) & 0x7F,
    dataView.getUint8(aOff+11) & 0x7F
  ];

  var evs = {
    hp: dataView.getUint8(eOff+0), atk: dataView.getUint8(eOff+1), def: dataView.getUint8(eOff+2),
    spd: dataView.getUint8(eOff+3), spa: dataView.getUint8(eOff+4), spdef: dataView.getUint8(eOff+5)
  };

  var pokerusRaw = dataView.getUint8(mOff+0);
  var metLocation = dataView.getUint8(mOff+1);
  var originsInfo = dataView.getUint16(mOff+2, true);
  var ivEggAbility = dataView.getUint32(mOff+4, true);

  var ivs = {
    hp: ivEggAbility & 0x1F,
    atk: (ivEggAbility >>> 5) & 0x1F,
    def: (ivEggAbility >>> 10) & 0x1F,
    spd: (ivEggAbility >>> 15) & 0x1F,
    spa: (ivEggAbility >>> 20) & 0x1F,
    spdef: (ivEggAbility >>> 25) & 0x1F
  };
  var isEgg = ((ivEggAbility >>> 30) & 1) === 1;
  var abilitySlot = (dataView.getUint32(mOff+8, true) >>> 29) & 3;

  var levelMet = originsInfo & 0x7F;
  var gameOfOrigin = (originsInfo >>> 7) & 0x0F;
  var ballCaught = (originsInfo >>> 11) & 0x0F;
  var otGender = (originsInfo >>> 15) & 1;

  var nature = NATURES[personality % 25];
  // Brisk Emerald stores an override bit alongside HP lost.
  // The shiny result is the normal PID/Trainer ID check XOR that override.
  var shinyValue = (personality & 0xFFFF) ^ (personality >>> 16) ^ (otId & 0xFFFF) ^ (otId >>> 16);
  var shinyModifier = (u16(view, 0x1E) >>> 14) & 1;
  var isShiny = (shinyValue < GAME_SHINY_ODDS) !== (shinyModifier === 1);

  var mon = {
    empty:false,
    rawRecord: rec.slice(0, isPartySlot ? 100 : 80),
    personality: personality, otId: otId,
    nickname: nickname, otName: otName, otGender: otGender === 1 ? "Female":"Male",
    language: language, markings: markings,
    species: species, teraType: teraType, heldItem: heldItem, experience: experience,
    friendship: friendship, moves: moves, pp: pp, ppBonuses: ppBonuses,
    evs: evs, ivs: ivs, isEgg: isEgg, abilitySlot: abilitySlot,
    nature: nature, isShiny: isShiny,
    pokerus: pokerusRaw, metLocation: metLocation, levelMet: levelMet,
    gameOfOrigin: gameOfOrigin, ballCaught: ballCaught,
    checksumValid: checksumValid, competitiveLegal: competitiveLegal
  };

  if (isPartySlot && rec.length >= 100){
    mon.status = u32(view, 0x50);
    mon.level = u8(view, 0x54);
    mon.currentHP = u16(view, 0x56);
    mon.maxHP = u16(view, 0x58);
    mon.atk = u16(view, 0x5A);
    mon.def = u16(view, 0x5C);
    mon.speed = u16(view, 0x5E);
    mon.spAtk = u16(view, 0x60);
    mon.spDef = u16(view, 0x62);
  } else {
    // derive an approximate level from experience using a medium-fast curve
    // (exact curve depends on species growth rate, which we may not have data for)
    mon.level = estimateLevelFromExp(experience, speciesGrowthRate(species));
    mon.maxHP = null; mon.currentHP = null;
  }

  return mon;
}
function parseTrainer(v0, s0){
  var nameBytes = s0.subarray(0x0000, 0x0007);
  var name = decodeGen3String(nameBytes);
  var gender = u8(v0, 0x0008);
  var idFull = u32(v0, 0x000A);
  var publicId = idFull & 0xFFFF;
  var secretId = (idFull >>> 16) & 0xFFFF;
  var hours = u16(v0, 0x000E);
  var minutes = u8(v0, 0x0010);
  var seconds = u8(v0, 0x0011);
  var outfitId = u16(v0, 0x0090);
  if (outfitId !== 1 && outfitId !== 2) outfitId = 1;
  return {
    name: name || "TRAINER",
    gender: gender === 1 ? "Female" : "Male",
    outfitId: outfitId,
    publicId: publicId,
    secretId: secretId,
    hours: hours, minutes: minutes, seconds: seconds
  };
}
function speciesGrowthRate(id){
  var entry = NAME_DATA.species[String(id)];
  return entry && typeof entry === 'object' ? entry.growthRate : null;
}
function estimateLevelFromExp(exp, growthRate){
  var level = 1;
  for (var candidate=2; candidate<=100; candidate++){
    if (experienceForLevel(candidate, growthRate) > exp) break;
    level = candidate;
  }
  return level;
}
function u16(view, off){ return view.getUint16(off, true); }
function u32(view, off){ return view.getUint32(off, true); }
function u8(view, off){ return view.getUint8(off); }
return {decodePokemon,parseTrainer,decodeString:decodeGen3String};}
