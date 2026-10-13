const assert=require('assert');
const L=require('../public/xex-loader.js');
const P=require('../public/ppc-core.js');
const F=require('../public/ppc-functions.js');

const bytes=L.makeSyntheticUncompressed({imageBase:0x82000000,entryOffset:0x20,payloadSize:0x100});
const meta=L.inspect(bytes);
assert.equal(meta.fileFormat.encryptionType,L.ENCRYPTION.NONE);
assert.equal(meta.fileFormat.compressionType,L.COMPRESSION.NONE);
assert.equal(meta.supportedImagePath,true);

const loaded=L.loadImage(bytes);
assert.equal(loaded.virtualBase,0x82000000);
assert.equal(loaded.entryPoint,0x82000020);
assert.equal(loaded.entryOffset,0x20);
assert.equal(L.virtualToOffset(loaded,0x82000020),0x20);

const code=L.entrySlice(loaded,12);
const decoded=P.decodeBuffer(code,{baseAddress:loaded.entryPoint});
assert.equal(decoded[0].op,'addi');
assert.equal(decoded[0].imm,40);
assert.equal(decoded[1].op,'addi');
assert.equal(decoded[1].imm,2);
assert.ok(decoded[2].op==='unsupported'||decoded[2].op==='blr');

const analysis=F.analyzeBytes(code,{baseAddress:loaded.entryPoint,entryPoint:loaded.entryPoint});
assert.ok(analysis.instructions.length>=2);

const bad=bytes.slice();
bad[0x64]=0;bad[0x65]=1; // encryption NORMAL
assert.throws(()=>L.loadImage(bad),/Encrypted XEX images are not supported yet/);

console.log('XEX loader -> PPC pipeline tests passed');
