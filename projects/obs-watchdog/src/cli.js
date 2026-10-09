'use strict';

const { loadConfig } = require('./config');
const { connect } = require('./obs-client');
const { recoverSource } = require('./monitor');
const { manageFilter } = require('./filters');
const { watch } = require('./runtime');

const HELP = `OBS watchdog (Node.js 22.15+)
  node src/cli.js watch                  Native frame heartbeat watchdog
  node src/cli.js watch-pixels           Legacy screenshot watchdog (webcams only)
  node src/cli.js recover "source"       Reapply one input's settings
  node src/cli.js filter add "source" [filterKind]
  node src/cli.js filter check "source"
  node src/cli.js filter remove "source" ["source2" ...]
  node src/cli.js filter reattach "source"

Copy config.example.json to config.local.json and set OBS_WS_PASSWORD.
Use Node's --env-file=.env option to load an optional .env file.`;

async function main(args = process.argv.slice(2)) {
  const [command = 'watch', action, ...rest] = args;
  if (['--help', '-h', 'help'].includes(command)) { console.log(HELP); return; }
  const valid = (['watch', 'watch-pixels'].includes(command) && args.length <= 1)
    || (command === 'recover' && Boolean(action) && !rest.length)
    || (command === 'filter' && ['add', 'check', 'remove', 'reattach'].includes(action) && Boolean(rest[0])
      && (action === 'remove' || rest.length <= (action === 'add' ? 2 : 1)));
  if (!valid) throw new Error(`Invalid command or arguments.\n${HELP}`);
  const config = loadConfig();
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    if (command === 'watch' || command === 'watch-pixels') {
      await watch(config, { mode: command === 'watch' ? 'native' : 'pixels', signal: controller.signal });
      return;
    }
    const client = await connect(config, { signal: controller.signal });
    try {
      if (command === 'recover') {
        await recoverSource(client.request, action);
        console.log(`[${action}] recovery request completed`);
      } else {
        const sources = action === 'remove' ? rest : [rest[0]];
        for (const source of sources) console.log(JSON.stringify(await manageFilter(client.request, action, source, action === 'add' ? rest[1] : undefined), null, 2));
      }
    } finally { client.close(); }
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

function run(args) {
  main(args).catch((error) => { console.error(error.message); process.exitCode = 1; });
}

if (require.main === module) run();
module.exports = { main, run };
