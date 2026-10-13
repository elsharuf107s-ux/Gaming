(function(root,factory){
  const F=(typeof module==='object'&&module.exports)?require('./ppc-functions.js'):root.UCRPPCFunctions;
  const S=(typeof module==='object'&&module.exports)?require('./ppc-state.js'):root.UCRPPCState;
  const api=factory(F,S);
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.UCRPPCLinker=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(F,S){
  'use strict';
  if(!F||!S) throw new Error('ppc-functions.js and ppc-state.js are required');
  const hex=v=>'0x'+(v>>>0).toString(16).padStart(8,'0');

  function buildFunctionTable(discovery){
    const map=new Map();
    for(const fn of discovery.functions){
      map.set(fn.start>>>0,{address:fn.start>>>0,end:fn.end>>>0,frame:fn.frame,calls:fn.calls,instructions:fn.instructions});
    }
    return map;
  }

  function classifyCalls(discovery){
    const table=buildFunctionTable(discovery);
    const internal=[]; const external=[];
    for(const fn of discovery.functions){
      for(const call of fn.calls){
        const target=(call.target??call)>>>0;
        const item={from:fn.start>>>0,target,returnAddress:null,internal:table.has(target)};
        (item.internal?internal:external).push(item);
      }
    }
    return {internal,external,table};
  }

  function resolveCall(table,target){return table.get(target>>>0)||null}

  function enterDirectCall(state,{callAddress,target},table){
    callAddress>>>=0; target>>>=0;
    const fn=resolveCall(table,target);
    const returnAddress=(callAddress+4)>>>0;
    S.setSpecial(state,'LR',returnAddress);
    S.setSpecial(state,'PC',target);
    return {ok:Boolean(fn),internal:Boolean(fn),target,returnAddress,function:fn};
  }

  function returnViaLR(state){
    const target=S.getSpecial(state,'LR');
    S.setSpecial(state,'PC',target);
    return target;
  }

  function makeLinkPlan(discovery){
    const {internal,external,table}=classifyCalls(discovery);
    return {
      functions:[...table.values()].map(fn=>({address:hex(fn.address),end:hex(fn.end),leaf:fn.frame.leaf,stackFrameBytes:fn.frame.stackFrameBytes})),
      internalCalls:internal.map(c=>({from:hex(c.from),target:hex(c.target)})),
      externalCalls:external.map(c=>({from:hex(c.from),target:hex(c.target)})),
      linkable:external.length===0
    };
  }

  function findCallSites(discovery){
    const sites=[];
    for(const fn of discovery.functions){
      for(const ins of fn.instructions){
        if(ins.op==='bl') sites.push({functionAddress:fn.start>>>0,callAddress:ins.address>>>0,target:ins.target>>>0,returnAddress:(ins.address+4)>>>0});
      }
    }
    return sites;
  }

  function simulateCallTrace(discovery,state,{entryPoint,maxSteps=64}={}){
    const table=buildFunctionTable(discovery);
    const sites=new Map(findCallSites(discovery).map(s=>[s.callAddress,s]));
    const trace=[]; const returnStack=[];
    let pc=(entryPoint??discovery.functions[0]?.start??0)>>>0;
    S.setSpecial(state,'PC',pc);
    for(let step=0;step<maxSteps;step++){
      const fn=[...table.values()].find(f=>pc>=f.address&&pc<f.end);
      if(!fn){trace.push({pc,event:'external-or-unmapped'});break}
      const ins=fn.instructions.find(i=>(i.address>>>0)===pc);
      if(!ins){trace.push({pc,event:'no-instruction'});break}
      if(ins.op==='bl'){
        const site=sites.get(pc); const r=enterDirectCall(state,site,table);
        trace.push({pc,event:r.internal?'call':'external-call',target:r.target,returnAddress:r.returnAddress});
        if(!r.internal) break;
        returnStack.push(r.returnAddress);pc=r.target;continue;
      }
      if(ins.op==='blr'){
        const ret=returnStack.pop();
        if(ret==null){trace.push({pc,event:'return-root'});break}
        S.setSpecial(state,'LR',ret);pc=returnViaLR(state);trace.push({pc,event:'return'});continue;
      }
      pc=(pc+4)>>>0;S.setSpecial(state,'PC',pc);trace.push({pc:ins.address>>>0,event:'step',op:ins.op});
    }
    return {trace,finalPC:S.getSpecial(state,'PC'),finalLR:S.getSpecial(state,'LR'),returnedToRoot:returnStack.length===0};
  }

  return {buildFunctionTable,classifyCalls,resolveCall,enterDirectCall,returnViaLR,makeLinkPlan,findCallSites,simulateCallTrace};
});
