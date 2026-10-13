(function(root,factory){
  const X=(typeof module==='object'&&module.exports)?require('./xex-parser.js'):root.UCRXEX;
  const N=(typeof module==='object'&&module.exports)?require('./xex-normal.js'):root.UCRXEXNormal;
  const L=(typeof module==='object'&&module.exports)?require('./lzx.js'):root.UCRLZX;
  const api=factory(X,N,L);
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.UCRXEXLoader=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(X,N,L){
  'use strict';
  if(!X||!N||!L) throw new Error('xex-parser.js, xex-normal.js and lzx.js are required');
  const ENCRYPTION={NONE:0,NORMAL:1};
  const COMPRESSION={NONE:0,BASIC:1,NORMAL:2,DELTA:3};
  const LOADABLE=[COMPRESSION.NONE,COMPRESSION.BASIC,COMPRESSION.NORMAL];
  const hex=v=>'0x'+(v>>>0).toString(16).padStart(8,'0');

  function inspect(buffer){
    const bytes=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);
    const xex=X.parse(bytes),fileFormat=X.parseFileFormatInfo(bytes,xex);
    const supportedImagePath=!!fileFormat&&fileFormat.encryptionType===ENCRYPTION.NONE&&LOADABLE.includes(fileFormat.compressionType);
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
    if(!LOADABLE.includes(meta.fileFormat.compressionType)) throw new Error(`XEX compression type ${meta.fileFormat.compressionType} is not supported yet`);
    if(meta.xex.headerSize>bytes.length) throw new Error('XEX header size exceeds file length');
    if(meta.xex.imageBase==null) throw new Error('XEX image base is missing');
    if(meta.xex.entryPoint==null) throw new Error('XEX entry point is missing');
    const payload=bytes.slice(meta.xex.headerSize);
    const compression=meta.fileFormat.compressionType;
    const image=compression===COMPRESSION.BASIC?expandBasic(payload,meta.fileFormat)
      :compression===COMPRESSION.NORMAL?N.decompressImage(payload,N.parseNormalInfo(bytes,meta.xex),{imageSize:meta.xex.imageSize})
      :payload;
    const entryOffset=(meta.xex.entryPoint-meta.xex.imageBase)>>>0;
    if(meta.xex.entryPoint<meta.xex.imageBase||entryOffset>=image.length) throw new Error(`Entry point ${hex(meta.xex.entryPoint)} is outside loaded image ${hex(meta.xex.imageBase)} + ${image.length} bytes`);
    return {...meta,image,virtualBase:meta.xex.imageBase>>>0,entryPoint:meta.xex.entryPoint>>>0,entryOffset};
  }

  function virtualToOffset(loaded,address){address>>>=0;if(address<loaded.virtualBase)return-1;const off=(address-loaded.virtualBase)>>>0;return off<loaded.image.length?off:-1}
  function sliceAtVirtual(loaded,address,length){const off=virtualToOffset(loaded,address);if(off<0)throw new Error(`Virtual address ${hex(address)} is outside image`);return loaded.image.slice(off,Math.min(loaded.image.length,off+length))}
  function entrySlice(loaded,length=4096){return sliceAtVirtual(loaded,loaded.entryPoint,length)}

  // NORMAL payload: LZX stream split into size-prefixed chunks across a chain of blocks.
  function buildNormalPayload(stream,{chunkSize=0x8000,blocks=1}={}){
    const chunks=[];for(let p=0;p<stream.length;p+=chunkSize) chunks.push(stream.subarray(p,p+chunkSize));
    const perBlock=Math.max(1,Math.ceil(chunks.length/blocks)),groups=[];
    for(let i=0;i<chunks.length;i+=perBlock) groups.push(chunks.slice(i,i+perBlock));
    if(!groups.length) groups.push([]);
    const datas=groups.map(g=>{const d=new Uint8Array(g.reduce((n,c)=>n+2+c.length,2));let p=0;for(const c of g){d[p]=c.length>>>8;d[p+1]=c.length;d.set(c,p+2);p+=2+c.length}return d});
    const sizes=datas.map(d=>N.BLOCK_HEADER_SIZE+d.length);
    const out=new Uint8Array(sizes.reduce((a,b)=>a+b,0));
    let p=0;
    datas.forEach((d,i)=>{const next=sizes[i+1]||0;out[p]=next>>>24;out[p+1]=next>>>16;out[p+2]=next>>>8;out[p+3]=next;out.set(d,p+N.BLOCK_HEADER_SIZE);p+=sizes[i]});
    return {payload:out,firstBlockSize:sizes[0]};
  }

  function buildSynthetic({imageBase=0x82000000,entryOffset=0x20,payloadSize=0x100,compression=COMPRESSION.NONE,zeroGap=0x10,windowSize=0x8000,lzxStream=null,image=null,chunkSize=0x8000,blocks=1}={}){
    const ffSize=compression===COMPRESSION.BASIC?16:compression===COMPRESSION.NORMAL?36:8,headerSize=0x90,ffOff=0x60,count=4;
    if(image) payloadSize=image.length;
    if(entryOffset<0||entryOffset>=payloadSize) throw new Error('entryOffset outside payload');
    const raw=image?Uint8Array.from(image):new Uint8Array(payloadSize);const putRaw=(o,v)=>{raw[o]=v>>>24;raw[o+1]=v>>>16;raw[o+2]=v>>>8;raw[o+3]=v};
    if(!image){const words=[0x38600028,0x38630002,0x4e800020];words.forEach((w,i)=>putRaw(entryOffset+i*4,w))}
    let payload=raw;
    let dataSize=payloadSize;
    if(compression===COMPRESSION.BASIC){
      const gapStart=Math.max(entryOffset+12,0x40),gap=Math.min(zeroGap,Math.max(0,payloadSize-gapStart));
      raw.fill(0,gapStart,gapStart+gap);
      payload=new Uint8Array(payloadSize-gap);payload.set(raw.subarray(0,gapStart),0);payload.set(raw.subarray(gapStart+gap),gapStart);
      dataSize=payload.length;
    }
    let firstBlockSize=0;
    if(compression===COMPRESSION.NORMAL){
      const built=buildNormalPayload(lzxStream||L.storeUncompressed(raw),{chunkSize,blocks});
      payload=built.payload;firstBlockSize=built.firstBlockSize;
    }
    const b=new Uint8Array(headerSize+payload.length);const put=(o,v)=>{b[o]=v>>>24;b[o+1]=v>>>16;b[o+2]=v>>>8;b[o+3]=v};
    b.set([0x58,0x45,0x58,0x32],0);put(4,1);put(8,headerSize);put(12,0);put(16,0x40);put(20,count);put(0x44,payloadSize);
    let o=0x18;put(o,X.KEYS.ENTRY_POINT);put(o+4,(imageBase+entryOffset)>>>0);o+=8;put(o,X.KEYS.IMAGE_BASE);put(o+4,imageBase);o+=8;put(o,X.KEYS.DEFAULT_STACK_SIZE);put(o+4,0x40000);o+=8;put(o,X.KEYS.FILE_FORMAT_INFO);put(o+4,ffOff);
    put(ffOff,ffSize);b[ffOff+4]=0;b[ffOff+5]=0;b[ffOff+6]=0;b[ffOff+7]=compression;
    if(compression===COMPRESSION.BASIC){put(ffOff+8,dataSize);put(ffOff+12,payloadSize-dataSize)}
    if(compression===COMPRESSION.NORMAL){put(ffOff+8,windowSize);put(ffOff+12,firstBlockSize)}
    b.set(payload,headerSize);return b;
  }

  const makeSyntheticUncompressed=opts=>buildSynthetic({...opts,compression:COMPRESSION.NONE});
  const makeSyntheticBasic=opts=>buildSynthetic({...opts,compression:COMPRESSION.BASIC});
  const makeSyntheticNormal=opts=>buildSynthetic({...opts,compression:COMPRESSION.NORMAL});

  return {ENCRYPTION,COMPRESSION,inspect,expandBasic,loadImage,virtualToOffset,sliceAtVirtual,entrySlice,makeSyntheticUncompressed,makeSyntheticBasic,makeSyntheticNormal};
});
