'use strict';
// Test-only LZX encoder. It deliberately exercises every stream feature the
// decoder must handle: verbatim/aligned/uncompressed blocks, blocks spanning
// frames, repeated-offset matches, pretree run codes, long offsets, E8 translation.

const FRAME_SIZE=0x8000,MIN_MATCH=2,MAX_MATCH=257,NUM_CHARS=256,NUM_SECONDARY_LENGTHS=249;
const POSITION_SLOTS={15:30,16:32,17:34,18:36,19:38,20:42,21:50};
const EXTRA_BITS=[],POSITION_BASE=[];
for(let i=0;i<51;i++){EXTRA_BITS[i]=i<4?0:i<36?(i>>1)-1:17;POSITION_BASE[i]=i?POSITION_BASE[i-1]+(1<<EXTRA_BITS[i-1]):0}

function mulberry32(seed){return()=>{seed|=0;seed=(seed+0x6d2b79f5)|0;let t=Math.imul(seed^(seed>>>15),1|seed);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296}}

class BitWriter{
  constructor(){this.bytes=[];this.word=0;this.used=0}
  write(value,n){for(let i=n-1;i>=0;i--){this.word=(this.word<<1)|((value>>>i)&1);if(++this.used===16)this.flush()}}
  flush(){this.bytes.push(this.word&0xff,(this.word>>>8)&0xff);this.word=0;this.used=0}
  align(){if(this.used){this.word<<=16-this.used;this.flush()}}
  raw(b){if(this.used)throw new Error('raw byte while not aligned');this.bytes.push(b&0xff)}
  finish(){this.align();return Uint8Array.from(this.bytes)}
}

function huffmanLengths(freqs,maxLen){
  let f=freqs.slice();
  for(;;){
    const used=[];for(let i=0;i<f.length;i++)if(f[i]>0)used.push(i);
    const lens=new Array(f.length).fill(0);
    if(!used.length) return lens;
    if(used.length===1){lens[used[0]]=1;lens[used[0]===0?1:0]=1;return lens}
    let nodes=used.map(sym=>({w:f[sym],sym}));
    while(nodes.length>1){nodes.sort((a,b)=>a.w-b.w);const a=nodes.shift(),b=nodes.shift();nodes.push({w:a.w+b.w,l:a,r:b})}
    const walk=(n,d)=>{if(n.sym!==undefined)lens[n.sym]=d;else{walk(n.l,d+1);walk(n.r,d+1)}};
    walk(nodes[0],0);
    if(Math.max(...lens)<=maxLen) return lens;
    f=f.map(x=>x?Math.max(1,x>>1):0);
  }
}

function canonicalCodes(lens){
  const codes=new Array(lens.length).fill(0);let code=0;
  const max=Math.max(0,...lens);
  for(let len=1;len<=max;len++){for(let s=0;s<lens.length;s++)if(lens[s]===len)codes[s]=code++;code<<=1}
  return codes;
}

function makeTree(freqs,maxLen){const lens=huffmanLengths(freqs,maxLen);return{lens,codes:canonicalCodes(lens)}}
function putSym(w,tree,sym){if(!tree.lens[sym])throw new Error(`symbol ${sym} has no code`);w.write(tree.codes[sym],tree.lens[sym])}

function writeLengths(w,prev,next,first,last,rng,stats){
  const ops=[];
  for(let x=first;x<last;){
    const v=next[x];let run=1;while(x+run<last&&next[x+run]===v)run++;
    const pick=rng();
    if(v===0&&run>=20&&pick<0.8){const r=Math.min(run,51);ops.push({sym:18,bits:5,val:r-20});x+=r;continue}
    if(v===0&&run>=4&&pick<0.8){const r=Math.min(run,19);ops.push({sym:17,bits:4,val:r-4});x+=r;continue}
    if(run>=4&&pick<0.9){const r=Math.min(run,5);ops.push({sym:19,bits:1,val:r-4,sym2:(prev[x]-v+17)%17});x+=r;continue}
    ops.push({sym:(prev[x]-v+17)%17});x++;
  }
  const freq=new Array(20).fill(0);
  for(const op of ops){freq[op.sym]++;if(op.sym2!==undefined)freq[op.sym2]++;if(op.sym>=17)stats['pretree'+op.sym]++}
  const pre=makeTree(freq,15);
  for(let i=0;i<20;i++)w.write(pre.lens[i],4);
  for(const op of ops){putSym(w,pre,op.sym);if(op.bits)w.write(op.val,op.bits);if(op.sym2!==undefined)putSym(w,pre,op.sym2)}
  for(let x=first;x<last;x++)prev[x]=next[x];
}

function e8Transform(data,intelFileSize){
  const out=data.slice();
  for(let frame=0,start=0;start<out.length&&frame<32768;frame++,start+=FRAME_SIZE){
    const size=Math.min(FRAME_SIZE,out.length-start);if(size<=10)continue;
    let curpos=start;
    for(let i=start;i<start+size-10;){
      if(out[i++]!==0xe8){curpos++;continue}
      const rel=out[i]|(out[i+1]<<8)|(out[i+2]<<16)|(out[i+3]<<24);
      if(rel>=-curpos&&rel<intelFileSize){
        const abs=rel<intelFileSize-curpos?rel+curpos:rel-intelFileSize;
        out[i]=abs;out[i+1]=abs>>>8;out[i+2]=abs>>>16;out[i+3]=abs>>>24;
      }
      i+=4;curpos+=5;
    }
  }
  return out;
}

// Greedy LZ77 over [start,end) that never lets a match leave the segment.
function tokenize(data,start,end,windowSize,state,rng){
  const tokens=[];const maxOffset=windowSize-3;
  for(let p=start;p<end;){
    const limit=Math.min(MAX_MATCH,end-p);
    let bestLen=0,bestOff=0;
    if(limit>=MIN_MATCH){
      const candidates=[state.R0,state.R1,state.R2];
      const chain=state.heads.get(key(data,p));
      if(chain)for(let i=chain.length-1,n=0;i>=0&&n<24;i--,n++)candidates.push(p-chain[i]);
      if(rng()<0.3&&p>=1)candidates.push(1+Math.floor(rng()*Math.min(p,maxOffset)));
      for(const off of candidates){
        if(off<1||off>p||off>maxOffset)continue;
        let len=0;while(len<limit&&data[p+len]===data[p-off+len])len++;
        if(len>bestLen||(len===bestLen&&len&&(off===state.R0||off===state.R1||off===state.R2))){bestLen=len;bestOff=off}
      }
    }
    if(bestLen>=MIN_MATCH&&!(bestLen===2&&rng()<0.5)){
      const len=rng()<0.1&&bestLen>3?MIN_MATCH+Math.floor(rng()*(bestLen-1)):bestLen;
      tokens.push({len,off:bestOff});
      for(let i=0;i<len;i++)remember(data,p+i,state);
      p+=len;
    }else{tokens.push({lit:data[p]});remember(data,p,state);p++}
  }
  return tokens;
}
function key(d,p){return p+2<d.length?(d[p]<<16)|(d[p+1]<<8)|d[p+2]:-1-p}
function remember(d,p,state){const k=key(d,p);let c=state.heads.get(k);if(!c){c=[];state.heads.set(k,c)}c.push(p);if(c.length>64)c.shift()}

function slotFor(formatted){let s=3;while(s+1<51&&POSITION_BASE[s+1]<=formatted)s++;return s}

// Resolve offsets against the repeated-offset queue exactly as the decoder will.
function codeTokens(tokens,R,alignedBlock,stats){
  for(const t of tokens){
    if(t.lit!==undefined)continue;
    let slot,footer=0;
    if(t.off===R.R0)slot=0;
    else if(t.off===R.R1){slot=1;R.R1=R.R0;R.R0=t.off}
    else if(t.off===R.R2){slot=2;R.R2=R.R0;R.R0=t.off}
    else{const formatted=t.off+2;slot=slotFor(formatted);footer=formatted-POSITION_BASE[slot];R.R2=R.R1;R.R1=R.R0;R.R0=t.off}
    if(slot<3)stats.repeatMatches++;else stats.maxSlot=Math.max(stats.maxSlot,slot);
    const lenHeader=Math.min(t.len-MIN_MATCH,7);
    t.main=NUM_CHARS+(slot<<3|lenHeader);
    if(lenHeader===7)t.lenFooter=t.len-MIN_MATCH-7;
    if(slot>=3){const extra=EXTRA_BITS[slot];t.extra=extra;t.footer=footer;t.aligned=alignedBlock&&extra>=3}
  }
}

function compress(input,{windowBits=15,intelFileSize=0,seed=1,blockSizes=null,blockTypes=null,stats={}}={}){
  Object.assign(stats,{blocks:[0,0,0,0],repeatMatches:0,maxSlot:0,alignedSymbols:0,longLengths:0,pretree17:0,pretree18:0,pretree19:0});
  const rng=mulberry32(seed);
  const windowSize=1<<windowBits,mainCount=NUM_CHARS+(POSITION_SLOTS[windowBits]<<3);
  const data=intelFileSize?e8Transform(input,intelFileSize):input;
  const w=new BitWriter();
  if(intelFileSize){w.write(1,1);w.write(intelFileSize>>>16,16);w.write(intelFileSize&0xffff,16)}else w.write(0,1);
  const prevMain=new Array(mainCount).fill(0),prevLength=new Array(NUM_SECONDARY_LENGTHS).fill(0);
  const state={R0:1,R1:1,R2:1,heads:new Map()};
  let pos=0,blockIndex=0,lastUncompressedOdd=false;
  while(pos<data.length){
    const size=Math.min(data.length-pos,blockSizes?blockSizes[blockIndex%blockSizes.length]:1+Math.floor(rng()*90000));
    const type=blockTypes?blockTypes[blockIndex%blockTypes.length]:1+Math.floor(rng()*3);
    blockIndex++;stats.blocks[type]++;
    if(lastUncompressedOdd){w.raw(0);lastUncompressedOdd=false}
    w.write(type,3);w.write(size>>>8,16);w.write(size&0xff,8);
    const end=pos+size;
    if(type===3){
      if(w.used===0)w.write(0,16);
      w.align();
      for(const r of [state.R0,state.R1,state.R2])for(let i=0;i<4;i++)w.raw(r>>>(8*i));
      for(let i=pos;i<end;i++){w.raw(data[i]);remember(data,i,state)}
      lastUncompressedOdd=(size&1)===1;
      pos=end;continue;
    }
    // Tokenize per frame so no match crosses a frame (or block) boundary.
    const segments=[];
    for(let s=pos;s<end;){const frameEnd=(Math.floor(s/FRAME_SIZE)+1)*FRAME_SIZE;const e=Math.min(end,frameEnd);segments.push({start:s,end:e,tokens:tokenize(data,s,e,windowSize,state,rng)});s=e}
    const R={R0:state.R0,R1:state.R1,R2:state.R2};
    const all=segments.flatMap(s=>s.tokens);
    codeTokens(all,R,type===2,stats);
    const mainFreq=new Array(mainCount).fill(0),lengthFreq=new Array(NUM_SECONDARY_LENGTHS).fill(0),alignedFreq=new Array(8).fill(0);
    for(const t of all){
      if(t.lit!==undefined){mainFreq[t.lit]++;continue}
      mainFreq[t.main]++;if(t.lenFooter!==undefined){lengthFreq[t.lenFooter]++;stats.longLengths++}if(t.aligned){alignedFreq[t.footer&7]++;stats.alignedSymbols++}
    }
    if(intelFileSize)mainFreq[0xe8]++;
    const mainTree=makeTree(mainFreq,16),lengthTree=makeTree(lengthFreq,16);
    let alignedTree=null;
    if(type===2){
      alignedTree=alignedFreq.some(Boolean)?makeTree(alignedFreq,7):{lens:new Array(8).fill(3),codes:canonicalCodes(new Array(8).fill(3))};
      for(let i=0;i<8;i++)w.write(alignedTree.lens[i],3);
    }
    writeLengths(w,prevMain,mainTree.lens,0,NUM_CHARS,rng,stats);
    writeLengths(w,prevMain,mainTree.lens,NUM_CHARS,mainCount,rng,stats);
    writeLengths(w,prevLength,lengthTree.lens,0,NUM_SECONDARY_LENGTHS,rng,stats);
    for(const seg of segments){
      for(const t of seg.tokens){
        if(t.lit!==undefined){putSym(w,mainTree,t.lit);continue}
        putSym(w,mainTree,t.main);
        if(t.lenFooter!==undefined)putSym(w,lengthTree,t.lenFooter);
        if(t.extra!==undefined){
          if(t.aligned){if(t.extra>3)w.write(t.footer>>>3,t.extra-3);putSym(w,alignedTree,t.footer&7)}
          else if(t.extra)w.write(t.footer,t.extra);
        }
      }
      if(seg.end%FRAME_SIZE===0||seg.end===data.length)w.align();
    }
    state.R0=R.R0;state.R1=R.R1;state.R2=R.R2;
    pos=end;
  }
  return w.finish();
}

module.exports={compress,e8Transform,mulberry32};
