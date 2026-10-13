const assert=require('assert');
const F=require('../public/ppc-functions.js');
const S=require('../public/ppc-state.js');
const L=require('../public/ppc-linker.js');

const base=0x82000000;
const callee=base+0x10;
const words=[
  F.encodeB(base,callee,{link:true}),
  F.encodeBclr(),
  0x60000000,
  0x60000000,
  F.encodeD(14,3,0,40),
  F.encodeD(14,3,3,2),
  F.encodeBclr()
];
const bytes=F.wordsToBytes(words);
const discovery=F.discoverFunctions(bytes,{baseAddress:base,entryPoints:[base]});
assert.equal(discovery.functions.length,2);
const plan=L.makeLinkPlan(discovery);
assert.equal(plan.internalCalls.length,1);
assert.equal(plan.externalCalls.length,0);
assert.equal(plan.linkable,true);

const state=S.create({pages:2});
const table=L.buildFunctionTable(discovery);
const site=L.findCallSites(discovery)[0];
const entered=L.enterDirectCall(state,site,table);
assert.equal(entered.internal,true);
assert.equal(S.getSpecial(state,'pc'),callee);
assert.equal(S.getSpecial(state,'lr'),base+4);
assert.equal(L.returnViaLR(state),base+4);
assert.equal(S.getSpecial(state,'pc'),base+4);

S.reset(state,{pc:base});
const trace=L.simulateCallTrace(discovery,state,{entryPoint:base,maxSteps:16});
assert.ok(trace.trace.some(x=>x.event==='call'));
assert.ok(trace.trace.some(x=>x.event==='return'));
assert.ok(trace.trace.some(x=>x.event==='return-root'));
console.log('PPC linker/trampoline tests passed:',JSON.stringify(plan));
