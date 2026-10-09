'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const projects = path.resolve(__dirname, '../projects');
const suites = fs.readdirSync(projects, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(projects, entry.name, 'test'))
  .filter((dir) => fs.existsSync(dir))
  .flatMap((dir) => fs.readdirSync(dir)
    .filter((name) => name.endsWith('.test.js'))
    .map((name) => path.join(dir, name)));
if (!suites.length) throw new Error('No test suites found');
const result = spawnSync(process.execPath, ['--test', ...suites], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
