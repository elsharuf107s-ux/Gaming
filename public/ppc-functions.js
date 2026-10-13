(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./ppc-core.js'):root.UCRPPC);
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.UCRPPCFunctions=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(PPC){
  'use strict';
  if(!PPC) throw new Error('UCRPPC core is required');

  const hex=v=>'0x'+(v>>>0).toString(16).padStart(8,'0');
  const s16=v=>(v&0x8000)?v-0x10000:v;

  function decodeControl(word,address=0){
    word>>>=0; address>>>=0;
    const op=word>>>26;
    if(op===18){
      let li=word&0x03fffffc;
      if(li&0x02000000) li|=0xfc000000;
      const aa=(word>>>1)&1, lk=word&1;
      const target=aa?(li>>>0):((address+(li|0))>>>0);
      return {address,word,op:lk?'bl':'b',target,disp:li|0,aa,lk,text:`${lk?'bl':'b'} ${hex(target)}`};
    }
    if(op===19){
      const bo=(word>>>21)&31, bi=(word>>>16)&31, xo=(word>>>1)&0x3ff, lk=word&1;
      if(xo===16){
        const isBlr=bo===20&&bi===0&&!lk;
        return {address,word,op:isBlr?'blr':'bclr',bo,bi,lk,text:isBlr?'blr':`bclr ${bo},${bi}`};
      }
      if(xo===528){
        const isBctr=bo===20&&bi===0&&!lk;
        return {address,word,op:isBctr?'bctr':'bcctr',bo,bi,lk,text:isBctr?'bctr':`bcctr ${bo},${bi}`};
      }
    }
    if(op===31){
      const rt=(word>>>21)&31, ra=(word>>>16)&31;
      const xo=(word>>>1)&0x3ff;
      const sprEncoded=(word>>>11)&0x3ff;
      const spr=((sprEncoded&31)<<5)|((sprEncoded>>>5)&31);
      if(xo===339){
        const name=spr===8?'lr':spr===9?'ctr':`spr${spr}`;
        return {address,word,op:'mfspr',rt,spr,name,text:`mf${name} r${rt}`};
      }
      if(xo===467){
        const name=spr===8?'lr':spr===9?'ctr':`spr${spr}`;
        return {address,word,op:'mtspr',rs:rt,spr,name,text:`mt${name} r${rt}`};
      }
    }
    if(op===37){
      const rs=(word>>>21)&31, ra=(word>>>16)&31, imm=s16(word&0xffff);
      return {address,word,op:'stwu',rs,ra,imm,text:`stwu r${rs}, ${imm}(r${ra})`};
    }
    if(op===33){
      const rt=(word>>>21)&31, ra=(word>>>16)&31, imm=s16(word&0xffff);
      return {address,word,op:'lwzu',rt,ra,imm,text:`lwzu r${rt}, ${imm}(r${ra})`};
    }
    return PPC.decodeWord(word,address);
  }

  function decodeBuffer(buffer,{offset=0,count,baseAddress=0}={}){
    const bytes=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);
    const max=Math.floor((bytes.length-offset)/4);
    const n=Math.min(count==null?max:count,max);
    const out=[];
    for(let i=0;i<n;i++){
      const p=offset+i*4;
      const word=((bytes[p]<<24)|(bytes[p+1]<<16)|(bytes[p+2]<<8)|bytes[p+3])>>>0;
      out.push(decodeControl(word,(baseAddress+i*4)>>>0));
    }
    return out;
  }

  function classifyFrame(instructions){
    const first=instructions.slice(0,8);
    const last=instructions.slice(-8);
    const stackPush=first.find(x=>x.op==='stwu'&&x.rs===1&&x.ra===1&&x.imm<0);
    const saveLrReg=first.find(x=>x.op==='mfspr'&&x.spr===8);
    const restoreLr=last.find(x=>x.op==='mtspr'&&x.spr===8);
    const ret=last.find(x=>x.op==='blr');
    return {
      stackFrameBytes:stackPush?Math.abs(stackPush.imm):0,
      savesLR:Boolean(saveLrReg),
      restoresLR:Boolean(restoreLr),
      returnsWithBLR:Boolean(ret),
      leaf:!instructions.some(x=>x.op==='bl')
    };
  }

  function discoverFunctions(buffer,{baseAddress=0,entryPoints=[baseAddress],maxInstructions=16384,maxFunctionInstructions=4096}={}){
    const all=decodeBuffer(buffer,{baseAddress,count:maxInstructions});
    const byAddress=new Map(all.map(x=>[x.address>>>0,x]));
    const queue=[...new Set(entryPoints.map(x=>x>>>0))];
    const seen=new Set();
    const functions=[];

    while(queue.length){
      const start=queue.shift()>>>0;
      if(seen.has(start)||!byAddress.has(start)) continue;
      seen.add(start);
      const instructions=[];
      const calls=[];
      let pc=start;
      let terminated=false;
      for(let i=0;i<maxFunctionInstructions;i++,pc=(pc+4)>>>0){
        const ins=byAddress.get(pc);
        if(!ins) break;
        instructions.push(ins);
        if(ins.op==='bl'){
          calls.push(ins.target>>>0);
          if(byAddress.has(ins.target>>>0)&&!seen.has(ins.target>>>0)) queue.push(ins.target>>>0);
        }
        if(ins.op==='blr'||ins.op==='bctr') { terminated=true; break; }
        if(ins.op==='b' && ins.target!==((pc+4)>>>0)){
          // Treat forward/backward intra-function branch as control flow, but a branch outside loaded range ends the walk.
          if(!byAddress.has(ins.target>>>0)){ terminated=true; break; }
        }
      }
      if(!instructions.length) continue;
      functions.push({
        start,
        end:(instructions[instructions.length-1].address+4)>>>0,
        sizeBytes:instructions.length*4,
        instructionCount:instructions.length,
        terminated,
        calls:[...new Set(calls)],
        frame:classifyFrame(instructions),
        instructions
      });
    }

    const knownStarts=new Set(functions.map(f=>f.start));
    for(const f of functions){
      f.calls=f.calls.map(target=>({target,internal:knownStarts.has(target)}));
    }
    return {baseAddress:baseAddress>>>0,functions,decodedInstructionCount:all.length};
  }

  function buildCallGraph(discovery){
    return discovery.functions.map(f=>({
      function:hex(f.start),
      frame:f.frame,
      calls:f.calls.map(c=>({target:hex(c.target),internal:c.internal})),
      instructionCount:f.instructionCount
    }));
  }

  function summarize(discovery){
    const funcs=discovery.functions;
    return {
      functionCount:funcs.length,
      leafFunctions:funcs.filter(f=>f.frame.leaf).length,
      framedFunctions:funcs.filter(f=>f.frame.stackFrameBytes>0).length,
      directCalls:funcs.reduce((n,f)=>n+f.calls.length,0),
      lrSaveFunctions:funcs.filter(f=>f.frame.savesLR).length,
      cleanReturns:funcs.filter(f=>f.frame.returnsWithBLR).length
    };
  }

  function encodeB(from,to,{link=false,absolute=false}={}){
    const disp=absolute?(to|0):((to-from)|0);
    return (((18<<26)|(disp&0x03fffffc)|(absolute?2:0)|(link?1:0))>>>0);
  }
  function encodeBclr({bo=20,bi=0,link=false}={}){
    return (((19<<26)|((bo&31)<<21)|((bi&31)<<16)|(16<<1)|(link?1:0))>>>0);
  }
  function encodeMfspr(rt,spr){
    const enc=((spr&31)<<5)|((spr>>>5)&31);
    return (((31<<26)|((rt&31)<<21)|(enc<<11)|(339<<1))>>>0);
  }
  function encodeMtspr(rs,spr){
    const enc=((spr&31)<<5)|((spr>>>5)&31);
    return (((31<<26)|((rs&31)<<21)|(enc<<11)|(467<<1))>>>0);
  }
  function encodeD(op,rt,ra,imm){return (((op&63)<<26)|((rt&31)<<21)|((ra&31)<<16)|(imm&0xffff))>>>0}
  function wordsToBytes(words){return PPC.wordsToBytes(words)}

  return {decodeControl,decodeBuffer,classifyFrame,discoverFunctions,buildCallGraph,summarize,encodeB,encodeBclr,encodeMfspr,encodeMtspr,encodeD,wordsToBytes};
});
