(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.UCRPE=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const IMAGE_SCN_CNT_CODE=0x00000020;
  const IMAGE_SCN_MEM_EXECUTE=0x20000000;
  const IMAGE_SCN_MEM_READ=0x40000000;
  const IMAGE_SCN_MEM_WRITE=0x80000000;
  const u16=(b,o)=>b[o]|(b[o+1]<<8);
  const u32=(b,o)=>(b[o]|(b[o+1]<<8)|(b[o+2]<<16)|(b[o+3]<<24))>>>0;
  const ascii=(b,o,n)=>{let s='';for(let i=0;i<n&&b[o+i];i++)s+=String.fromCharCode(b[o+i]);return s};
  const hex=v=>'0x'+(v>>>0).toString(16).padStart(8,'0');

  function parse(image){
    const b=image instanceof Uint8Array?image:new Uint8Array(image);
    if(b.length<0x40) throw new Error('Image too small for DOS header');
    if(b[0]!==0x4d||b[1]!==0x5a) throw new Error('Missing MZ header');
    const peOffset=u32(b,0x3c);
    if(peOffset+24>b.length) throw new Error('PE header outside image');
    if(b[peOffset]!==0x50||b[peOffset+1]!==0x45||b[peOffset+2]!==0||b[peOffset+3]!==0) throw new Error('Missing PE signature');
    const coff=peOffset+4;
    const machine=u16(b,coff);
    const numberOfSections=u16(b,coff+2);
    const timeDateStamp=u32(b,coff+4);
    const sizeOfOptionalHeader=u16(b,coff+16);
    const characteristics=u16(b,coff+18);
    const optional=coff+20;
    if(optional+sizeOfOptionalHeader>b.length) throw new Error('Optional header truncated');
    const magic=sizeOfOptionalHeader>=2?u16(b,optional):0;
    const isPE32=magic===0x10b;
    const isPE32Plus=magic===0x20b;
    if(!isPE32&&!isPE32Plus) throw new Error(`Unsupported PE optional-header magic 0x${magic.toString(16)}`);
    const addressOfEntryPoint=sizeOfOptionalHeader>=20?u32(b,optional+16):0;
    const imageBase=isPE32Plus
      ? (u32(b,optional+24) + u32(b,optional+28)*0x100000000)
      : u32(b,optional+28);
    const sectionAlignment=isPE32Plus?u32(b,optional+32):u32(b,optional+32);
    const fileAlignment=isPE32Plus?u32(b,optional+36):u32(b,optional+36);
    const sizeOfImage=u32(b,optional+56);
    const sizeOfHeaders=u32(b,optional+60);
    const table=optional+sizeOfOptionalHeader;
    if(numberOfSections>96) throw new Error('Unreasonable PE section count');
    if(table+numberOfSections*40>b.length) throw new Error('PE section table truncated');
    const sections=[];
    for(let i=0;i<numberOfSections;i++){
      const o=table+i*40;
      const name=ascii(b,o,8);
      const virtualSize=u32(b,o+8);
      const virtualAddress=u32(b,o+12);
      const sizeOfRawData=u32(b,o+16);
      const pointerToRawData=u32(b,o+20);
      const flags=u32(b,o+36);
      const containsCode=!!(flags&IMAGE_SCN_CNT_CODE);
      const executable=!!(flags&IMAGE_SCN_MEM_EXECUTE);
      sections.push({index:i,name,virtualSize,virtualAddress,sizeOfRawData,pointerToRawData,flags,containsCode,executable,readable:!!(flags&IMAGE_SCN_MEM_READ),writable:!!(flags&IMAGE_SCN_MEM_WRITE)});
    }
    return {format:'PE',peOffset,machine,numberOfSections,timeDateStamp,sizeOfOptionalHeader,characteristics,magic,isPE32,isPE32Plus,addressOfEntryPoint,imageBase,sectionAlignment,fileAlignment,sizeOfImage,sizeOfHeaders,sections};
  }

  function rvaToOffset(pe,rva){
    rva>>>=0;
    if(rva<pe.sizeOfHeaders) return rva;
    for(const s of pe.sections){
      const span=Math.max(s.virtualSize,s.sizeOfRawData);
      if(rva>=s.virtualAddress&&rva<s.virtualAddress+span){
        const delta=rva-s.virtualAddress;
        if(delta>=s.sizeOfRawData) return -1;
        return s.pointerToRawData+delta;
      }
    }
    return -1;
  }

  function executableSections(pe){return pe.sections.filter(s=>s.executable||s.containsCode)}
  function summarize(pe){return {machine:'0x'+pe.machine.toString(16).padStart(4,'0'),sections:pe.numberOfSections,entryRva:hex(pe.addressOfEntryPoint),imageBase:'0x'+Math.trunc(pe.imageBase).toString(16),sizeOfImage:pe.sizeOfImage,executableSections:executableSections(pe).map(s=>({name:s.name,rva:hex(s.virtualAddress),virtualSize:s.virtualSize,rawOffset:s.pointerToRawData,rawSize:s.sizeOfRawData,flags:hex(s.flags)}))}}

  function putName(b,o,name){for(let i=0;i<8;i++)b[o+i]=i<name.length?name.charCodeAt(i):0}
  function makeSynthetic(){
    const b=new Uint8Array(0x600); const put16=(o,v)=>{b[o]=v;b[o+1]=v>>>8}; const put32=(o,v)=>{b[o]=v;b[o+1]=v>>>8;b[o+2]=v>>>16;b[o+3]=v>>>24};
    b[0]=0x4d;b[1]=0x5a;put32(0x3c,0x80);
    b.set([0x50,0x45,0,0],0x80); const coff=0x84;
    put16(coff,0x01f2);put16(coff+2,2);put16(coff+16,0xe0);put16(coff+18,0x0002);
    const opt=coff+20;put16(opt,0x10b);put32(opt+16,0x1000);put32(opt+28,0x82000000);put32(opt+32,0x1000);put32(opt+36,0x200);put32(opt+56,0x3000);put32(opt+60,0x200);
    let s=opt+0xe0;putName(b,s,'.text');put32(s+8,0x100);put32(s+12,0x1000);put32(s+16,0x200);put32(s+20,0x200);put32(s+36,0x60000020);
    s+=40;putName(b,s,'.data');put32(s+8,0x80);put32(s+12,0x2000);put32(s+16,0x200);put32(s+20,0x400);put32(s+36,0xc0000040);
    return b;
  }

  return {parse,rvaToOffset,executableSections,summarize,makeSynthetic,IMAGE_SCN_CNT_CODE,IMAGE_SCN_MEM_EXECUTE};
});
