'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const projects = path.resolve(__dirname, '../projects');
for (const entry of fs.readdirSync(projects, { withFileTypes: true })) {
  const project = path.join(projects, entry.name);
  const config = path.join(project, 'tsconfig.json');
  if (!entry.isDirectory() || !fs.existsSync(config)) continue;
  const tsc = path.resolve(__dirname, '../node_modules/typescript/bin/tsc');
  if (!fs.existsSync(tsc)) throw new Error('Run npm install for TypeScript tests.');
  const result = spawnSync(process.execPath, [tsc, '-p', config], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
const suites = fs.readdirSync(projects, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(projects, entry.name,
    fs.existsSync(path.join(projects, entry.name, 'tsconfig.json')) ? 'dist/test' : 'test'))
  .filter((dir) => fs.existsSync(dir))
  .flatMap((dir) => fs.readdirSync(dir)
    .filter((name) => name.endsWith('.test.js'))
    .map((name) => path.join(dir, name)));
if (!suites.length) throw new Error('No test suites found');
const result = spawnSync(process.execPath, ['--test', ...suites], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
