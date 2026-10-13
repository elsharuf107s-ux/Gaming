const assert=require('assert');
const F=require('../public/ppc-functions.js');
const S=require('../public/ppc-state.js');
const W=require('../public/ppc-linked-wasm.js');

(async()=>{
  const base=0x1000;
  const callee=0x1020;
  const words=[
    F.encodeMfspr(12,8),          // mflr r12
    F.encodeD(14,3,0,40),         // li r3,40
    F.encodeB(base+8,callee,{link:true}),
    F.encodeD(14,3,3,1),          // addi r3,r3,1
    F.encodeMtspr(12,8),          // mtlr r12
    F.encodeBclr(),               // blr
    0,
    0,
    F.encodeD(14,3,3,2),          // callee: addi r3,r3,2
    F.encodeBclr()                // blr
  ];
  const bytes=F.wordsToBytes(words);
  const program=W.compileProgram(bytes,{baseAddress:base,entryPoint:base,memoryPages:2});
  assert.equal(program.discovery.functions.length,2);
  assert.equal(program.compiled,2,JSON.stringify(W.manifest(program),null,2));
  assert.equal(program.failed,0,JSON.stringify(W.manifest(program),null,2));

  const state=S.create({pages:2});
  S.setSpecial(state,'LR',0);
  const runtime=await W.instantiateProgram(program,{state});
  const result=runtime.runEntry();

  assert.equal(result,43);
  assert.equal(S.getGpr(state,3),43);
  assert.equal(S.getGpr(state,12),0);      // original root LR saved by mflr
  assert.equal(S.getSpecial(state,'LR'),0); // restored by mtlr
  assert.equal(S.getSpecial(state,'PC'),0); // root blr returns through original LR
  assert.equal(runtime.instances.size,2);
  console.log('Linked PPC WASM call test passed: r3 =',result);
})().catch(err=>{console.error(err);process.exit(1)});
