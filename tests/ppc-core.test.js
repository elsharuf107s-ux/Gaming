const assert = require('assert');
const ppc = require('../public/ppc-core.js');

(async () => {
  // 1) Straight-line arithmetic still recompiles and executes.
  const arithmeticWords = [
    ppc.encodeD(14, 3, 0, 40),
    ppc.encodeD(14, 3, 3, 2),
    ppc.encodeD(24, 3, 3, 0)
  ];
  const arithmeticDecoded = ppc.decodeBuffer(ppc.wordsToBytes(arithmeticWords).buffer);
  assert.equal(arithmeticDecoded[0].op, 'addi');
  assert.equal(ppc.toIR(arithmeticDecoded).every(x => x.supportedForWasm), true);
  const arithmeticWasm = ppc.compileToWasm(arithmeticDecoded, { resultRegister: 3 });
  assert.equal(await ppc.runWasm(arithmeticWasm), 42);

  // 2) PPC big-endian memory survives WebAssembly's little-endian linear memory.
  const memoryWords = [
    ppc.encodeD(15, 3, 0, 0x1122), // addis r3,r0,0x1122 => 0x11220000
    ppc.encodeD(24, 3, 3, 0x3344), // ori r3,r3,0x3344 => 0x11223344
    ppc.encodeD(14, 4, 0, 256),    // addi r4,r0,256
    ppc.encodeD(36, 3, 4, 0),      // stw r3,0(r4)
    ppc.encodeD(32, 5, 4, 0),      // lwz r5,0(r4)
    ppc.encodeD(14, 3, 5, 1)       // addi r3,r5,1
  ];
  const memoryDecoded = ppc.decodeBuffer(ppc.wordsToBytes(memoryWords).buffer);
  const memoryWasm = ppc.compileToWasm(memoryDecoded, { resultRegister: 3 });
  const memoryInstance = await ppc.instantiateWasm(memoryWasm);
  assert.equal(memoryInstance.instance.exports.run() >>> 0, 0x11223345);
  const mem = new Uint8Array(memoryInstance.memory.buffer);
  assert.deepEqual(Array.from(mem.slice(256, 260)), [0x11, 0x22, 0x33, 0x44]);

  // 3) cmpwi + beq-style bc + unconditional b reconstruct real control flow.
  const branchWords = [
    ppc.encodeD(14, 3, 0, 5),      // 0: r3 = 5
    ppc.encodeCmpwi(3, 5),          // 4: cmpwi cr0,r3,5
    ppc.encodeBC(12, 2, 12),        // 8: if EQ -> 20
    ppc.encodeD(14, 3, 0, 7),       // 12: r3 = 7
    ppc.encodeB(8),                  // 16: -> end (24)
    ppc.encodeD(14, 3, 0, 42)       // 20: r3 = 42
  ];
  const branchDecoded = ppc.decodeBuffer(ppc.wordsToBytes(branchWords).buffer);
  assert.equal(branchDecoded[2].op, 'bc');
  assert.equal(branchDecoded[4].op, 'b');
  const branchWasm = ppc.compileToWasm(branchDecoded, { resultRegister: 3 });
  assert.equal(await ppc.runWasm(branchWasm), 42);

  const notTakenWords = [...branchWords];
  notTakenWords[1] = ppc.encodeCmpwi(3, 6); // EQ false, take r3=7 path
  const notTakenWasm = ppc.compileToWasm(ppc.decodeBuffer(ppc.wordsToBytes(notTakenWords).buffer));
  assert.equal(await ppc.runWasm(notTakenWasm), 7);

  // 4) sc crosses the WASM host boundary through env.runtimeCall(id,arg).
  const syscallWords = [
    ppc.encodeD(14, 0, 0, 7),
    ppc.encodeD(14, 3, 0, 9),
    0x44000002
  ];
  const syscallWasm = ppc.compileToWasm(ppc.decodeBuffer(ppc.wordsToBytes(syscallWords).buffer));
  const syscallResult = await ppc.runWasm(syscallWasm, {
    runtimeCall: (id, arg) => id * 100 + arg
  });
  assert.equal(syscallResult, 709);

  console.log('PPC -> IR -> WASM tests passed: arithmetic, memory, branching, runtime shim');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
