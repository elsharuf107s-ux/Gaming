(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.UCRXEX=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const KEYS={ENTRY_POINT:0x00010100,IMAGE_BASE:0x00010201,ORIGINAL_BASE:0x00010001,DEFAULT_STACK_SIZE:0x00020200,DEFAULT_HEAP_SIZE:0x00020401,EXECUTION_INFO:0x00040006,FILE_FORMAT_INFO:0x000003ff};
  const hex=v=>'0x'+(v>>>0).toString(16).padStart(8,'0');
  const be16=(b,o)=>((b[o]<<8)|b[o+1])>>>0;
  const be32=(b,o)=>((b[o]<<24)|(b[o+1]<<16)|(b[o+2]<<8)|b[o+3])>>>0;

  function parse(buffer){
    const b=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);
    if(b.length<0x18) throw new Error('File too small for XEX2 header');
    if(String.fromCharCode(b[0],b[1],b[2],b[3])!=='XEX2') throw new Error('Not an XEX2 file');
    const moduleFlags=be32(b,4),headerSize=be32(b,8),reserved=be32(b,12),securityOffset=be32(b,16),headerCount=be32(b,20);
    if(headerCount>0x10000) throw new Error('Unreasonable XEX optional header count');
    if(0x18+headerCount*8>b.length) throw new Error('XEX optional header table is truncated');
    const optional=[];
    for(let i=0;i<headerCount;i++){
      const off=0x18+i*8,key=be32(b,off),value=be32(b,off+4),kind=key&0xff;
      optional.push({index:i,key,value,kind,tableOffset:off,mode:kind===0?'immediate':kind===1?'value-field':'offset',dataOffset:kind===0||kind===1?null:value});
    }
    const get=key=>optional.find(h=>h.key===key)||null;
    const immediate=key=>{const h=get(key);return h?h.value:null};
    return {format:'XEX2',moduleFlags,headerSize,reserved,securityOffset,headerCount,entryPoint:immediate(KEYS.ENTRY_POINT),imageBase:immediate(KEYS.IMAGE_BASE),originalBase:immediate(KEYS.ORIGINAL_BASE),defaultStackSize:immediate(KEYS.DEFAULT_STACK_SIZE),optionalHeaders:optional};
  }

  function getOptional(x,key){return x.optionalHeaders.find(h=>h.key===key)||null}

  function parseFileFormatInfo(buffer,xex){
    const b=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);
    const h=getOptional(xex,KEYS.FILE_FORMAT_INFO);
    if(!h) return null;
    const off=h.value>>>0;
    if(off+8>b.length) throw new Error('XEX file-format info is truncated');
    const infoSize=be32(b,off),encryptionType=be16(b,off+4),compressionType=be16(b,off+6);
    if(infoSize<8||off+infoSize>b.length) throw new Error('Invalid XEX file-format info size');
    const result={offset:off,infoSize,encryptionType,compressionType};
    if(compressionType===1){
      if((infoSize-8)%8!==0) throw new Error('Invalid XEX BASIC compression block table size');
      const blockCount=(infoSize-8)/8;
      const blocks=[];
      let totalOutputSize=0,totalDataSize=0;
      for(let i=0;i<blockCount;i++){
        const p=off+8+i*8;
        const dataSize=be32(b,p),zeroSize=be32(b,p+4);
        totalDataSize+=dataSize;totalOutputSize+=dataSize+zeroSize;
        if(totalOutputSize>0x80000000) throw new Error('Unreasonable BASIC decompressed size');
        blocks.push({index:i,dataSize,zeroSize});
      }
      Object.assign(result,{blockCount,blocks,totalDataSize,totalOutputSize});
    }
    return result;
  }

  function summarize(x){return {format:x.format,moduleFlags:hex(x.moduleFlags),headerSize:x.headerSize,securityOffset:hex(x.securityOffset),headerCount:x.headerCount,entryPoint:x.entryPoint==null?null:hex(x.entryPoint),imageBase:x.imageBase==null?null:hex(x.imageBase),originalBase:x.originalBase==null?null:hex(x.originalBase),defaultStackSize:x.defaultStackSize==null?null:x.defaultStackSize}}

  function makeSynthetic({entryPoint=0x82001000,imageBase=0x82000000,stackSize=0x40000,includeFileFormat=false}={}){
    const count=includeFileFormat?4:3,ffOff=0x50,total=includeFileFormat?0x58:0x40;
    const b=new Uint8Array(total);b.set([0x58,0x45,0x58,0x32],0);
    const put=(o,v)=>{b[o]=v>>>24;b[o+1]=v>>>16;b[o+2]=v>>>8;b[o+3]=v};
    b[7]=1;put(8,0x40);put(12,0);put(16,0x100);put(20,count);
    let o=0x18;put(o,KEYS.ENTRY_POINT);put(o+4,entryPoint);o+=8;put(o,KEYS.IMAGE_BASE);put(o+4,imageBase);o+=8;put(o,KEYS.DEFAULT_STACK_SIZE);put(o+4,stackSize);o+=8;
    if(includeFileFormat){put(o,KEYS.FILE_FORMAT_INFO);put(o+4,ffOff);put(ffOff,8)}
    return b;
  }

  return {KEYS,parse,getOptional,parseFileFormatInfo,summarize,makeSynthetic,be16,be32};
});
