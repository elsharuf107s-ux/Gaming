const assert = require('assert');
const ppc = require('../public/ppc-core.js');

(async () => {
  const words = [
    ppc.encodeD(14, 3, 0, 40), // addi r3,r0,40
    ppc.encodeD(14, 3, 3, 2),  // addi r3,r3,2
    ppc.encodeD(24, 3, 3, 0)   // ori r3,r3,0
  ];
  const bytes = ppc.wordsToBytes(words);
  const decoded = ppc.decodeBuffer(bytes.buffer);
  assert.equal(decoded[0].op, 'addi');
  assert.equal(decoded[0].rt, 3);
  assert.equal(decoded[0].imm, 40);

  const ir = ppc.toIR(decoded);
  assert.equal(ir.length, 3);
  assert.equal(ir.every(x => x.supportedForWasm), true);

  const wasm = ppc.compileToWasm(decoded, { resultRegister: 3 });
  assert.equal(wasm[0], 0x00);
  assert.equal(wasm[1], 0x61);
  assert.equal(wasm[2], 0x73);
  assert.equal(wasm[3], 0x6d);
  const result = await ppc.runWasm(wasm);
  assert.equal(result, 42);

  const branch = ppc.decodeWord((18 << 26) >>> 0);
  assert.equal(branch.op, 'b');
  assert.throws(() => ppc.compileToWasm([branch]), /Unsupported instruction/);

  console.log('PPC -> IR -> WASM tests passed; result =', result);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
