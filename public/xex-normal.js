(function(root,factory){
  const X=(typeof module==='object'&&module.exports)?require('./xex-parser.js'):root.UCRXEX;
  const api=factory(X);
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.UCRXEXNormal=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(X){
  'use strict';
  if(!X) throw new Error('xex-parser.js is required');
  const COMPRESSION_NORMAL=2;
  const BLOCK_HEADER_SIZE=24;

  function hexBytes(bytes){return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')}

  function parseNormalInfo(buffer,xex){
    const b=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);
    const h=X.getOptional(xex,X.KEYS.FILE_FORMAT_INFO);
    if(!h) return null;
    const off=h.value>>>0;
    if(off+36>b.length) throw new Error('XEX NORMAL file-format info is truncated');
    const infoSize=X.be32(b,off);
    const encryptionType=X.be16(b,off+4);
    const compressionType=X.be16(b,off+6);
    if(compressionType!==COMPRESSION_NORMAL) throw new Error('XEX is not NORMAL-compressed');
    if(infoSize<36||off+infoSize>b.length) throw new Error('Invalid NORMAL compression info size');
    const windowSize=X.be32(b,off+8);
    const firstBlockSize=X.be32(b,off+12);
    const firstBlockHash=b.slice(off+16,off+36);
    if(!windowSize||windowSize>0x2000000) throw new Error('Unreasonable LZX window size');
    return {offset:off,infoSize,encryptionType,compressionType,windowSize,firstBlock:{blockSize:firstBlockSize,hash:firstBlockHash,hashHex:hexBytes(firstBlockHash)}};
  }

  function parseBlockHeader(bytes,offset){
    if(offset+BLOCK_HEADER_SIZE>bytes.length) throw new Error('NORMAL block header truncated');
    const blockSize=X.be32(bytes,offset);
    const hash=bytes.slice(offset+4,offset+24);
    return {offset,blockSize,hash,hashHex:hexBytes(hash),dataOffset:offset+BLOCK_HEADER_SIZE};
  }

  function walkBlockChain(payload,normalInfo,{maxBlocks=4096}={}){
    const bytes=payload instanceof Uint8Array?payload:new Uint8Array(payload);
    const blocks=[];
    let expected=normalInfo.firstBlock;
    let offset=0;
    for(let i=0;i<maxBlocks&&expected.blockSize;i++){
      if(expected.blockSize>bytes.length-offset) throw new Error(`NORMAL block ${i} exceeds payload`);
      const blockEnd=offset+expected.blockSize;
      if(offset+BLOCK_HEADER_SIZE>blockEnd) throw new Error(`NORMAL block ${i} is smaller than its chained header`);
      const next=parseBlockHeader(bytes,offset);
      const compressedData=bytes.slice(next.dataOffset,blockEnd);
      blocks.push({index:i,offset,size:expected.blockSize,expectedHashHex:expected.hashHex,nextBlockSize:next.blockSize,nextHashHex:next.hashHex,compressedOffset:next.dataOffset,compressedSize:compressedData.length,compressedData});
      expected={blockSize:next.blockSize,hash:next.hash,hashHex:next.hashHex};
      offset=blockEnd;
    }
    if(blocks.length===maxBlocks&&expected.blockSize) throw new Error('NORMAL block chain exceeded maxBlocks');
    return {blocks,bytesConsumed:offset,terminated:expected.blockSize===0,nextBlock:expected};
  }

  function makeSyntheticNormal({windowSize=0x8000,blockDataSize=32}={}){
    const header=new Uint8Array(0x90+BLOCK_HEADER_SIZE+blockDataSize);
    const put32=(o,v)=>{header[o]=v>>>24;header[o+1]=v>>>16;header[o+2]=v>>>8;header[o+3]=v};
    header.set([0x58,0x45,0x58,0x32],0);put32(4,1);put32(8,0x90);put32(16,0x40);put32(20,4);
    let o=0x18;put32(o,X.KEYS.ENTRY_POINT);put32(o+4,0x82000000);o+=8;put32(o,X.KEYS.IMAGE_BASE);put32(o+4,0x82000000);o+=8;put32(o,X.KEYS.DEFAULT_STACK_SIZE);put32(o+4,0x40000);o+=8;put32(o,X.KEYS.FILE_FORMAT_INFO);put32(o+4,0x60);
    put32(0x60,36);header[0x66]=0;header[0x67]=2;put32(0x68,windowSize);put32(0x6c,BLOCK_HEADER_SIZE+blockDataSize);
    const p=0x90;put32(p,0);for(let i=0;i<blockDataSize;i++)header[p+BLOCK_HEADER_SIZE+i]=i&255;
    return header;
  }

  return {COMPRESSION_NORMAL,BLOCK_HEADER_SIZE,parseNormalInfo,parseBlockHeader,walkBlockChain,makeSyntheticNormal};
});
