(function(root,factory){
  const S=(typeof module==='object'&&module.exports)?require('./ppc-state.js'):root.UCRPPCState;
  const api=factory(S);
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.UCRXboxRuntime=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(S){
  'use strict';
  if(!S) throw new Error('ppc-state.js is required');

  const STATUS_SUCCESS=0;
  const XBOXKRNL_ORDINALS={
    KeQueryPerformanceFrequency:0x83,
    KeQuerySystemTime:0x84,
    MmAllocatePhysicalMemory:0xB9,
    MmAllocatePhysicalMemoryEx:0xBA,
    MmFreePhysicalMemory:0xBD,
    NtAllocateVirtualMemory:0xCC,
    NtClose:0xCF
  };
  const GUEST_TICK_FREQUENCY=50000000;
  const normModule=m=>String(m||'').toLowerCase().replace(/\.exe$|\.xex$/,'');
  const key=(module,ordinal)=>`${normModule(module)}:${ordinal>>>0}`;
  const hex=v=>'0x'+(v>>>0).toString(16).padStart(8,'0');

  function create({state,trace=false}={}){
    if(!state) throw new Error('Shared PPC state is required');
    const exportsByOrdinal=new Map();
    const thunks=new Map();
    const events=[];

    function record(event){if(trace) events.push({...event,time:Date.now()})}
    function register(module,ordinal,name,handler){
      if(typeof handler!=='function') throw new Error('Xbox export handler must be a function');
      const item={module:normModule(module),ordinal:ordinal>>>0,name:String(name),handler};
      exportsByOrdinal.set(key(module,ordinal),item);
      return item;
    }
    function bindThunk(address,module,ordinal){
      const item=exportsByOrdinal.get(key(module,ordinal));
      if(!item) throw new Error(`Unknown Xbox export ${module}!${ordinal}`);
      thunks.set(address>>>0,item);
      return item;
    }
    function resolveAddress(address){return thunks.get(address>>>0)||null}
    function dispatchAddress(address,returnAddress){
      address>>>=0; returnAddress>>>=0;
      const item=resolveAddress(address);
      if(!item) throw new Error(`Unresolved Xbox import thunk ${hex(address)}`);
      record({type:'call',address,returnAddress,module:item.module,ordinal:item.ordinal,name:item.name});
      const result=item.handler({state,address,returnAddress,runtime:api});
      if(result!=null) S.setGpr(state,3,result>>>0);
      record({type:'return',address,name:item.name,r3:S.getGpr(state,3)});
      return S.getGpr(state,3);
    }
    function listExports(){return [...exportsByOrdinal.values()].map(x=>({module:x.module,ordinal:x.ordinal,name:x.name}))}
    function listThunks(){return [...thunks.entries()].map(([address,x])=>({address,module:x.module,ordinal:x.ordinal,name:x.name}))}

    const api={state,register,bindThunk,resolveAddress,dispatchAddress,listExports,listThunks,events};

    register('xboxkrnl',XBOXKRNL_ORDINALS.KeQueryPerformanceFrequency,'KeQueryPerformanceFrequency',()=>GUEST_TICK_FREQUENCY);

    return api;
  }

  return {STATUS_SUCCESS,XBOXKRNL_ORDINALS,GUEST_TICK_FREQUENCY,create};
});
