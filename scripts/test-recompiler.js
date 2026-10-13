const assert = require('assert');
const { detect, buildManifest } = require('../public/recompiler-core.js');

function buf(size=128){ return new Uint8Array(size); }

{
  const b=buf(); b.set(Buffer.from('XEX2'));
  const r=detect(b,'default.xex');
  assert.equal(r.platform,'Xbox 360');
  assert.equal(r.adapter,'xbox360-xex2');
}

{
  const b=buf(); b.set([0x7f,0x45,0x4c,0x46,2,2],0); // ELF64 big-endian
  b[18]=0; b[19]=21; // PowerPC64
  const r=detect(b,'game.self');
  assert.equal(r.format,'ELF');
  assert.equal(r.cpu,'PowerPC64');
}

{
  const b=buf(); b[0]=0x4d;b[1]=0x5a;b[0x3c]=0x40;
  b.set([0x50,0x45,0x00,0x00,0x64,0x86],0x40);
  const r=detect(b,'game.exe');
  assert.equal(r.cpu,'x86-64');
  assert.equal(r.format,'PE/COFF');
}

{
  const b=buf(); b.set(Buffer.from('PS-X EXE'));
  const r=detect(b,'SLUS.EXE');
  assert.equal(r.platform,'PlayStation 1');
}

{
  const b=buf(); b.set([0x80,0x37,0x12,0x40]);
  const r=detect(b,'game.z64');
  assert.equal(r.platform,'Nintendo 64');
  const m=buildManifest(r,1024);
  assert.equal(m.schema,'ucr-manifest/v1');
  assert.equal(m.routing.adapter,'n64');
}

console.log('Universal recompiler detection tests passed.');
