const assert=require('assert');
const X=require('../public/xex-parser.js');

const bytes=X.makeSynthetic({entryPoint:0x82001234,imageBase:0x82000000,stackSize:0x80000});
const x=X.parse(bytes);
assert.equal(x.format,'XEX2');
assert.equal(x.headerCount,3);
assert.equal(x.entryPoint,0x82001234);
assert.equal(x.imageBase,0x82000000);
assert.equal(x.defaultStackSize,0x80000);
assert.equal(x.optionalHeaders.length,3);
assert.throws(()=>X.parse(new Uint8Array([1,2,3,4])),/too small/i);
const bad=new Uint8Array(0x18);bad.set([0x4e,0x4f,0x50,0x45]);
assert.throws(()=>X.parse(bad),/Not an XEX2/i);
console.log('XEX parser tests passed:',JSON.stringify(X.summarize(x)));
