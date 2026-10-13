const assert=require('assert');
const L=require('../public/xex-loader.js');
const P=require('../public/ppc-core.js');
const F=require('../public/ppc-functions.js');
const N=require('../public/xex-normal.js');
const E=require('./helpers/lzx-encoder.js');

const COMPRESSION_BY_KIND={none:L.COMPRESSION.NONE,basic:L.COMPRESSION.BASIC,normal:L.COMPRESSION.NORMAL};
for(const kind of ['none','basic','normal']){
  const opts={imageBase:0x82000000,entryOffset:0x20,payloadSize:0x100};
  const bytes=kind==='none'?L.makeSyntheticUncompressed(opts):kind==='basic'?L.makeSyntheticBasic({...opts,zeroGap:0x10}):L.makeSyntheticNormal(opts);
  const meta=L.inspect(bytes);
  assert.equal(meta.fileFormat.encryptionType,L.ENCRYPTION.NONE);
  assert.equal(meta.fileFormat.compressionType,COMPRESSION_BY_KIND[kind]);
  assert.equal(meta.xex.imageSize,0x100);
  assert.equal(meta.supportedImagePath,true);
  if(kind==='basic'){
    assert.equal(meta.fileFormat.blockCount,1);
    assert.equal(meta.fileFormat.totalOutputSize,0x100);
  }
  const loaded=L.loadImage(bytes);
  assert.equal(loaded.virtualBase,0x82000000);
  assert.equal(loaded.entryPoint,0x82000020);
  assert.equal(loaded.entryOffset,0x20);
  assert.equal(loaded.image.length,0x100);
  assert.equal(L.virtualToOffset(loaded,0x82000020),0x20);
  const code=L.entrySlice(loaded,12);
  const decoded=P.decodeBuffer(code,{baseAddress:loaded.entryPoint});
  assert.equal(decoded[0].op,'addi');
  assert.equal(decoded[0].imm,40);
  assert.equal(decoded[1].op,'addi');
  assert.equal(decoded[1].imm,2);
  const analysis=F.analyzeBytes(code,{baseAddress:loaded.entryPoint,entryPoint:loaded.entryPoint});
  assert.ok(analysis.instructions.length>=2);
}

const bad=L.makeSyntheticUncompressed();
bad[0x64]=0;bad[0x65]=1;
assert.throws(()=>L.loadImage(bad),/Encrypted XEX images are not supported yet/);
// NORMAL with a genuinely LZX-compressed image spread over several blocks and chunks.
{
  const rng=E.mulberry32(360),image=new Uint8Array(0x30000);
  for(let i=0;i<image.length;i++) image[i]=i<0x1000?rng()*256:image[i-0x1000]^(rng()<0.01?0xff:0);
  const code=[0x38600028,0x38630002,0x4e800020];
  code.forEach((w,i)=>{const o=0x24000+i*4;image[o]=w>>>24;image[o+1]=w>>>16;image[o+2]=w>>>8;image[o+3]=w});
  for(const windowBits of [15,17]){
    const lzxStream=E.compress(image,{windowBits,seed:windowBits,blockTypes:[2,1]});
    assert.ok(lzxStream.length<image.length/2,'test image should really be compressed');
    const bytes=L.makeSyntheticNormal({image,entryOffset:0x24000,lzxStream,windowSize:1<<windowBits,chunkSize:0x200,blocks:3});
    const x=L.inspect(bytes).xex;
    const extracted=N.extractCompressedStream(bytes.slice(x.headerSize),N.parseNormalInfo(bytes,x));
    assert.equal(extracted.blockCount,3);
    assert.ok(extracted.chunkCount>3);
    assert.deepEqual(Array.from(extracted.stream),Array.from(lzxStream));
    const loaded=L.loadImage(bytes);
    assert.equal(loaded.image.length,image.length);
    assert.ok(loaded.image.every((b,i)=>b===image[i]),`NORMAL image mismatch with 2^${windowBits} window`);
    const decoded=P.decodeBuffer(L.entrySlice(loaded,8),{baseAddress:loaded.entryPoint});
    assert.equal(decoded[0].imm,40);
    assert.equal(decoded[1].imm,2);
  }
  // A corrupt LZX stream must fail the load rather than produce a bogus image.
  const broken=L.makeSyntheticNormal({image,entryOffset:0x24000,lzxStream:E.compress(image,{windowBits:15,seed:1}).subarray(0,500)});
  assert.throws(()=>L.loadImage(broken),/LZX/);
}

const delta=L.makeSyntheticUncompressed();
delta[0x67]=L.COMPRESSION.DELTA;
assert.equal(L.inspect(delta).supportedImagePath,false);
assert.throws(()=>L.loadImage(delta),/compression type 3 is not supported yet/);
console.log('XEX NONE/BASIC/NORMAL loader -> PPC pipeline tests passed');
