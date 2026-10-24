import{test}from'node:test';import assert from'node:assert/strict';import{fresh}from'./helpers.mjs';import{runScript}from'../../game/scripts.mjs';
test('source-style scripts preserve branches, rewards and flags across repeated interactions',()=>{const c=fresh(),script=`Start::
 lock
 goto_if_set FLAG_GIFT_DONE, Done
 giveitem ITEM_POTION, 2
 setflag FLAG_GIFT_DONE
 msgbox Thanks, MSGBOX_DEFAULT
 end
Done::
 msgbox Again, MSGBOX_NPC
 end
Thanks:
 .string "Thank you, {PLAYER}!$"
Again:
 .string "Already received.$"`;const before=c.state.inventory[28];assert.ok(runScript(c,script,'Start').join().includes('Thank you'));assert.equal(c.state.inventory[28],before+2);assert.equal(c.state.flags.FLAG_GIFT_DONE,true);assert.deepEqual(runScript(c,script,'Start'),['Already received.']);assert.equal(c.state.inventory[28],before+2);});
test('unported commands roll back every preceding reward and flag',()=>{const c=fresh(),before=c.snapshot();assert.throws(()=>runScript(c,'Start::\n giveitem ITEM_POTION, 2\n setflag FLAG_WRONG\n special UnportedNativeFunction\n end','Start'),/Unported command/);assert.deepEqual(c.snapshot(),before);});
test('variables, comparisons, calls and returns execute without evaluating code',()=>{const c=fresh(),source='Start::\n setvar VAR_TEST, 5\n call Add\n goto_if_eq VAR_TEST, 7, Good\n setflag FLAG_WRONG\n end\nAdd::\n addvar VAR_TEST, 2\n return\nGood::\n setflag FLAG_RIGHT\n end';runScript(c,source,'Start');assert.equal(c.state.vars.VAR_TEST,7);assert.equal(c.state.flags.FLAG_RIGHT,true);assert.equal(c.state.flags.FLAG_WRONG,undefined);c.snapshot();});
test('choices, missing dependencies, overflows and loops cannot partially commit',()=>{for(const source of ['Start::\n setflag FLAG_WRONG\n msgbox Text, MSGBOX_YESNO\n end\nText:\n .string "Choose?$"','Start::\n goto Missing','Start::\n goto Start','Start::\n setvar VAR_X, 65535\n addvar VAR_X, 1\n end']){const c=fresh(),before=c.snapshot();assert.throws(()=>runScript(c,source,'Start'));assert.deepEqual(c.snapshot(),before);}});
