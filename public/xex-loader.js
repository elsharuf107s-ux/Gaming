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
    const xex=X.parse(bytes);
    const fileFormat=X.parseFileFormatInfo(bytes,xex);
    return {
      xex,fileFormat,
      supportedImagePath:!!fileFormat && fileFormat.encryptionType===ENCRYPTION.NONE && fileFormat.compressionType===COMPRESSION.NONE,
      payloadOffset:xex.headerSize,
      payloadLength:Math.max(0,bytes.length-xex.headerSize)
    };
  }

  function loadImage(buffer){
    const bytes=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);
    const meta=inspect(bytes);
    if(!meta.fileFormat) throw new Error('XEX has no FILE_FORMAT_INFO optional header');
    if(meta.fileFormat.encryptionType!==ENCRYPTION.NONE){
      throw new Error(`Encrypted XEX images are not supported yet (encryption=${meta.fileFormat.encryptionType})`);
    }
    if(meta.fileFormat.compressionType!==COMPRESSION.NONE){
      throw new Error(`Compressed XEX images are not supported yet (compression=${meta.fileFormat.compressionType})`);
    }
    if(meta.xex.headerSize>bytes.length) throw new Error('XEX header size exceeds file length');
    if(meta.xex.imageBase==null) throw new Error('XEX image base is missing');
    if(meta.xex.entryPoint==null) throw new Error('XEX entry point is missing');
    const image=bytes.slice(meta.xex.headerSize);
    const entryOffset=(meta.xex.entryPoint-meta.xex.imageBase)>>>0;
    if(meta.xex.entryPoint<meta.xex.imageBase || entryOffset>=image.length){
      throw new Error(`Entry point ${hex(meta.xex.entryPoint)} is outside loaded image ${hex(meta.xex.imageBase)} + ${image.length} bytes`);
    }
    return {
      ...meta,
      image,
      virtualBase:meta.xex.imageBase>>>0,
      entryPoint:meta.xex.entryPoint>>>0,
      entryOffset
    };
  }

  function virtualToOffset(loaded,address){
    address>>>=0;
    if(address<loaded.virtualBase) return -1;
    const off=(address-loaded.virtualBase)>>>0;
    return off<loaded.image.length?off:-1;
  }

  function sliceAtVirtual(loaded,address,length){
    const off=virtualToOffset(loaded,address);
    if(off<0) throw new Error(`Virtual address ${hex(address)} is outside image`);
    return loaded.image.slice(off,Math.min(loaded.image.length,off+length));
  }

  function entrySlice(loaded,length=4096){
    return sliceAtVirtual(loaded,loaded.entryPoint,length);
  }

  function makeSyntheticUncompressed({imageBase=0x82000000,entryOffset=0x20,payloadSize=0x100}={}){
    const headerSize=0x80, ffOff=0x60, count=4;
    if(entryOffset<0||entryOffset>=payloadSize) throw new Error('entryOffset outside payload');
    const b=new Uint8Array(headerSize+payloadSize);
    const put=(o,v)=>{b[o]=v>>>24;b[o+1]=v>>>16;b[o+2]=v>>>8;b[o+3]=v};
    b.set([0x58,0x45,0x58,0x32],0);
    put(4,1);put(8,headerSize);put(12,0);put(16,0x40);put(20,count);
    let o=0x18;
    put(o,X.KEYS.ENTRY_POINT);put(o+4,(imageBase+entryOffset)>>>0);o+=8;
    put(o,X.KEYS.IMAGE_BASE);put(o+4,imageBase);o+=8;
    put(o,X.KEYS.DEFAULT_STACK_SIZE);put(o+4,0x40000);o+=8;
    put(o,X.KEYS.FILE_FORMAT_INFO);put(o+4,ffOff);
    put(ffOff,8); // info size
    b[ffOff+4]=0;b[ffOff+5]=0; // encryption none
    b[ffOff+6]=0;b[ffOff+7]=0; // compression none
    // Put simple PPC instructions at entry: addi r3,r0,40; addi r3,r3,2
    const words=[0x38600028,0x38630002,0x4e800020];
    words.forEach((w,i)=>put(headerSize+entryOffset+i*4,w));
    return b;
  }

  return {ENCRYPTION,COMPRESSION,inspect,loadImage,virtualToOffset,sliceAtVirtual,entrySlice,makeSyntheticUncompressed};
});
