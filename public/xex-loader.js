(function(root,factory){
  const X=(typeof module==='object'&&module.exports)?require('./xex-parser.js'):root.UCRXEX;
  const api=factory(X);
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.UCRXEXLoader=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(X){
  'use strict';
  if(!X) throw new Error('xex-parser.js is required');
  const ENCRYPTION={NONE:0,NORMAL:1};
  const COMPRESSION={NONE:0,BASIC:1,NORMAL:2,DELTA:3};
  const hex=v=>'0x'+(v>>>0).toString(16).padStart(8,'0');

  function inspect(buffer){
    const bytes=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);
    const xex=X.parse(bytes),fileFormat=X.parseFileFormatInfo(bytes,xex);
    const supportedImagePath=!!fileFormat&&fileFormat.encryptionType===ENCRYPTION.NONE&&(fileFormat.compressionType===COMPRESSION.NONE||fileFormat.compressionType===COMPRESSION.BASIC);
    return {xex,fileFormat,supportedImagePath,payloadOffset:xex.headerSize,payloadLength:Math.max(0,bytes.length-xex.headerSize)};
  }

  function expandBasic(payload,fileFormat){
    if(!fileFormat.blocks) throw new Error('BASIC compression metadata missing block table');
    if(fileFormat.totalDataSize>payload.length) throw new Error('BASIC compressed payload is truncated');
    const out=new Uint8Array(fileFormat.totalOutputSize);
    let src=0,dst=0;
    for(const block of fileFormat.blocks){
      if(src+block.dataSize>payload.length) throw new Error(`BASIC block ${block.index} exceeds payload`);
      out.set(payload.subarray(src,src+block.dataSize),dst);
      src+=block.dataSize;
      dst+=block.dataSize+block.zeroSize;
    }
    return out;
  }

  function loadImage(buffer){
    const bytes=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer),meta=inspect(bytes);
    if(!meta.fileFormat) throw new Error('XEX has no FILE_FORMAT_INFO optional header');
    if(meta.fileFormat.encryptionType!==ENCRYPTION.NONE) throw new Error(`Encrypted XEX images are not supported yet (encryption=${meta.fileFormat.encryptionType})`);
    if(![COMPRESSION.NONE,COMPRESSION.BASIC].includes(meta.fileFormat.compressionType)) throw new Error(`XEX compression type ${meta.fileFormat.compressionType} is not supported yet`);
    if(meta.xex.headerSize>bytes.length) throw new Error('XEX header size exceeds file length');
    if(meta.xex.imageBase==null) throw new Error('XEX image base is missing');
    if(meta.xex.entryPoint==null) throw new Error('XEX entry point is missing');
    const payload=bytes.slice(meta.xex.headerSize);
    const image=meta.fileFormat.compressionType===COMPRESSION.BASIC?expandBasic(payload,meta.fileFormat):payload;
    const entryOffset=(meta.xex.entryPoint-meta.xex.imageBase)>>>0;
    if(meta.xex.entryPoint<meta.xex.imageBase||entryOffset>=image.length) throw new Error(`Entry point ${hex(meta.xex.entryPoint)} is outside loaded image ${hex(meta.xex.imageBase)} + ${image.length} bytes`);
    return {...meta,image,virtualBase:meta.xex.imageBase>>>0,entryPoint:meta.xex.entryPoint>>>0,entryOffset};
  }

  function virtualToOffset(loaded,address){address>>>=0;if(address<loaded.virtualBase)return-1;const off=(address-loaded.virtualBase)>>>0;return off<loaded.image.length?off:-1}
  function sliceAtVirtual(loaded,address,length){const off=virtualToOffset(loaded,address);if(off<0)throw new Error(`Virtual address ${hex(address)} is outside image`);return loaded.image.slice(off,Math.min(loaded.image.length,off+length))}
  function entrySlice(loaded,length=4096){return sliceAtVirtual(loaded,loaded.entryPoint,length)}

  function buildSynthetic({imageBase=0x82000000,entryOffset=0x20,payloadSize=0x100,compression=COMPRESSION.NONE,zeroGap=0x10}={}){
    const ffSize=compression===COMPRESSION.BASIC?16:8,headerSize=0x90,ffOff=0x60,count=4;
    if(entryOffset<0||entryOffset>=payloadSize) throw new Error('entryOffset outside payload');
    const raw=new Uint8Array(payloadSize);const putRaw=(o,v)=>{raw[o]=v>>>24;raw[o+1]=v>>>16;raw[o+2]=v>>>8;raw[o+3]=v};
    const words=[0x38600028,0x38630002,0x4e800020];words.forEach((w,i)=>putRaw(entryOffset+i*4,w));
    let payload=raw;
    let dataSize=payloadSize;
    if(compression===COMPRESSION.BASIC){
      const gapStart=Math.max(entryOffset+12,0x40),gap=Math.min(zeroGap,Math.max(0,payloadSize-gapStart));
      raw.fill(0,gapStart,gapStart+gap);
      payload=new Uint8Array(payloadSize-gap);payload.set(raw.subarray(0,gapStart),0);payload.set(raw.subarray(gapStart+gap),gapStart);
      dataSize=payload.length;
    }
    const b=new Uint8Array(headerSize+payload.length);const put=(o,v)=>{b[o]=v>>>24;b[o+1]=v>>>16;b[o+2]=v>>>8;b[o+3]=v};
    b.set([0x58,0x45,0x58,0x32],0);put(4,1);put(8,headerSize);put(12,0);put(16,0x40);put(20,count);
    let o=0x18;put(o,X.KEYS.ENTRY_POINT);put(o+4,(imageBase+entryOffset)>>>0);o+=8;put(o,X.KEYS.IMAGE_BASE);put(o+4,imageBase);o+=8;put(o,X.KEYS.DEFAULT_STACK_SIZE);put(o+4,0x40000);o+=8;put(o,X.KEYS.FILE_FORMAT_INFO);put(o+4,ffOff);
    put(ffOff,ffSize);b[ffOff+4]=0;b[ffOff+5]=0;b[ffOff+6]=0;b[ffOff+7]=compression;
    if(compression===COMPRESSION.BASIC){put(ffOff+8,dataSize);put(ffOff+12,payloadSize-dataSize)}
    b.set(payload,headerSize);return b;
  }

  const makeSyntheticUncompressed=opts=>buildSynthetic({...opts,compression:COMPRESSION.NONE});
  const makeSyntheticBasic=opts=>buildSynthetic({...opts,compression:COMPRESSION.BASIC});

  return {ENCRYPTION,COMPRESSION,inspect,expandBasic,loadImage,virtualToOffset,sliceAtVirtual,entrySlice,makeSyntheticUncompressed,makeSyntheticBasic};
});
