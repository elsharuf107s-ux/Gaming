const assert=require('assert');
const fn=require('../public/ppc-functions.js');

// Synthetic PPC image at 0x1000:
// 1000: mflr r0
// 1004: stwu r1,-32(r1)
// 1008: bl 0x1020
// 100c: mtlr r0
// 1010: blr
// ... padding ...
// 1020: addi r3,r0,7
// 1024: blr
const base=0x1000;
const words=[];
words.push(fn.encodeMfspr(0,8));
words.push(fn.encodeD(37,1,1,-32));
words.push(fn.encodeB(0x1008,0x1020,{link:true}));
words.push(fn.encodeMtspr(0,8));
words.push(fn.encodeBclr());
words.push(0x60000000); // ori r0,r0,0
words.push(0x60000000);
words.push(0x60000000);
words.push(fn.encodeD(14,3,0,7));
words.push(fn.encodeBclr());

const bytes=fn.wordsToBytes(words);
const decoded=fn.decodeBuffer(bytes,{baseAddress:base});
assert.equal(decoded[0].op,'mfspr');
assert.equal(decoded[0].spr,8);
assert.equal(decoded[1].op,'stwu');
assert.equal(decoded[2].op,'bl');
assert.equal(decoded[2].target,0x1020);
assert.equal(decoded[3].op,'mtspr');
assert.equal(decoded[4].op,'blr');

const d=fn.discoverFunctions(bytes,{baseAddress:base,entryPoints:[base]});
assert.equal(d.functions.length,2);
const caller=d.functions.find(f=>f.start===0x1000);
const callee=d.functions.find(f=>f.start===0x1020);
assert(caller);
assert(callee);
assert.equal(caller.frame.stackFrameBytes,32);
assert.equal(caller.frame.savesLR,true);
assert.equal(caller.frame.restoresLR,true);
assert.equal(caller.frame.returnsWithBLR,true);
assert.equal(caller.frame.leaf,false);
assert.equal(caller.calls.length,1);
assert.equal(caller.calls[0].target,0x1020);
assert.equal(caller.calls[0].internal,true);
assert.equal(callee.frame.leaf,true);
assert.equal(callee.frame.returnsWithBLR,true);

const s=fn.summarize(d);
assert.equal(s.functionCount,2);
assert.equal(s.directCalls,1);
assert.equal(s.framedFunctions,1);
assert.equal(s.cleanReturns,2);

console.log('PPC function discovery tests passed:',JSON.stringify(s));
