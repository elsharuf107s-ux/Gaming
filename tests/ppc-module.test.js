const assert=require('assert');
const F=require('../public/ppc-functions.js');
const M=require('../public/ppc-module.js');

(async()=>{
  const base=0x82000000;
  const callee=base+0x10;
  const words=[
    F.encodeB(base,callee,{link:true}),
    F.encodeBclr(),
    0x60000000,
    0x60000000,
    F.encodeD(14,3,0,40),
    F.encodeD(14,3,3,2),
    F.encodeBclr()
  ];
  const bytes=F.wordsToBytes(words);
  const module=M.compileModule(bytes,{baseAddress:base,entryPoints:[base]});
  assert.equal(module.discovered,2);
  assert.equal(module.compiled,1);
  assert.equal(module.failed,1);
  const leaf=module.functions.find(f=>f.address===callee);
  const caller=module.functions.find(f=>f.address===base);
  assert.ok(leaf&&leaf.ok);
  assert.ok(caller&&!caller.ok);
  assert.match(caller.reason,/direct call|Unsupported/i);
  const result=await M.runCompiled(leaf);
  assert.equal(result,42);
  const syscall=M.compileModule(F.wordsToBytes([F.encodeD(14,0,0,7),F.encodeD(14,3,0,9),0x44000002,F.encodeBclr()]),{baseAddress:base});
  const sc=syscall.functions[0];
  assert.ok(sc.ok);
  assert.equal(await M.runCompiled(sc),9);
  assert.equal(await M.runCompiled(sc,{env:{runtimeCall:(id,arg)=>id*100+arg}}),709);
  const manifest=M.manifest(module);
  assert.equal(manifest.compiled,1);
  assert.equal(manifest.failed,1);
  console.log('PPC discovered-function compilation passed:',JSON.stringify(manifest));
})().catch(e=>{console.error(e);process.exit(1)});
