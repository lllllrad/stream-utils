'use strict';
const args = process.argv.slice(2);
require('./src/cli').run(args.length ? args : ['watch-pixels']);
