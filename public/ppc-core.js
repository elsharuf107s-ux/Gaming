(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.UCRPPC=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const s16=v=>(v&0x8000)?v-0x10000:v;
  const u16=v=>v&0xffff;
  const hex=v=>'0x'+(v>>>0).toString(16).padStart(8,'0');

  function decodeWord(word,address=0){
    word>>>=0;
    const op=word>>>26;
    const rt=(word>>>21)&31;
    const ra=(word>>>16)&31;
    const rb=(word>>>11)&31;
    const imm=s16(word&0xffff);
    const uimm=u16(word);
    if(op===14) return {address,word,op:'addi',rt,ra,imm,text:`addi r${rt}, r${ra}, ${imm}`};
    if(op===15) return {address,word,op:'addis',rt,ra,imm,text:`addis r${rt}, r${ra}, ${imm}`};
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
    if(op===18){
      let li=word&0x03fffffc;
      if(li&0x02000000) li|=0xfc000000;
      const aa=(word>>>1)&1, lk=word&1;
      return {address,word,op:'b',disp:li|0,aa,lk,text:`b${lk?'l':''} ${aa?hex(li):((li|0)>=0?'+':'')+(li|0)}`};
    }
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
      out.push(decodeWord(word,baseAddress+i*4));
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
      supportedForWasm:['addi','addis','ori','oris','xori','andi','andis','add','subf','or','xor','and'].includes(ins.op)
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

  function emitInstruction(ins){
    const a=[];
    const getReg=r=>r===0?i32Const(0):localGet(r);
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
      default: throw new Error(`WASM emitter does not support ${ins.op}`);
    }
    return a;
  }

  function compileToWasm(decoded,{resultRegister=3}={}){
    const bad=decoded.find(x=>!['addi','addis','ori','oris','xori','andi','andis','add','subf','or','xor','and'].includes(x.op));
    if(bad) throw new Error(`Unsupported instruction at ${hex(bad.address)}: ${bad.text}`);
    if(resultRegister<0||resultRegister>31) throw new Error('resultRegister must be 0..31');

    const body=[];
    body.push(1,...uleb(32),0x7f); // 32 i32 locals; registers begin at local 0
    for(const ins of decoded) body.push(...emitInstruction(ins));
    body.push(...(resultRegister===0?i32Const(0):localGet(resultRegister)),0x0b);

    const typeSec=section(1,[1,0x60,0,1,0x7f]);
    const funcSec=section(3,[1,0]);
    const exportSec=section(7,[1,...str('run'),0,0]);
    const codeSec=section(10,[1,...uleb(body.length),...body]);
    return new Uint8Array([0,97,115,109,1,0,0,0,...typeSec,...funcSec,...exportSec,...codeSec]);
  }

  async function runWasm(wasmBytes){
    const {instance}=await WebAssembly.instantiate(wasmBytes,{});
    return instance.exports.run()|0;
  }

  function encodeD(op,rt,ra,imm){return (((op&63)<<26)|((rt&31)<<21)|((ra&31)<<16)|(imm&0xffff))>>>0}
  function wordsToBytes(words){const out=new Uint8Array(words.length*4);words.forEach((w,i)=>{out[i*4]=w>>>24;out[i*4+1]=w>>>16;out[i*4+2]=w>>>8;out[i*4+3]=w});return out}

  return {decodeWord,decodeBuffer,toIR,compileToWasm,runWasm,encodeD,wordsToBytes};
});
