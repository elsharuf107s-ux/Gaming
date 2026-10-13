const assert=require('assert');
const F=require('../public/ppc-functions.js');
const S=require('../public/ppc-state.js');
const W=require('../public/ppc-linked-wasm.js');
const X=require('../public/xbox-runtime.js');

(async()=>{
  const base=0x2000;
  const thunk=0x9000;
  const words=[
    F.encodeMfspr(12,8),
    F.encodeB(base+4,thunk,{link:true}),
    F.encodeD(14,3,3,1),
    F.encodeMtspr(12,8),
    F.encodeBclr()
  ];
  const bytes=F.wordsToBytes(words);
  const program=W.compileProgram(bytes,{baseAddress:base,entryPoint:base,memoryPages:2});
  assert.equal(program.compiled,1,JSON.stringify(W.manifest(program),null,2));

  const state=S.create({pages:2});
  const xbox=X.create({state,trace:true});
  xbox.bindThunk(thunk,'xboxkrnl',X.XBOXKRNL_ORDINALS.KeQueryPerformanceFrequency);

  const runtime=await W.instantiateProgram(program,{state,externalCall:(target,returnAddress)=>xbox.dispatchAddress(target,returnAddress)});
  const result=runtime.runEntry();

  assert.equal(X.GUEST_TICK_FREQUENCY,50000000);
  assert.equal(result,50000001);
  assert.equal(S.getGpr(state,3),50000001);
  assert.equal(xbox.events[0].name,'KeQueryPerformanceFrequency');
  assert.equal(xbox.events[1].r3,50000000);
  console.log('Xbox kernel shim bridge passed: r3 =',result);
})().catch(err=>{console.error(err);process.exit(1)});
