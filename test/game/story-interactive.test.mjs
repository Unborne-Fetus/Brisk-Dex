import{test}from'node:test';import assert from'node:assert/strict';import{fresh}from'./helpers.mjs';import{runInteractiveScript,runScript}from'../../game/scripts.mjs';
const shop=`Start::
 msgbox Ask, MSGBOX_YESNO
 goto_if_eq VAR_RESULT, NO, Refused
 checkmoney 100
 goto_if_eq VAR_RESULT, 0, Refused
 takemoney 100
 giveitem ITEM_POTION
 setflag FLAG_PURCHASE_DONE
 end
Refused::
 end
Ask:
 .string "Buy a Potion?$"`;
test('yes/no event resumes at correct branch and commits exactly one purchase',async()=>{const c=fresh(),cash=c.state.money,count=c.state.inventory[28];let calls=0;await runInteractiveScript(c,shop,'Start',{choose:async()=>{calls++;assert.equal(c.state.money,cash);return 1;}});assert.equal(calls,1);assert.equal(c.state.money,cash-100);assert.equal(c.state.inventory[28],count+1);assert.equal(c.state.flags.FLAG_PURCHASE_DONE,true);});
test('refused and cancelled interactions cannot grant rewards',async()=>{for(const answer of [0,null]){const c=fresh(),before=c.snapshot();if(answer===null)await assert.rejects(()=>runInteractiveScript(c,shop,'Start',{choose:async()=>null}),/cancelled/);else await runInteractiveScript(c,shop,'Start',{choose:async()=>0});assert.equal(c.state.money,before.money);assert.equal(c.state.inventory[28],before.inventory[28]);}});
test('unsupported command after a choice rolls back money and flags',async()=>{const c=fresh(),before=c.snapshot();await assert.rejects(()=>runInteractiveScript(c,shop.replace('setflag FLAG_PURCHASE_DONE','setflag FLAG_PURCHASE_DONE\n special Unsupported'),'Start',{choose:async()=>1}),/Unported/);assert.deepEqual(c.snapshot(),before);});
test('stale interactions cannot overwrite newer campaign changes',async()=>{const c=fresh();await assert.rejects(()=>runInteractiveScript(c,shop,'Start',{choose:async()=>{c.state.money++;return 1;}}),/changed/);assert.equal(c.state.money,3001);});
test('gift Pokémon persist identity, levels and box overflow',()=>{const c=fresh();for(let i=0;i<6;i++)runScript(c,'Gift::\n givemon SPECIES_TORCHIC, 5, ITEM_NONE\n end','Gift');assert.equal(c.state.party.length,6);assert.equal(c.state.boxes.length,1);assert.ok(c.state.boxes[0].level===5);c.snapshot();});
test('bag checks, removal and healing special follow source variables',()=>{const c=fresh();c.state.party[0].hp=1;runScript(c,'Start::\n checkitem ITEM_POTION, 2\n goto_if_eq VAR_RESULT, 0, End\n removeitem ITEM_POTION, 2\n special HealPlayerParty\nEnd::\n end','Start');assert.equal(c.state.inventory[28],3);assert.equal(c.state.party[0].hp,c.catalog.stats(c.state.party[0])[0]);});
test('gift RNG advances only once and failed gifts do not alter RNG',()=>{const c=fresh(),before=c.random.state;runScript(c,'Start::\n givemon SPECIES_TORCHIC, 5\n end','Start');assert.notEqual(c.random.state,before);assert.equal(c.random.state,c.state.rng);const after=c.snapshot();assert.throws(()=>runScript(c,'Start::\n givemon SPECIES_TORCHIC, 5\n special Missing\n end','Start'));assert.deepEqual(c.snapshot(),after);});
test('native labels allow sequential fallthrough',()=>{const c=fresh();runScript(c,'Start::\n setflag FLAG_FIRST\nNext::\n setflag FLAG_SECOND\n end','Start');assert.equal(c.state.flags.FLAG_FIRST,true);assert.equal(c.state.flags.FLAG_SECOND,true);});
test('source warp and player movement commit only valid destinations',()=>{const c=fresh();runScript(c,'Start::\n warp MAP_LITTLEROOT_TOWN_PROFESSOR_BIRCHS_LAB, 6, 5\n end','Start');assert.equal(c.state.position.map,'map_littleroot_town_professor_birchs_lab');const before=c.snapshot();assert.throws(()=>runScript(c,'Start::\n setflag FLAG_BAD\n warp MAP_MISSING, 0, 0\n end','Start'));assert.deepEqual(c.snapshot(),before);});
test('bounded movement supports native tables without stepping into walls',()=>{const c=fresh();c.state.position={map:'field',x:12,y:10};runScript(c,'Start::\n applymovement LOCALID_PLAYER, Walk\n waitmovement 0\n end\nWalk:\n walk_down\n step_end','Start');assert.equal(c.state.position.y,11);c.state.position={map:'field',x:1,y:1};const before=c.snapshot();assert.throws(()=>runScript(c,'Start::\n applymovement LOCALID_PLAYER, Walk\n end\nWalk:\n walk_left\n walk_left\n walk_left\n step_end','Start'));assert.deepEqual(c.snapshot(),before);});
test('replaying a gift before multiple choices cannot duplicate the gift or RNG draws',async()=>{const c=fresh();let calls=0;await runInteractiveScript(c,'Start::\n givemon SPECIES_TORCHIC, 5\n msgbox Ask, MSGBOX_YESNO\n msgbox Ask, MSGBOX_YESNO\n end\nAsk:\n .string "Continue?$"','Start',{choose:async()=>{calls++;return 1;}});assert.equal(calls,2);assert.equal(c.state.party.length,2);assert.equal(c.state.nextId,3);assert.equal(c.state.rng,c.random.state);c.snapshot();});
