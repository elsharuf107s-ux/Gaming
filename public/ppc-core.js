(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.UCRPPC=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const s16=v=>(v&0x8000)?v-0x10000:v;
  const u16=v=>v&0xffff;
  const hex=v=>'0x'+(v>>>0).toString(16).padStart(8,'0');
  const WASM_SUPPORTED=new Set([
    'addi','addis','ori','oris','xori','andi','andis','add','subf','or','xor','and',
    'cmpwi','b','bc','lwz','stw','lbz','stb','lhz','sth','sc'
  ]);

  function decodeWord(word,address=0){
    word>>>=0;
    const op=word>>>26;
    const rt=(word>>>21)&31;
    const ra=(word>>>16)&31;
    const rb=(word>>>11)&31;
    const imm=s16(word&0xffff);
    const uimm=u16(word);
    if(op===10){
      const bf=(word>>>23)&7, l=(word>>>21)&1;
      return {address,word,op:'cmplwi',bf,l,ra,uimm,text:`cmplwi cr${bf}, r${ra}, ${uimm}`};
    }
    if(op===11){
      const bf=(word>>>23)&7, l=(word>>>21)&1;
      return {address,word,op:'cmpwi',bf,l,ra,imm,text:`cmpwi cr${bf}, r${ra}, ${imm}`};
    }
    if(op===14) return {address,word,op:'addi',rt,ra,imm,text:`addi r${rt}, r${ra}, ${imm}`};
    if(op===15) return {address,word,op:'addis',rt,ra,imm,text:`addis r${rt}, r${ra}, ${imm}`};
    if(op===16){
      const bo=(word>>>21)&31, bi=(word>>>16)&31;
      const disp=s16(word&0xfffc);
      const aa=(word>>>1)&1, lk=word&1;
      return {address,word,op:'bc',bo,bi,disp,aa,lk,text:`bc ${bo},${bi},${aa?hex(disp):((disp>=0?'+':'')+disp)}`};
    }
    if(op===17) return {address,word,op:'sc',text:'sc'};
    if(op===18){
      let li=word&0x03fffffc;
      if(li&0x02000000) li|=0xfc000000;
      const aa=(word>>>1)&1, lk=word&1;
      return {address,word,op:'b',disp:li|0,aa,lk,text:`b${lk?'l':''} ${aa?hex(li):((li|0)>=0?'+':'')+(li|0)}`};
    }
    if(op===24) return {address,word,op:'ori',rs:rt,ra,uimm,text:`ori r${ra}, r${rt}, ${hex(uimm)}`};
    if(op===25) return {address,word,op:'oris',rs:rt,ra,uimm,text:`oris r${ra}, r${rt}, ${hex(uimm)}`};
    if(op===26) return {address,word,op:'xori',rs:rt,ra,uimm,text:`xori r${ra}, r${rt}, ${hex(uimm)}`};
    if(op===28) return {address,word,op:'andi',rs:rt,ra,uimm,text:`andi. r${ra}, r${rt}, ${hex(uimm)}`};
    if(op===29) return {address,word,op:'andis',rs:rt,ra,uimm,text:`andis. r${ra}, r${rt}, ${hex(uimm)}`};
    if(op===31){
      const xo=(word>>>1)&0x3ff;
      if(xo===266) return {address,word,op:'add',rt,ra,rb,text:`add r${rt}, r${ra}, r${rb}`};
      if(xo===40) return {address,word,op:'subf',rt,ra,rb,text:`subf r${rt}, r${ra}, r${rb}`};
      if(xo===444) return {address,word,op:'or',rs:rt,ra,rb,text:`or r${ra}, r${rt}, r${rb}`};
      if(xo===316) return {address,word,op:'xor',rs:rt,ra,rb,text:`xor r${ra}, r${rt}, r${rb}`};
      if(xo===28) return {address,word,op:'and',rs:rt,ra,rb,text:`and r${ra}, r${rt}, r${rb}`};
      return {address,word,op:'unsupported',primary:op,xo,text:`unsupported ${hex(word)}`};
    }
    if(op===32) return {address,word,op:'lwz',rt,ra,imm,text:`lwz r${rt}, ${imm}(r${ra})`};
    if(op===34) return {address,word,op:'lbz',rt,ra,imm,text:`lbz r${rt}, ${imm}(r${ra})`};
    if(op===36) return {address,word,op:'stw',rs:rt,ra,imm,text:`stw r${rt}, ${imm}(r${ra})`};
    if(op===38) return {address,word,op:'stb',rs:rt,ra,imm,text:`stb r${rt}, ${imm}(r${ra})`};
    if(op===40) return {address,word,op:'lhz',rt,ra,imm,text:`lhz r${rt}, ${imm}(r${ra})`};
    if(op===44) return {address,word,op:'sth',rs:rt,ra,imm,text:`sth r${rt}, ${imm}(r${ra})`};
    return {address,word,op:'unsupported',primary:op,text:`unsupported ${hex(word)}`};
  }

  function decodeBuffer(buffer,{offset=0,count,baseAddress=0}={}){
    const bytes=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);
    const max=Math.floor((bytes.length-offset)/4);
    const n=Math.min(count==null?max:count,max);
    const out=[];
    for(let i=0;i<n;i++){
      const p=offset+i*4;
      const word=((bytes[p]<<24)|(bytes[p+1]<<16)|(bytes[p+2]<<8)|bytes[p+3])>>>0;
      out.push(decodeWord(word,(baseAddress+i*4)>>>0));
    }
    return out;
  }

  function toIR(decoded){
    return decoded.map((ins,index)=>({
      index,
      pc:ins.address>>>0,
      opcode:ins.op,
      args:Object.fromEntries(Object.entries(ins).filter(([k])=>!['address','word','op','text'].includes(k))),
      sourceWord:hex(ins.word),
      text:ins.text,
      supportedForWasm:WASM_SUPPORTED.has(ins.op) && !(ins.op==='cmpwi'&&(ins.bf!==0||ins.l!==0))
    }));
  }

  function uleb(n){
    n>>>=0; const a=[];
    do{let b=n&0x7f;n>>>=7;if(n)b|=0x80;a.push(b)}while(n);
    return a;
  }
  function sleb(n){
    n|=0; const a=[]; let more=true;
    while(more){let b=n&0x7f;const sign=b&0x40;n>>=7;more=!((n===0&&!sign)||(n===-1&&sign));if(more)b|=0x80;a.push(b)}
    return a;
  }
  const section=(id,data)=>[id,...uleb(data.length),...data];
  const str=s=>{const b=Array.from(new TextEncoder().encode(s));return [...uleb(b.length),...b]};
  const localGet=i=>[0x20,...uleb(i)];
  const localSet=i=>[0x21,...uleb(i)];
  const i32Const=n=>[0x41,...sleb(n)];
  const memarg=(align,offset=0)=>[...uleb(align),...uleb(offset)];

  const PC=32, CR0=33, TMP=34;
  const getReg=r=>r===0?i32Const(0):localGet(r);
  const effectiveAddress=ins=>[...getReg(ins.ra),...i32Const(ins.imm),0x6a];

  function bswap16FromTmp(){
    return [
      ...localGet(TMP),...i32Const(0xff),0x71,...i32Const(8),0x74,
      ...localGet(TMP),...i32Const(8),0x76,...i32Const(0xff),0x71,0x72
    ];
  }
  function bswap32FromTmp(){
    return [
      ...localGet(TMP),...i32Const(0xff),0x71,...i32Const(24),0x74,
      ...localGet(TMP),...i32Const(0xff00),0x71,...i32Const(8),0x74,0x72,
      ...localGet(TMP),...i32Const(8),0x76,...i32Const(0xff00),0x71,0x72,
      ...localGet(TMP),...i32Const(24),0x76,...i32Const(0xff),0x71,0x72
    ];
  }

  function emitCoreInstruction(ins){
    const a=[];
    switch(ins.op){
      case 'addi': a.push(...getReg(ins.ra),...i32Const(ins.imm),0x6a,...localSet(ins.rt)); break;
      case 'addis': a.push(...getReg(ins.ra),...i32Const((ins.imm<<16)|0),0x6a,...localSet(ins.rt)); break;
      case 'ori': a.push(...localGet(ins.rs),...i32Const(ins.uimm),0x72,...localSet(ins.ra)); break;
      case 'oris': a.push(...localGet(ins.rs),...i32Const((ins.uimm<<16)|0),0x72,...localSet(ins.ra)); break;
      case 'xori': a.push(...localGet(ins.rs),...i32Const(ins.uimm),0x73,...localSet(ins.ra)); break;
      case 'andi': a.push(...localGet(ins.rs),...i32Const(ins.uimm),0x71,...localSet(ins.ra)); break;
      case 'andis': a.push(...localGet(ins.rs),...i32Const((ins.uimm<<16)|0),0x71,...localSet(ins.ra)); break;
      case 'add': a.push(...localGet(ins.ra),...localGet(ins.rb),0x6a,...localSet(ins.rt)); break;
      case 'subf': a.push(...localGet(ins.rb),...localGet(ins.ra),0x6b,...localSet(ins.rt)); break;
      case 'or': a.push(...localGet(ins.rs),...localGet(ins.rb),0x72,...localSet(ins.ra)); break;
      case 'xor': a.push(...localGet(ins.rs),...localGet(ins.rb),0x73,...localSet(ins.ra)); break;
      case 'and': a.push(...localGet(ins.rs),...localGet(ins.rb),0x71,...localSet(ins.ra)); break;
      case 'cmpwi':
        if(ins.bf!==0||ins.l!==0) throw new Error('Only cmpwi cr0, 32-bit is supported');
        a.push(...i32Const(0),...localSet(CR0));
        a.push(...localGet(ins.ra),...i32Const(ins.imm),0x48,0x04,0x40,...i32Const(-1),...localSet(CR0),0x05);
        a.push(...localGet(ins.ra),...i32Const(ins.imm),0x4a,0x04,0x40,...i32Const(1),...localSet(CR0),0x0b,0x0b);
        break;
      case 'lwz':
        a.push(...effectiveAddress(ins),0x28,...memarg(2),...localSet(TMP),...bswap32FromTmp(),...localSet(ins.rt));
        break;
      case 'lbz':
        a.push(...effectiveAddress(ins),0x2d,...memarg(0),...localSet(ins.rt));
        break;
      case 'lhz':
        a.push(...effectiveAddress(ins),0x2f,...memarg(1),...localSet(TMP),...bswap16FromTmp(),...localSet(ins.rt));
        break;
      case 'stw':
        a.push(...localGet(ins.rs),...localSet(TMP),...effectiveAddress(ins),...bswap32FromTmp(),0x36,...memarg(2));
        break;
      case 'stb':
        a.push(...effectiveAddress(ins),...localGet(ins.rs),0x3a,...memarg(0));
        break;
      case 'sth':
        a.push(...localGet(ins.rs),...localSet(TMP),...effectiveAddress(ins),...bswap16FromTmp(),0x3b,...memarg(1));
        break;
      case 'sc':
        a.push(...localGet(0),...localGet(3),0x10,...uleb(0),...localSet(3));
        break;
      default: throw new Error(`WASM core emitter does not support ${ins.op}`);
    }
    return a;
  }

  function targetIndex(ins,addressToIndex,n){
    const target=ins.aa?(ins.disp>>>0):((ins.address+ins.disp)>>>0);
    if(target===((ins.address+4)>>>0)&&ins.disp===4) return Math.min(n,addressToIndex.get(target)??n);
    const idx=addressToIndex.get(target);
    if(idx==null){
      const endAddress=n?((Math.max(...addressToIndex.keys())+4)>>>0):0;
      if(target===endAddress) return n;
      throw new Error(`Branch target ${hex(target)} is outside compiled block`);
    }
    return idx;
  }

  function emitCondition(ins){
    if(ins.bo!==12&&ins.bo!==4) throw new Error(`bc BO=${ins.bo} needs CTR semantics not implemented yet`);
    let cond;
    if(ins.bi===0) cond=[...localGet(CR0),...i32Const(0),0x48];
    else if(ins.bi===1) cond=[...localGet(CR0),...i32Const(0),0x4a];
    else if(ins.bi===2) cond=[...localGet(CR0),0x45];
    else throw new Error(`bc BI=${ins.bi} outside CR0 LT/GT/EQ subset`);
    if(ins.bo===4) cond.push(0x45);
    return cond;
  }

  function compileToWasm(decoded,{resultRegister=3,memoryPages=1}={}){
    if(resultRegister<0||resultRegister>31) throw new Error('resultRegister must be 0..31');
    if(memoryPages<1) throw new Error('memoryPages must be >= 1');
    const bad=decoded.find(x=>!WASM_SUPPORTED.has(x.op)||(x.op==='cmpwi'&&(x.bf!==0||x.l!==0)));
    if(bad) throw new Error(`Unsupported instruction at ${hex(bad.address)}: ${bad.text}`);

    const n=decoded.length;
    const addressToIndex=new Map(decoded.map((x,i)=>[x.address>>>0,i]));
    const body=[];
    body.push(1,...uleb(35),0x7f); // r0-r31, pc, cr0, temp
    body.push(...i32Const(0),...localSet(PC));
    body.push(0x02,0x40,0x03,0x40); // block exit { loop dispatch {
    body.push(...localGet(PC),...i32Const(n),0x4f,0x0d,...uleb(1)); // if pc >= n, break exit

    for(let i=0;i<n;i++){
      const ins=decoded[i];
      body.push(...localGet(PC),...i32Const(i),0x46,0x04,0x40); // if pc == i
      if(ins.op==='b'){
        const target=targetIndex(ins,addressToIndex,n);
        body.push(...i32Const(target),...localSet(PC),0x0c,...uleb(1));
      }else if(ins.op==='bc'){
        const target=targetIndex(ins,addressToIndex,n);
        body.push(...emitCondition(ins),0x04,0x40,
          ...i32Const(target),...localSet(PC),0x05,
          ...i32Const(i+1),...localSet(PC),0x0b,
          0x0c,...uleb(1));
      }else{
        body.push(...emitCoreInstruction(ins),...i32Const(i+1),...localSet(PC),0x0c,...uleb(1));
      }
      body.push(0x0b); // end if
    }
    body.push(0x0c,...uleb(1)); // invalid pc => exit
    body.push(0x0b,0x0b); // end loop, block
    body.push(...(resultRegister===0?i32Const(0):localGet(resultRegister)),0x0b);

    const typeSec=section(1,[
      2,
      0x60,2,0x7f,0x7f,1,0x7f, // runtimeCall(i32,i32)->i32
      0x60,0,1,0x7f             // run()->i32
    ]);
    const importSec=section(2,[1,...str('env'),...str('runtimeCall'),0,0]);
    const funcSec=section(3,[1,1]);
    const memorySec=section(5,[1,0,...uleb(memoryPages)]);
    const exportSec=section(7,[
      2,
      ...str('run'),0,1,
      ...str('memory'),2,0
    ]);
    const codeSec=section(10,[1,...uleb(body.length),...body]);
    return new Uint8Array([0,97,115,109,1,0,0,0,...typeSec,...importSec,...funcSec,...memorySec,...exportSec,...codeSec]);
  }

  async function instantiateWasm(wasmBytes,{runtimeCall}={}){
    const host=runtimeCall||((id,arg)=>arg|0);
    const {instance,module}=await WebAssembly.instantiate(wasmBytes,{env:{runtimeCall:host}});
    return {instance,module,memory:instance.exports.memory};
  }

  async function runWasm(wasmBytes,options={}){
    const {instance}=await instantiateWasm(wasmBytes,options);
    return instance.exports.run()|0;
  }

  function encodeD(op,rt,ra,imm){return (((op&63)<<26)|((rt&31)<<21)|((ra&31)<<16)|(imm&0xffff))>>>0}
  function encodeB(disp,{aa=0,lk=0}={}){return (((18<<26)|(disp&0x03fffffc)|((aa&1)<<1)|(lk&1))>>>0)}
  function encodeBC(bo,bi,disp,{aa=0,lk=0}={}){return (((16<<26)|((bo&31)<<21)|((bi&31)<<16)|(disp&0xfffc)|((aa&1)<<1)|(lk&1))>>>0)}
  function encodeCmpwi(ra,imm,{bf=0,l=0}={}){return (((11<<26)|((bf&7)<<23)|((l&1)<<21)|((ra&31)<<16)|(imm&0xffff))>>>0)}
  function wordsToBytes(words){const out=new Uint8Array(words.length*4);words.forEach((w,i)=>{out[i*4]=w>>>24;out[i*4+1]=w>>>16;out[i*4+2]=w>>>8;out[i*4+3]=w});return out}

  return {decodeWord,decodeBuffer,toIR,compileToWasm,instantiateWasm,runWasm,encodeD,encodeB,encodeBC,encodeCmpwi,wordsToBytes};
});
