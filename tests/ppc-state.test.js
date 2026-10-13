const assert=require('assert');
const S=require('../public/ppc-state.js');

const state=S.create({pages:2});
assert.equal(S.describe().gprCount,32);
S.setGpr(state,3,42);
S.setGpr(state,1,0x1ff00);
S.setSpecial(state,'pc',0x82000000);
S.setSpecial(state,'lr',0x82001234);
S.setSpecial(state,'ctr',7);
assert.equal(S.getGpr(state,3),42);
assert.equal(S.getGpr(state,1),0x1ff00);
assert.equal(S.getSpecial(state,'pc'),0x82000000);
assert.equal(S.getSpecial(state,'lr'),0x82001234);
assert.equal(S.getSpecial(state,'ctr'),7);

const snap=S.snapshot(state);
S.reset(state,{pc:0x1000,stackPointer:0x2000});
assert.equal(S.getSpecial(state,'pc'),0x1000);
assert.equal(S.getGpr(state,1),0x2000);
assert.equal(S.getGpr(state,3),0);
S.restore(state,snap);
assert.equal(S.getGpr(state,3),42);
assert.equal(S.getSpecial(state,'lr'),0x82001234);

const data=new Uint8Array([1,2,3,4,5]);
S.copyTo(state,0x20,data);
assert.deepEqual(Array.from(S.copyFrom(state,0x20,5)),Array.from(data));
assert.throws(()=>S.setGpr(state,32,1),/0\.\.31/);
console.log('PPC shared state ABI tests passed:',JSON.stringify(S.describe()));
