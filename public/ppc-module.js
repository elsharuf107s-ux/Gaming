(function(root,factory){
  const PPC=(typeof module==='object'&&module.exports)?require('./ppc-core.js'):root.UCRPPC;
  const F=(typeof module==='object'&&module.exports)?require('./ppc-functions.js'):root.UCRPPCFunctions;
  const api=factory(PPC,F);
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.UCRPPCModule=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(PPC,F){
  'use strict';
  if(!PPC||!F) throw new Error('ppc-core.js and ppc-functions.js are required');
  const hex=v=>'0x'+(v>>>0).toString(16).padStart(8,'0');

  function normalizeFunctionInstructions(fn){
    const list=[...fn.instructions];
    while(list.length&&(list[list.length-1].op==='blr'||list[list.length-1].op==='bctr')) list.pop();
    return list.map(ins=>{
      if(ins.op==='bl') return {...ins,op:'unsupported',text:`direct call ${hex(ins.target)} requires function linker`};
      if(['mfspr','mtspr','stwu','lwzu','bclr','bcctr'].includes(ins.op)) return {...ins,op:'unsupported',text:`${ins.op} requires function ABI/runtime support`};
      return PPC.decodeWord(ins.word,ins.address);
    });
  }

  function compileDiscoveredFunction(fn,{resultRegister=3,memoryPages=1}={}){
    const decoded=normalizeFunctionInstructions(fn);
    if(!decoded.length) return {ok:false,address:fn.start>>>0,reason:'Function has no compilable body after return normalization'};
    try{
      const wasm=PPC.compileToWasm(decoded,{resultRegister,memoryPages});
      return {ok:true,address:fn.start>>>0,end:fn.end>>>0,resultRegister,wasm,instructionCount:decoded.length,frame:fn.frame,calls:fn.calls};
    }catch(error){
      return {ok:false,address:fn.start>>>0,end:fn.end>>>0,reason:error.message,instructionCount:decoded.length,frame:fn.frame,calls:fn.calls};
    }
  }

  function compileModule(buffer,{baseAddress=0,entryPoints=[baseAddress],resultRegister=3,memoryPages=1,maxInstructions=16384}={}){
    const bytes=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);
    const discovery=F.discoverFunctions(bytes,{baseAddress,entryPoints,maxInstructions});
    const functions=discovery.functions.map(fn=>compileDiscoveredFunction(fn,{resultRegister,memoryPages}));
    return {
      baseAddress:baseAddress>>>0,
      entryPoints:entryPoints.map(x=>x>>>0),
      discovered:discovery.functions.length,
      compiled:functions.filter(f=>f.ok).length,
      failed:functions.filter(f=>!f.ok).length,
      functions,
      callGraph:F.buildCallGraph(discovery)
    };
  }

  async function instantiateCompiled(compiled,imports={env:{runtimeCall:(id,arg)=>arg|0}}){
    if(!compiled.ok) throw new Error(compiled.reason||'Function did not compile');
    return PPC.instantiateWasm(compiled.wasm,{runtimeCall:imports?.env?.runtimeCall});
  }

  async function runCompiled(compiled,imports){
    const {instance}=await instantiateCompiled(compiled,imports);
    return instance.exports.run()|0;
  }

  function manifest(module){
    return {
      baseAddress:hex(module.baseAddress),
      discovered:module.discovered,
      compiled:module.compiled,
      failed:module.failed,
      functions:module.functions.map(f=>({address:hex(f.address),end:f.end==null?null:hex(f.end),ok:f.ok,instructionCount:f.instructionCount||0,reason:f.reason||null,wasmBytes:f.ok?f.wasm.length:0,frame:f.frame,calls:f.calls}))
    };
  }

  return {normalizeFunctionInstructions,compileDiscoveredFunction,compileModule,instantiateCompiled,runCompiled,manifest};
});
