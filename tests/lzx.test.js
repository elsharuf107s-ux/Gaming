const assert=require('assert');
const LZX=require('../public/lzx.js');
const E=require('./helpers/lzx-encoder.js');

const same=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);

// Fixed stream (aligned + uncompressed + verbatim blocks, E8 translation on).
// Verified to decode to the same bytes with libmspack's reference lzxd.
const vectorText='Xbox 360 XEX images use LZX. '.repeat(20)+'\xe8\x10\x00\x00\x00 call shim '.repeat(8);
const vectorInput=Uint8Array.from(vectorText,c=>c.charCodeAt(0));
const vector=Buffer.from('AIAACAAgwhIAAAARAAAAAFUCRABnTcT6E5HCJv6xUbqE5JGH92+2+MCMAAAAAAwACAA+Qh34+/wA8QAAAAAAABEAYwj7PqXvcxxTwjSIWyNRvlVHbAUfYABjKQAAAB0AAAABAAAAAQAAAEVYIGltYWdlcyB1c2UgTFpYLiBYYm94IDM2MCBYRVggaW1hZ2VzIHVzAAAg5C0KoACABAAIgJZonDqy318KgZQcZL1lMiNs2aa33asYJwAYAAAYAAEAhxE/fj8P8X/G+AAAAAAAAGYAYET+7H58+f3jNMF4ZxFlJm3FenWyfDY0OjhAPA==','base64');
assert.ok(same(LZX.decompress(vector,{windowSize:0x8000,outputLength:vectorInput.length}),vectorInput));

function sample(kind,size,seed){
  const rng=E.mulberry32(seed),b=new Uint8Array(size);
  for(let i=0;i<size;i++){
    if(kind==='random') b[i]=rng()*256;
    else if(kind==='text') b[i]='lzx frame block xbox '.charCodeAt(Math.floor(rng()*21));
    else if(kind==='e8') b[i]=rng()<0.08?0xe8:rng()*256;
    else b[i]=i<size/2?rng()*256:b[i-(size>>1)];
  }
  return b;
}

const coverage={blocks:[0,0,0,0],repeatMatches:0,alignedSymbols:0,longLengths:0,pretree17:0,pretree18:0,pretree19:0,maxSlot:0};
let seed=1;
for(const windowBits of [15,17,21]){
  for(const size of [1,11,32767,32768,32769,70001]){
    for(const kind of ['random','text','e8','repeat']){
      const input=sample(kind,size,seed);
      const stats={};
      const compressed=E.compress(input,{windowBits,seed:seed++,intelFileSize:kind==='e8'&&size>20?12000000:0,stats});
      const out=LZX.decompress(compressed,{windowSize:1<<windowBits,outputLength:size});
      assert.ok(same(out,input),`round trip failed: window 2^${windowBits}, ${size} bytes of ${kind}`);
      for(const k of Object.keys(coverage)){
        if(k==='blocks') stats.blocks.forEach((n,i)=>coverage.blocks[i]+=n);
        else if(k==='maxSlot') coverage.maxSlot=Math.max(coverage.maxSlot,stats.maxSlot);
        else coverage[k]+=stats[k];
      }
    }
  }
}
// Every stream feature must actually have been exercised by the round trips above.
assert.ok(coverage.blocks[1]&&coverage.blocks[2]&&coverage.blocks[3],'all three block types');
for(const k of ['repeatMatches','alignedSymbols','longLengths','pretree17','pretree18','pretree19']) assert.ok(coverage[k]>0,k);
assert.ok(coverage.maxSlot>=30,'long-offset position slots');

// storeUncompressed: a single UNCOMPRESSED block, including odd and multi-frame lengths.
for(const size of [0,1,7,0x8000,0x8001,100001]){
  const data=sample('random',size,size+5);
  assert.ok(same(LZX.decompress(LZX.storeUncompressed(data),{outputLength:size}),data));
}

// Malformed input fails loudly instead of returning garbage.
const good=E.compress(sample('text',5000,9),{windowBits:15,seed:9});
assert.throws(()=>LZX.decompress(good.subarray(0,good.length>>1),{outputLength:5000}),/LZX/);
assert.throws(()=>LZX.decompress(new Uint8Array([0x00,0x00,0x00,0x00]),{outputLength:10}),/Invalid LZX block type 0/);
assert.throws(()=>LZX.decompress(good,{windowSize:0x9000,outputLength:5000}),/Unsupported LZX window size/);
assert.throws(()=>LZX.decompress(good,{}),/outputLength/);

console.log('LZX decoder tests passed:',JSON.stringify(coverage));
