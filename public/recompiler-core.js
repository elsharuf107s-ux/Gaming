(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.UniversalRecompiler=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const hex=(n,w=4)=>'0x'+Number(n).toString(16).padStart(w,'0').toUpperCase();
  const ascii=(u8,start,len)=>String.fromCharCode(...u8.slice(start,start+len));
  const u16le=(d,o)=>d.getUint16(o,true);
  const u32le=(d,o)=>d.getUint32(o,true);
  const u32be=(d,o)=>d.getUint32(o,false);

  function extension(name=''){
    const m=String(name).toLowerCase().match(/\.([^.]+)$/);
    return m?m[1]:'';
  }

  function detect(buffer,name=''){
    const u8=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);
    const d=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
    const ext=extension(name);
    const out={
      filename:name||'unknown',format:'unknown',platform:'unknown',cpu:'unknown',bits:null,
      endianness:'unknown',confidence:'low',backend:'manual',adapter:'unknown',details:[]
    };

    if(u8.length>=4 && ascii(u8,0,4)==='XEX2'){
      return {...out,format:'XEX2',platform:'Xbox 360',cpu:'PowerPC',bits:64,endianness:'big',confidence:'high',backend:'static-recomp-or-remote',adapter:'xbox360-xex2',details:['Xbox 360 executable container detected from XEX2 magic.']};
    }

    if(u8.length>=4 && u8[0]===0x7F&&u8[1]===0x45&&u8[2]===0x4C&&u8[3]===0x46){
      const cls=u8[4], data=u8[5];
      const little=data!==2;
      const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
      const machine=dv.getUint16(18,little);
      const machines={
        3:['x86','generic ELF'],8:['MIPS','MIPS console/Linux'],20:['PowerPC','PowerPC'],21:['PowerPC64','PowerPC64'],
        40:['ARM','ARM'],62:['x86-64','x86-64'],183:['AArch64','ARM64']
      };
      const m=machines[machine]||['unknown','generic ELF'];
      let platform=m[1];
      let adapter='elf-generic';
      if(machine===21 && (ext==='self'||ext==='sprx')){platform='PlayStation 3 (heuristic)';adapter='ps3-cell-elf';}
      return {...out,format:'ELF',platform,cpu:m[0],bits:cls===2?64:32,endianness:little?'little':'big',confidence:'high',backend:'static-recomp',adapter,details:[`ELF machine ${hex(machine)}`]};
    }

    if(u8.length>=0x40 && u8[0]===0x4D&&u8[1]===0x5A){
      const pe=u32le(d,0x3C);
      if(pe+6<u8.length && ascii(u8,pe,4)==='PE\0\0'){
        const machine=u16le(d,pe+4);
        const machines={0x014c:['x86',32],0x8664:['x86-64',64],0x01f0:['PowerPC',32],0x01f2:['PowerPC',32],0xaa64:['AArch64',64]};
        const m=machines[machine]||['unknown',null];
        return {...out,format:'PE/COFF',platform:'Windows / PE-compatible',cpu:m[0],bits:m[1],endianness:'little',confidence:'high',backend:'native-or-wasm-port',adapter:'pe-coff',details:[`PE machine ${hex(machine)}`]};
      }
    }

    if(u8.length>=8 && ascii(u8,0,8)==='PS-X EXE'){
      return {...out,format:'PS-X EXE',platform:'PlayStation 1',cpu:'MIPS R3000A',bits:32,endianness:'little',confidence:'high',backend:'browser-emulator',adapter:'ps1',details:['PS-X EXE signature detected.']};
    }

    if(u8.length>=4){
      const magic=u32be(d,0);
      const n64={0x80371240:'big',0x37804012:'byteswapped',0x40123780:'little'};
      if(n64[magic]){
        return {...out,format:'N64 ROM',platform:'Nintendo 64',cpu:'MIPS R4300i',bits:64,endianness:n64[magic],confidence:'high',backend:'browser-emulator',adapter:'n64',details:[`N64 ROM magic ${hex(magic,8)}`]};
      }
    }

    if(u8.length>=4 && ascii(u8,0,3)==='SCE'){
      return {...out,format:'SCE/SELF (heuristic)',platform:'PlayStation family',cpu:'unknown',bits:null,endianness:'big',confidence:'medium',backend:'static-recomp-or-remote',adapter:'sce-container',details:['SCE-style container signature detected; platform version needs deeper parsing.']};
    }

    const extMap={
      nes:['NES ROM','Nintendo Entertainment System','6502',8,'little','browser-emulator','nes'],
      sfc:['SNES ROM','Super Nintendo','65C816',16,'little','browser-emulator','snes'],
      smc:['SNES ROM','Super Nintendo','65C816',16,'little','browser-emulator','snes'],
      gb:['Game Boy ROM','Game Boy','LR35902',8,'little','browser-emulator','gb'],
      gbc:['Game Boy Color ROM','Game Boy Color','LR35902',8,'little','browser-emulator','gbc'],
      gba:['GBA ROM','Game Boy Advance','ARM7TDMI',32,'little','browser-emulator','gba'],
      nds:['NDS ROM','Nintendo DS','ARM9 + ARM7',32,'little','browser-emulator','nds'],
      iso:['Disc image','Unknown optical-disc console','unknown',null,'unknown','manual','disc-image'],
      xbe:['XBE','Original Xbox','x86',32,'little','static-recomp-or-remote','xbox-xbe'],
      dol:['DOL','GameCube/Wii','PowerPC',32,'big','static-recomp-or-emulator','gcwii-dol'],
      self:['SELF','PlayStation 3 (heuristic)','Cell/PowerPC64',64,'big','static-recomp-or-remote','ps3-self']
    };
    if(extMap[ext]){
      const m=extMap[ext];
      return {...out,format:m[0],platform:m[1],cpu:m[2],bits:m[3],endianness:m[4],confidence:'medium',backend:m[5],adapter:m[6],details:['Detected primarily from file extension; deeper parser recommended.']};
    }
    return out;
  }

  function buildManifest(info,size=0){
    return {
      schema:'ucr-manifest/v1',
      createdAt:new Date().toISOString(),
      source:{filename:info.filename,sizeBytes:size,privacy:'local-analysis-only'},
      target:{platform:info.platform,format:info.format,cpu:info.cpu,bits:info.bits,endianness:info.endianness},
      routing:{backend:info.backend,adapter:info.adapter,confidence:info.confidence},
      runtime:{graphics:'adapter-defined',audio:'adapter-defined',input:'gamepad+keyboard',filesystem:'sandboxed',timing:'browser-or-adapter'},
      notes:info.details
    };
  }

  return {detect,buildManifest};
});
