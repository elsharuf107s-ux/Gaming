const assert=require('assert');
const X=require('../public/xex-parser.js');
const I=require('../public/xex-imports.js');
const S=require('../public/ppc-state.js');
const K=require('../public/xbox-runtime.js');

function put32(b,o,v){b[o]=v>>>24;b[o+1]=v>>>16;b[o+2]=v>>>8;b[o+3]=v}
function put16(b,o,v){b[o]=v>>>8;b[o+1]=v}

const b=new Uint8Array(0x200);
b.set([0x58,0x45,0x58,0x32],0);
put32(b,4,1);put32(b,8,0x100);put32(b,12,0);put32(b,16,0x40);put32(b,20,3);
let h=0x18;
put32(b,h,X.KEYS.ENTRY_POINT);put32(b,h+4,0x82000000);h+=8;
put32(b,h,X.KEYS.IMAGE_BASE);put32(b,h+4,0x82000000);h+=8;
put32(b,h,I.IMPORT_LIBRARIES_KEY);put32(b,h+4,0x60);

const strings=new TextEncoder().encode('xboxkrnl\0');
const libSize=0x30,totalSize=12+strings.length+libSize,off=0x60;
put32(b,off,totalSize);put32(b,off+4,strings.length);put32(b,off+8,1);b.set(strings,off+12);
const p=off+12+strings.length;
put32(b,p,libSize);
put32(b,p+0x18,1);put32(b,p+0x1c,0);put32(b,p+0x20,0);put16(b,p+0x24,0);put16(b,p+0x26,2);
put32(b,p+0x28,0x82001000);put32(b,p+0x2c,0x82001004);

const parsed=I.parse(b);
assert.equal(parsed.present,true);
assert.equal(parsed.strings[0],'xboxkrnl');
assert.equal(parsed.libraries.length,1);
assert.equal(parsed.libraries[0].name,'xboxkrnl');
assert.equal(parsed.libraries[0].count,2);

const image=new Uint8Array(0x2000);
put32(image,0x1000,0x00000083); // value/import record, ordinal 0x83
put32(image,0x1004,0x01000083); // thunk record, ordinal 0x83
const resolved=I.resolveRecords(parsed,{virtualBase:0x82000000,image});
const imp=resolved.libraries[0].imports[0];
assert.equal(imp.ordinal,0x83);
assert.equal(imp.valueAddress,0x82001000);
assert.equal(imp.thunkAddress,0x82001004);

const state=S.create({pages:2});
const kernel=K.create({state});
const binding=I.bindKnownImports(resolved,kernel);
assert.equal(binding.bound.length,1);
assert.equal(binding.bound[0].name,'KeQueryPerformanceFrequency');
kernel.dispatchAddress(0x82001004,0);
assert.equal(S.getGpr(state,3),50000000);
console.log('XEX imports -> xboxkrnl automatic binding passed');
