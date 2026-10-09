'use strict';

const fs = require('node:fs');
const path = require('node:path');
const PREFIX = 'obs-frame-heartbeat-native-';

function parseHeartbeat(content) {
  const fields = content.replace(/[\r\n]+$/u, '').split('\t');
  if (fields.length !== 3 || !fields[0] || !/^\d+$/u.test(fields[1]) || !/^\d+$/u.test(fields[2])) {
    throw new Error('Invalid heartbeat record');
  }
  const writtenAt = Number(fields[2]);
  if (!Number.isSafeInteger(writtenAt) || writtenAt <= 0) throw new Error('Invalid heartbeat timestamp');
  return { name: fields[0], count: BigInt(fields[1]), writtenAt };
}

function readHeartbeats(dir) {
  const records = new Map();
  let entries;
  try { entries = fs.readdirSync(dir); }
  catch (error) { if (error.code === 'ENOENT') return records; throw error; }
  for (const name of entries) {
    if (!name.startsWith(PREFIX) || !name.endsWith('.txt')) continue;
    try {
      const full = path.join(dir, name);
      const heartbeat = { ...parseHeartbeat(fs.readFileSync(full, 'utf8')), filePath: full, modifiedAt: fs.statSync(full).mtimeMs };
      const previous = records.get(heartbeat.name);
      if (!previous || heartbeat.writtenAt > previous.writtenAt
        || (heartbeat.writtenAt === previous.writtenAt && heartbeat.modifiedAt > previous.modifiedAt)) records.set(heartbeat.name, heartbeat);
    } catch { /* A replaced/partial/unreadable record is retried on the next poll. */ }
  }
  return records;
}

module.exports = { parseHeartbeat, readHeartbeats };
