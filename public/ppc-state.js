(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.UCRPPCState=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const GPR_COUNT=32;
  const OFFSETS={
    GPR:0,
    PC:32*4,
    LR:33*4,
    CTR:34*4,
    CR:35*4,
    XER:36*4,
    RESERVED:37*4
  };
  const STATE_BYTES=256;
  const DEFAULT_RAM_OFFSET=0x10000;

  function ensureMemory(memory,pages=2){
    if(memory instanceof WebAssembly.Memory) return memory;
    return new WebAssembly.Memory({initial:Math.max(2,pages)});
  }

  function create({memory,pages=2,stateOffset=0,ramOffset=DEFAULT_RAM_OFFSET}={}){
    const mem=ensureMemory(memory,pages);
    if(stateOffset<0||ramOffset<stateOffset+STATE_BYTES) throw new Error('Invalid PPC state/RAM layout');
    if(ramOffset>=mem.buffer.byteLength) throw new Error('RAM offset exceeds WebAssembly memory');
    const view=new DataView(mem.buffer);
    const state={memory:mem,stateOffset:stateOffset>>>0,ramOffset:ramOffset>>>0};
    reset(state);
    return state;
  }

  function addr(state,offset){return (state.stateOffset+offset)>>>0}
  function getGpr(state,index){if(index<0||index>=GPR_COUNT)throw new Error('GPR index must be 0..31');return new DataView(state.memory.buffer).getUint32(addr(state,OFFSETS.GPR+index*4),true)>>>0}
  function setGpr(state,index,value){if(index<0||index>=GPR_COUNT)throw new Error('GPR index must be 0..31');new DataView(state.memory.buffer).setUint32(addr(state,OFFSETS.GPR+index*4),value>>>0,true);return value>>>0}
  function getSpecial(state,name){const key=String(name).toUpperCase();if(!(key in OFFSETS)||key==='GPR'||key==='RESERVED')throw new Error(`Unknown PPC special register ${name}`);return new DataView(state.memory.buffer).getUint32(addr(state,OFFSETS[key]),true)>>>0}
  function setSpecial(state,name,value){const key=String(name).toUpperCase();if(!(key in OFFSETS)||key==='GPR'||key==='RESERVED')throw new Error(`Unknown PPC special register ${name}`);new DataView(state.memory.buffer).setUint32(addr(state,OFFSETS[key]),value>>>0,true);return value>>>0}

  function reset(state,{pc=0,stackPointer=null}={}){
    new Uint8Array(state.memory.buffer,state.stateOffset,STATE_BYTES).fill(0);
    setSpecial(state,'PC',pc>>>0);
    if(stackPointer!=null) setGpr(state,1,stackPointer>>>0);
    return state;
  }

  function snapshot(state){
    return {
      gpr:Array.from({length:GPR_COUNT},(_,i)=>getGpr(state,i)),
      pc:getSpecial(state,'PC'),lr:getSpecial(state,'LR'),ctr:getSpecial(state,'CTR'),cr:getSpecial(state,'CR'),xer:getSpecial(state,'XER'),
      stateOffset:state.stateOffset,ramOffset:state.ramOffset
    };
  }

  function restore(state,snap){
    for(let i=0;i<GPR_COUNT;i++) setGpr(state,i,(snap.gpr?.[i]||0)>>>0);
    for(const k of ['pc','lr','ctr','cr','xer']) if(snap[k]!=null) setSpecial(state,k,snap[k]);
    return state;
  }

  function copyTo(state,address,bytes){
    const src=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
    const p=(state.ramOffset+(address>>>0))>>>0;
    if(p+src.length>state.memory.buffer.byteLength) throw new Error('Guest write exceeds shared memory');
    new Uint8Array(state.memory.buffer,p,src.length).set(src);
  }

  function copyFrom(state,address,length){
    const p=(state.ramOffset+(address>>>0))>>>0;
    if(p+length>state.memory.buffer.byteLength) throw new Error('Guest read exceeds shared memory');
    return new Uint8Array(state.memory.buffer.slice(p,p+length));
  }

  function describe(){return {gprCount:GPR_COUNT,stateBytes:STATE_BYTES,ramOffset:DEFAULT_RAM_OFFSET,offsets:{...OFFSETS},endianness:{state:'little-endian host ABI',guestMemory:'PowerPC big-endian semantics'}}}

  return {GPR_COUNT,OFFSETS,STATE_BYTES,DEFAULT_RAM_OFFSET,create,reset,getGpr,setGpr,getSpecial,setSpecial,snapshot,restore,copyTo,copyFrom,describe};
});
