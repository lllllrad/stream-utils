'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', '.git', 'build', 'dist'].includes(entry.name)) return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? files(full) : full.endsWith('.js') ? [full] : [];
  });
}

for (const file of files(root)) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('JavaScript syntax checks passed.');

for (const entry of fs.readdirSync(path.join(root, 'projects'), { withFileTypes: true })) {
  const config = path.join(root, 'projects', entry.name, 'tsconfig.json');
  if (!entry.isDirectory() || !fs.existsSync(config)) continue;
  const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!fs.existsSync(tsc)) throw new Error('Run npm install for TypeScript checks.');
  const result = spawnSync(process.execPath, [tsc, '-p', config, '--noEmit'], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('TypeScript checks passed.');
