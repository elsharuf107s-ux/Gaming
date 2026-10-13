(function(root,factory){
  const X=(typeof module==='object'&&module.exports)?require('./xex-parser.js'):root.UCRXEX;
  const api=factory(X);
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.UCRXEXImports=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(X){
  'use strict';
  if(!X) throw new Error('xex-parser.js is required');

  const IMPORT_LIBRARIES_KEY=0x000103ff;
  const hex=v=>'0x'+(v>>>0).toString(16).padStart(8,'0');
  const be16=(b,o)=>((b[o]<<8)|b[o+1])>>>0;
  const be32=(b,o)=>((b[o]<<24)|(b[o+1]<<16)|(b[o+2]<<8)|b[o+3])>>>0;

  function readStrings(bytes,start,size,count){
    const end=start+size;
    if(end>bytes.length) throw new Error('XEX import string table is truncated');
    const strings=[];let p=start;
    while(p<end&&strings.length<count){
      let q=p;while(q<end&&bytes[q]!==0)q++;
      strings.push(new TextDecoder().decode(bytes.subarray(p,q)));
      p=q+1;
    }
    if(strings.length<count) throw new Error('XEX import string count exceeds string table contents');
    return strings;
  }

  function parse(buffer,xex=null){
    const b=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);
    const header=xex||X.parse(b);
    const opt=X.getOptional(header,IMPORT_LIBRARIES_KEY);
    if(!opt) return {present:false,offset:null,size:0,strings:[],libraries:[]};
    const off=opt.value>>>0;
    if(off+12>b.length) throw new Error('XEX import-libraries header is truncated');
    const size=be32(b,off),stringTableSize=be32(b,off+4),stringCount=be32(b,off+8);
    if(size<12||off+size>b.length) throw new Error('Invalid XEX import-libraries size');
    if(12+stringTableSize>size) throw new Error('Invalid XEX import string-table size');
    if(stringCount>0x10000) throw new Error('Unreasonable XEX import string count');
    const strings=readStrings(b,off+12,stringTableSize,stringCount);
    const libraries=[];
    let rel=12+stringTableSize;
    while(rel<size){
      const p=off+rel;
      if(p+0x28>off+size) throw new Error('XEX import library header is truncated');
      const libSize=be32(b,p);
      if(!libSize) break;
      if(libSize<0x28||rel+libSize>size) throw new Error('Invalid XEX import library size');
      const id=be32(b,p+0x18),version=be32(b,p+0x1c),versionMin=be32(b,p+0x20),nameIndexRaw=be16(b,p+0x24),count=be16(b,p+0x26),nameIndex=nameIndexRaw&0xff;
      if(nameIndex>=strings.length) throw new Error(`XEX import library name index ${nameIndex} is outside string table`);
      if(0x28+count*4>libSize) throw new Error('XEX import table exceeds library record');
      const records=[];
      for(let i=0;i<count;i++) records.push(be32(b,p+0x28+i*4));
      libraries.push({index:libraries.length,offset:p,size:libSize,id,version,versionMin,nameIndexRaw,nameIndex,name:strings[nameIndex],count,records});
      rel+=libSize;
    }
    return {present:true,offset:off,size,stringTableSize,stringCount,strings,libraries};
  }

  function virtualToOffset(loaded,address){
    address>>>=0;
    if(!loaded||!loaded.image) return -1;
    const base=(loaded.virtualBase??loaded.imageBase??0)>>>0;
    if(address<base)return-1;
    const off=(address-base)>>>0;
    return off+4<=loaded.image.length?off:-1;
  }

  function resolveRecords(parsed,loaded){
    const image=loaded.image instanceof Uint8Array?loaded.image:new Uint8Array(loaded.image);
    const libraries=parsed.libraries.map(lib=>{
      const rawRecords=[];const imports=[];let pending=null;
      for(const address of lib.records){
        const off=virtualToOffset(loaded,address);
        if(off<0){rawRecords.push({address,value:null,recordType:null,ordinal:null,mapped:false});continue}
        const value=be32(image,off),recordType=(value>>>24)&0xff,ordinal=value&0xffff;
        const rec={address:address>>>0,value,recordType,ordinal,mapped:true};rawRecords.push(rec);
        if(recordType===0){
          pending={ordinal,valueAddress:address>>>0,thunkAddress:null};
          imports.push(pending);
        }else if(recordType===1){
          const match=pending&&pending.ordinal===ordinal?pending:[...imports].reverse().find(x=>x.ordinal===ordinal&&!x.thunkAddress);
          if(match) match.thunkAddress=address>>>0;
          else imports.push({ordinal,valueAddress:null,thunkAddress:address>>>0});
        }
      }
      return {...lib,rawRecords,imports};
    });
    return {...parsed,libraries};
  }

  function bindKnownImports(resolved,runtime){
    if(!runtime||typeof runtime.bindThunk!=='function') throw new Error('Xbox runtime with bindThunk is required');
    const bound=[],unresolved=[];
    for(const lib of resolved.libraries){
      for(const imp of lib.imports||[]){
        if(imp.thunkAddress==null){unresolved.push({module:lib.name,ordinal:imp.ordinal,reason:'no thunk address'});continue}
        try{
          const item=runtime.bindThunk(imp.thunkAddress,lib.name,imp.ordinal);
          bound.push({module:lib.name,ordinal:imp.ordinal,name:item.name,thunkAddress:imp.thunkAddress});
        }catch(error){unresolved.push({module:lib.name,ordinal:imp.ordinal,thunkAddress:imp.thunkAddress,reason:error.message})}
      }
    }
    return {bound,unresolved};
  }

  function summarize(parsed){return {present:parsed.present,size:parsed.size,stringCount:parsed.stringCount,strings:parsed.strings,libraries:parsed.libraries.map(l=>({name:l.name,id:hex(l.id),count:l.count,records:l.records.map(hex),imports:(l.imports||[]).map(i=>({ordinal:i.ordinal,valueAddress:i.valueAddress==null?null:hex(i.valueAddress),thunkAddress:i.thunkAddress==null?null:hex(i.thunkAddress)}))}))}}

  return {IMPORT_LIBRARIES_KEY,parse,resolveRecords,bindKnownImports,summarize,virtualToOffset};
});
