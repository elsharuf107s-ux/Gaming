(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.UCRLZX=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  // Microsoft LZX (CAB/XEX flavour): 32 KiB output frames, 16-bit little-endian
  // words read MSB-first, canonical Huffman trees delta-coded through a pretree.
  const FRAME_SIZE=0x8000,MIN_MATCH=2,NUM_CHARS=256,NUM_PRIMARY_LENGTHS=7,NUM_SECONDARY_LENGTHS=249;
  const BLOCK={VERBATIM:1,ALIGNED:2,UNCOMPRESSED:3};
  const POSITION_SLOTS={15:30,16:32,17:34,18:36,19:38,20:42,21:50};
  const LENGTH_SAFETY=64;
  const EXTRA_BITS=new Uint8Array(51),POSITION_BASE=new Uint32Array(51);
  for(let i=0;i<51;i++){
    EXTRA_BITS[i]=i<4?0:i<36?(i>>1)-1:17;
    if(i) POSITION_BASE[i]=POSITION_BASE[i-1]+(1<<EXTRA_BITS[i-1]);
  }

  function windowBitsFor(windowSize){
    const bits=Math.log2(windowSize);
    if(!Number.isInteger(bits)||!POSITION_SLOTS[bits]) throw new Error(`Unsupported LZX window size ${windowSize} (expected 2^15..2^21)`);
    return bits;
  }

  class BitReader{
    constructor(input){this.input=input;this.pos=0;this.buf=0;this.left=0}
    byte(){
      // Like the reference decoder, a stream may run two zero bytes past its end.
      if(this.pos<this.input.length) return this.input[this.pos++];
      if(this.pos>=this.input.length+2) throw new Error('LZX input is truncated');
      this.pos++;return 0;
    }
    ensure(n){
      while(this.left<n){
        const b0=this.byte(),b1=this.byte();
        this.buf=(this.buf|(((b1<<8)|b0)<<(16-this.left)))>>>0;
        this.left+=16;
      }
    }
    peek(n){return this.buf>>>(32-n)}
    remove(n){this.buf=(this.buf<<n)>>>0;this.left-=n}
    read(n){if(!n)return 0;this.ensure(n);const v=this.peek(n);this.remove(n);return v}
    u32le(){const b0=this.byte(),b1=this.byte(),b2=this.byte(),b3=this.byte();return (b0|(b1<<8)|(b2<<16)|(b3<<24))>>>0}
  }

  function buildTable(lens,count,name){
    let maxLen=0;
    for(let i=0;i<count;i++) if(lens[i]>maxLen) maxLen=lens[i];
    if(!maxLen) return {name,empty:true};
    const size=1<<maxLen,table=new Uint16Array(size),snapshot=Uint8Array.from(lens.subarray(0,count));
    let pos=0;
    for(let len=1;len<=maxLen;len++){
      const step=1<<(maxLen-len);
      for(let sym=0;sym<count;sym++){
        if(snapshot[sym]!==len) continue;
        if(pos+step>size) throw new Error(`LZX ${name} tree is over-subscribed`);
        table.fill(sym,pos,pos+step);pos+=step;
      }
    }
    if(pos!==size) throw new Error(`LZX ${name} tree is incomplete`);
    return {name,empty:false,maxLen,table,lens:snapshot};
  }

  function decodeSymbol(br,tree){
    if(tree.empty) throw new Error(`LZX ${tree.name} symbol needed but the tree is empty`);
    br.ensure(16);
    const sym=tree.table[br.peek(tree.maxLen)];
    br.remove(tree.lens[sym]);
    return sym;
  }

  function fillLengths(lens,x,run,value){
    if(x+run>lens.length) throw new Error('LZX code-length run overflows its table');
    lens.fill(value,x,x+run);
    return x+run;
  }

  function readLengths(br,lens,first,last){
    const pre=new Uint8Array(20);
    for(let i=0;i<20;i++) pre[i]=br.read(4);
    const pretree=buildTable(pre,20,'pretree');
    for(let x=first;x<last;){
      let z=decodeSymbol(br,pretree);
      if(z===17) x=fillLengths(lens,x,br.read(4)+4,0);
      else if(z===18) x=fillLengths(lens,x,br.read(5)+20,0);
      else if(z===19){
        const run=br.read(1)+4;
        z=lens[x]-decodeSymbol(br,pretree);if(z<0)z+=17;
        x=fillLengths(lens,x,run,z);
      }else{
        z=lens[x]-z;if(z<0)z+=17;
        lens[x++]=z;
      }
    }
  }

  function decompress(input,{windowSize=FRAME_SIZE,outputLength}={}){
    const src=input instanceof Uint8Array?input:new Uint8Array(input);
    if(!Number.isInteger(outputLength)||outputLength<0) throw new Error('LZX outputLength must be a non-negative integer');
    const windowBits=windowBitsFor(windowSize),mainCount=NUM_CHARS+(POSITION_SLOTS[windowBits]<<3);
    const window=new Uint8Array(windowSize),out=new Uint8Array(outputLength),br=new BitReader(src);
    const mainLens=new Uint8Array(mainCount+LENGTH_SAFETY),lengthLens=new Uint8Array(NUM_SECONDARY_LENGTHS+LENGTH_SAFETY),alignedLens=new Uint8Array(8);
    let mainTree=null,lengthTree=null,alignedTree=null;
    let R0=1,R1=1,R2=1,windowPosn=0,framePosn=0,offset=0,frame=0;
    let blockType=0,blockLength=0,blockRemaining=0,intelStarted=false,intelFileSize=0,headerRead=false;

    while(offset<outputLength){
      if(!headerRead){
        let hi=0,lo=0;
        if(br.read(1)){hi=br.read(16);lo=br.read(16)}
        intelFileSize=(hi<<16)|lo;
        headerRead=true;
      }
      const frameSize=Math.min(FRAME_SIZE,outputLength-offset);
      let bytesTodo=framePosn+frameSize-windowPosn;
      while(bytesTodo>0){
        if(blockRemaining===0){
          if(blockType===BLOCK.UNCOMPRESSED&&(blockLength&1)) br.byte();
          blockType=br.read(3);
          const hi=br.read(16),lo=br.read(8);
          blockRemaining=blockLength=(hi<<8)|lo;
          if(blockType===BLOCK.ALIGNED){
            for(let i=0;i<8;i++) alignedLens[i]=br.read(3);
            alignedTree=buildTable(alignedLens,8,'aligned');
          }
          if(blockType===BLOCK.ALIGNED||blockType===BLOCK.VERBATIM){
            readLengths(br,mainLens,0,NUM_CHARS);
            readLengths(br,mainLens,NUM_CHARS,mainCount);
            mainTree=buildTable(mainLens,mainCount,'main');
            if(mainLens[0xe8]) intelStarted=true;
            readLengths(br,lengthLens,0,NUM_SECONDARY_LENGTHS);
            lengthTree=buildTable(lengthLens,NUM_SECONDARY_LENGTHS,'length');
          }else if(blockType===BLOCK.UNCOMPRESSED){
            intelStarted=true;
            // Skip to the next 16-bit boundary (a whole word if already aligned).
            if(br.left===0) br.ensure(16);
            br.left=0;br.buf=0;
            R0=br.u32le();R1=br.u32le();R2=br.u32le();
          }else{
            throw new Error(`Invalid LZX block type ${blockType}`);
          }
        }

        let thisRun=Math.min(blockRemaining,bytesTodo);
        bytesTodo-=thisRun;blockRemaining-=thisRun;

        if(blockType===BLOCK.UNCOMPRESSED){
          for(;thisRun>0;thisRun--) window[windowPosn++]=br.byte();
          continue;
        }
        while(thisRun>0){
          const main=decodeSymbol(br,mainTree);
          if(main<NUM_CHARS){window[windowPosn++]=main;thisRun--;continue}
          const element=main-NUM_CHARS;
          let matchLength=element&NUM_PRIMARY_LENGTHS;
          if(matchLength===NUM_PRIMARY_LENGTHS) matchLength+=decodeSymbol(br,lengthTree);
          matchLength+=MIN_MATCH;

          const slot=element>>>3;
          let matchOffset;
          if(slot===0) matchOffset=R0;
          else if(slot===1){matchOffset=R1;R1=R0;R0=matchOffset}
          else if(slot===2){matchOffset=R2;R2=R0;R0=matchOffset}
          else{
            const extra=EXTRA_BITS[slot];
            matchOffset=POSITION_BASE[slot]-2;
            if(extra>=3&&blockType===BLOCK.ALIGNED){
              if(extra>3) matchOffset+=br.read(extra-3)<<3;
              matchOffset+=decodeSymbol(br,alignedTree);
            }else if(extra){
              matchOffset+=br.read(extra);
            }
            R2=R1;R1=R0;R0=matchOffset;
          }

          if(windowPosn+matchLength>windowSize) throw new Error('LZX match runs past the end of the window');
          let from=windowPosn-matchOffset;
          if(from<0){
            if(matchOffset>offset) throw new Error('LZX match offset reaches before the start of the stream');
            if(matchOffset-windowPosn>windowSize) throw new Error('LZX match offset exceeds the window');
            from+=windowSize;
          }
          for(let i=0;i<matchLength;i++){
            window[windowPosn++]=window[from++];
            if(from===windowSize) from=0;
          }
          thisRun-=matchLength;
        }
        if(thisRun<0){
          if(-thisRun>blockRemaining) throw new Error('LZX match runs past the end of its block');
          blockRemaining+=thisRun;
        }
      }

      if(windowPosn-framePosn!==frameSize) throw new Error('LZX frame decoded to the wrong size');
      // Frames end on a 16-bit boundary of the input.
      if(br.left>0) br.ensure(16);
      if(br.left&15) br.remove(br.left&15);

      let frameData=window.subarray(framePosn,framePosn+frameSize);
      if(intelStarted&&intelFileSize&&frame<32768&&frameSize>10){
        frameData=frameData.slice();
        let curpos=offset;
        for(let i=0;i<frameSize-10;){
          if(frameData[i++]!==0xe8){curpos++;continue}
          const abs=frameData[i]|(frameData[i+1]<<8)|(frameData[i+2]<<16)|(frameData[i+3]<<24);
          if(abs>=-curpos&&abs<intelFileSize){
            const rel=abs>=0?abs-curpos:abs+intelFileSize;
            frameData[i]=rel;frameData[i+1]=rel>>>8;frameData[i+2]=rel>>>16;frameData[i+3]=rel>>>24;
          }
          i+=4;curpos+=5;
        }
      }
      out.set(frameData,offset);
      offset+=frameSize;framePosn+=frameSize;frame++;
      if(windowPosn===windowSize) windowPosn=0;
      if(framePosn===windowSize) framePosn=0;
    }
    return out;
  }

  // Wraps raw bytes in a single UNCOMPRESSED block: a valid LZX stream for synthetic images.
  function storeUncompressed(input){
    const data=input instanceof Uint8Array?input:new Uint8Array(input);
    if(data.length>0xffffff) throw new Error('storeUncompressed supports at most 16 MiB');
    // Header bits: intel flag 0, block type 3, 24-bit length; 28 bits padded to two words.
    const bits=(BLOCK.UNCOMPRESSED<<24|data.length)>>>0;
    const w0=(bits>>>12)&0xffff,w1=(bits<<4)&0xffff;
    const out=new Uint8Array(4+12+data.length+(data.length&1));
    out.set([w0&0xff,w0>>>8,w1&0xff,w1>>>8],0);
    for(let i=0;i<3;i++) out[4+i*4]=1; // R0=R1=R2=1
    out.set(data,16);
    return out;
  }

  return {FRAME_SIZE,BLOCK,POSITION_SLOTS,windowBitsFor,decompress,storeUncompressed};
});
