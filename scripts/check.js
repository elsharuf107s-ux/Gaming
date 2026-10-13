const fs = require('fs');
const os = require('os');

const checks = {
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  cpus: os.cpus().length,
  memoryGiB: Math.round(os.totalmem() / 1024 / 1024 / 1024),
  driPresent: fs.existsSync('/dev/dri'),
  codespaces: Boolean(process.env.CODESPACES)
};

console.log('Xenia Cloud environment check');
console.table(checks);

if (checks.driPresent) {
  console.log('A /dev/dri device is visible. This does not guarantee Xenia compatibility.');
} else {
  console.log('No /dev/dri GPU device detected. Expected for ordinary Codespaces.');
}

console.log('PASS: control-plane environment is usable.');
