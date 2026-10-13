const assert=require('assert');
const X=require('../public/xex-parser.js');
const N=require('../public/xex-normal.js');

const bytes=N.makeSyntheticNormal({windowSize:0x8000,blockDataSize:32});
const x=X.parse(bytes);
const info=N.parseNormalInfo(bytes,x);
assert.equal(info.compressionType,N.COMPRESSION_NORMAL);
assert.equal(info.encryptionType,0);
assert.equal(info.windowSize,0x8000);
assert.equal(info.firstBlock.blockSize,N.BLOCK_HEADER_SIZE+32);

const payload=bytes.slice(x.headerSize);
const chain=N.walkBlockChain(payload,info);
assert.equal(chain.blocks.length,1);
assert.equal(chain.blocks[0].compressedSize,32);
assert.equal(chain.blocks[0].nextBlockSize,0);
assert.equal(chain.terminated,true);
assert.equal(chain.bytesConsumed,N.BLOCK_HEADER_SIZE+32);

const truncated=payload.slice(0,16);
assert.throws(()=>N.walkBlockChain(truncated,info),/exceeds payload|truncated/i);
console.log('XEX NORMAL container framing tests passed');
