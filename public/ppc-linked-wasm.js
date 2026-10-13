(function(root,factory){
  const F=(typeof module==='object'&&module.exports)?require('./ppc-functions.js'):root.UCRPPCFunctions;
  const S=(typeof module==='object'&&module.exports)?require('./ppc-state.js'):root.UCRPPCState;
  const api=factory(F,S);
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.UCRPPCLinkedWasm=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(F,S){
  'use strict';
  if(!F||!S) throw new Error('ppc-functions.js and ppc-state.js are required');

  const SUPPORTED=new Set(['addi','addis','ori','oris','xori','andi','andis','add','subf','or','xor','and','mfspr','mtspr','bl','blr']);
  const hex=v=>'0x'+(v>>>0).toString(16).padStart(8,'0');
  function uleb(n){n>>>=0;const a=[];do{let b=n&0x7f;n>>>=7;if(n)b|=0x80;a.push(b)}while(n);return a}
  function sleb(n){n|=0;const a=[];let more=true;while(more){let b=n&0x7f,sign=b&0x40;n>>=7;more=!((n===0&&!sign)||(n===-1&&sign));if(more)b|=0x80;a.push(b)}return a}
  const str=s=>{const b=Array.from(new TextEncoder().encode(s));return [...uleb(b.length),...b]};
  const section=(id,data)=>[id,...uleb(data.length),...data];
  const i32Const=n=>[0x41,...sleb(n|0)];
  const memarg=(align=2,offset=0)=>[...uleb(align),...uleb(offset)];

  function stateAddr(stateOffset,offset){return ((stateOffset>>>0)+(offset>>>0))>>>0}
  function gprAddr(stateOffset,r){return stateAddr(stateOffset,S.OFFSETS.GPR+r*4)}
  function specialAddr(stateOffset,name){return stateAddr(stateOffset,S.OFFSETS[String(name).toUpperCase()])}
  function loadAt(address){return [...i32Const(address),0x28,...memarg(2,0)]}
  function storeAt(address,valueCode){return [...i32Const(address),...valueCode,0x36,...memarg(2,0)]}
  function loadGpr(stateOffset,r){return loadAt(gprAddr(stateOffset,r))}
  function storeGpr(stateOffset,r,valueCode){return storeAt(gprAddr(stateOffset,r),valueCode)}
  function loadSpecial(stateOffset,name){return loadAt(specialAddr(stateOffset,name))}
  function storeSpecial(stateOffset,name,valueCode){return storeAt(specialAddr(stateOffset,name),valueCode)}
  function dBase(stateOffset,ra){return ra===0?i32Const(0):loadGpr(stateOffset,ra)}

  function emitInstruction(ins,stateOffset){
    switch(ins.op){
      case 'addi': return storeGpr(stateOffset,ins.rt,[...dBase(stateOffset,ins.ra),...i32Const(ins.imm),0x6a]);
      case 'addis': return storeGpr(stateOffset,ins.rt,[...dBase(stateOffset,ins.ra),...i32Const((ins.imm<<16)|0),0x6a]);
      case 'ori': return storeGpr(stateOffset,ins.ra,[...loadGpr(stateOffset,ins.rs),...i32Const(ins.uimm),0x72]);
      case 'oris': return storeGpr(stateOffset,ins.ra,[...loadGpr(stateOffset,ins.rs),...i32Const((ins.uimm<<16)|0),0x72]);
      case 'xori': return storeGpr(stateOffset,ins.ra,[...loadGpr(stateOffset,ins.rs),...i32Const(ins.uimm),0x73]);
      case 'andi': return storeGpr(stateOffset,ins.ra,[...loadGpr(stateOffset,ins.rs),...i32Const(ins.uimm),0x71]);
      case 'andis': return storeGpr(stateOffset,ins.ra,[...loadGpr(stateOffset,ins.rs),...i32Const((ins.uimm<<16)|0),0x71]);
      case 'add': return storeGpr(stateOffset,ins.rt,[...loadGpr(stateOffset,ins.ra),...loadGpr(stateOffset,ins.rb),0x6a]);
      case 'subf': return storeGpr(stateOffset,ins.rt,[...loadGpr(stateOffset,ins.rb),...loadGpr(stateOffset,ins.ra),0x6b]);
      case 'or': return storeGpr(stateOffset,ins.ra,[...loadGpr(stateOffset,ins.rs),...loadGpr(stateOffset,ins.rb),0x72]);
      case 'xor': return storeGpr(stateOffset,ins.ra,[...loadGpr(stateOffset,ins.rs),...loadGpr(stateOffset,ins.rb),0x73]);
      case 'and': return storeGpr(stateOffset,ins.ra,[...loadGpr(stateOffset,ins.rs),...loadGpr(stateOffset,ins.rb),0x71]);
      case 'mfspr': {
        if(ins.spr!==8&&ins.spr!==9) throw new Error(`Unsupported mfspr ${ins.name}`);
        return storeGpr(stateOffset,ins.rt,loadSpecial(stateOffset,ins.spr===8?'LR':'CTR'));
      }
      case 'mtspr': {
        if(ins.spr!==8&&ins.spr!==9) throw new Error(`Unsupported mtspr ${ins.name}`);
        return storeSpecial(stateOffset,ins.spr===8?'LR':'CTR',loadGpr(stateOffset,ins.rs));
      }
      case 'bl': {
        const ret=(ins.address+4)>>>0;
        return [
          ...storeSpecial(stateOffset,'PC',i32Const(ins.address)),
          ...i32Const(ins.target),...i32Const(ret),0x10,...uleb(0),
          ...storeSpecial(stateOffset,'PC',i32Const(ret))
        ];
      }
      case 'blr': return [
        ...storeSpecial(stateOffset,'PC',loadSpecial(stateOffset,'LR')),
        ...loadGpr(stateOffset,3),0x0f
      ];
      default: throw new Error(`State-aware WASM does not support ${ins.op}`);
    }
  }

  function compileFunction(fn,{stateOffset=0,memoryPages=2}={}){
    const bad=fn.instructions.find(ins=>!SUPPORTED.has(ins.op)||(ins.op==='mfspr'&&![8,9].includes(ins.spr))||(ins.op==='mtspr'&&![8,9].includes(ins.spr)));
    if(bad) return {ok:false,address:fn.start>>>0,end:fn.end>>>0,reason:`Unsupported instruction at ${hex(bad.address)}: ${bad.text}`};
    try{
      const code=[];
      code.push(...storeSpecial(stateOffset,'PC',i32Const(fn.start)));
      for(const ins of fn.instructions) code.push(...emitInstruction(ins,stateOffset));
      if(!fn.instructions.some(ins=>ins.op==='blr')) code.push(...loadGpr(stateOffset,3));
      code.push(0x0b);

      const types=[
        2,
        0x60,2,0x7f,0x7f,0,
        0x60,0,1,0x7f
      ];
      const imports=[
        2,
        ...str('env'),...str('callTarget'),0x00,...uleb(0),
        ...str('env'),...str('memory'),0x02,0x00,...uleb(memoryPages)
      ];
      const funcs=[1,...uleb(1)];
      const exports=[2,...str('run'),0x00,...uleb(1),...str('memory'),0x02,...uleb(0)];
      const body=[0,...code];
      const codes=[1,...uleb(body.length),...body];
      const wasm=new Uint8Array([0,97,115,109,1,0,0,0,...section(1,types),...section(2,imports),...section(3,funcs),...section(7,exports),...section(10,codes)]);
      return {ok:true,address:fn.start>>>0,end:fn.end>>>0,wasm,instructionCount:fn.instructions.length,frame:fn.frame,calls:fn.calls};
    }catch(error){
      return {ok:false,address:fn.start>>>0,end:fn.end>>>0,reason:error.message,instructionCount:fn.instructions.length,frame:fn.frame,calls:fn.calls};
    }
  }

  function compileProgram(buffer,{baseAddress=0,entryPoint=baseAddress,stateOffset=0,memoryPages=2,maxInstructions=16384}={}){
    const bytes=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);
    const discovery=F.discoverFunctions(bytes,{baseAddress,entryPoints:[entryPoint],maxInstructions});
    const functions=discovery.functions.map(fn=>compileFunction(fn,{stateOffset,memoryPages}));
    return {baseAddress:baseAddress>>>0,entryPoint:entryPoint>>>0,stateOffset:stateOffset>>>0,memoryPages,discovery,functions,compiled:functions.filter(f=>f.ok).length,failed:functions.filter(f=>!f.ok).length};
  }

  async function instantiateProgram(program,{state=null,memory=null,externalCall=null,maxCallDepth=256}={}){
    const sharedState=state||S.create({memory,pages:program.memoryPages,stateOffset:program.stateOffset});
    if(sharedState.stateOffset!==program.stateOffset) throw new Error('Program stateOffset does not match shared state');
    const instances=new Map();
    let depth=0;
    const callTarget=(target,returnAddress)=>{
      target>>>=0; returnAddress>>>=0;
      S.setSpecial(sharedState,'LR',returnAddress);
      S.setSpecial(sharedState,'PC',target);
      const instance=instances.get(target);
      if(!instance){
        if(typeof externalCall==='function') { externalCall(target,returnAddress,sharedState); S.setSpecial(sharedState,'PC',returnAddress); return; }
        throw new Error(`Unresolved PPC call target ${hex(target)}`);
      }
      if(depth>=maxCallDepth) throw new Error(`PPC call depth exceeded ${maxCallDepth}`);
      depth++;
      try{ instance.exports.run(); }
      finally{ depth--; S.setSpecial(sharedState,'PC',returnAddress); }
    };
    for(const compiled of program.functions){
      if(!compiled.ok) continue;
      const {instance}=await WebAssembly.instantiate(compiled.wasm,{env:{memory:sharedState.memory,callTarget}});
      instances.set(compiled.address,instance);
    }
    function runEntry(address=program.entryPoint){
      address>>>=0;
      const instance=instances.get(address);
      if(!instance) throw new Error(`Entry function ${hex(address)} is not compiled`);
      S.setSpecial(sharedState,'PC',address);
      return instance.exports.run()|0;
    }
    return {state:sharedState,instances,runEntry,callTarget,program};
  }

  function manifest(program){
    return {
      baseAddress:hex(program.baseAddress),entryPoint:hex(program.entryPoint),stateOffset:program.stateOffset,
      discovered:program.discovery.functions.length,compiled:program.compiled,failed:program.failed,
      functions:program.functions.map(f=>({address:hex(f.address),end:hex(f.end),ok:f.ok,instructionCount:f.instructionCount||0,reason:f.reason||null,wasmBytes:f.ok?f.wasm.length:0,calls:f.calls||[]}))
    };
  }

  return {SUPPORTED,compileFunction,compileProgram,instantiateProgram,manifest};
});
