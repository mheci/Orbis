#!/usr/bin/env node
/** Produce an unsigned .zip suitable for AMO submission or `web-ext sign`. */
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';

import { deflateRawSync, crc32 } from 'node:zlib';
import path from 'node:path';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const outDir = 'web-ext-artifacts';
await mkdir(outDir, { recursive: true });
const outFile = path.join(outDir, `g_container-${pkg.version}.zip`);

async function walk(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full, base)));
    else files.push({ full, rel: path.relative(base, full).split(path.sep).join('/') });
  }
  return files.sort((a, b) => a.rel.localeCompare(b.rel));
}

const files = await walk('dist');
if (files.length === 0) {
  console.error('[package] dist/ is empty — run "npm run build" first');
  process.exit(1);
}

// Minimal deterministic ZIP writer (no external dependency, reproducible output).
const chunks = [];
const central = [];
let offset = 0;
const DOS_TIME = 0x0000;
const DOS_DATE = 0x2100; // 1 Jan 1996 — fixed for reproducible builds.

for (const file of files) {
  const data = await readFile(file.full);
  const name = Buffer.from(file.rel, 'utf8');
  const compressed = deflateRawSync(data, { level: 9 });
  const useDeflate = compressed.length < data.length;
  const payload = useDeflate ? compressed : data;
  const method = useDeflate ? 8 : 0;
  const sum = crc32(data) >>> 0;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(sum, 14);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  chunks.push(local, name, payload);

  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(method, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(sum, 16);
  header.writeUInt32LE(payload.length, 20);
  header.writeUInt32LE(data.length, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt32LE(0, 42);
  header.writeUInt32LE(offset, 42);
  central.push(Buffer.concat([header, name]));
  offset += local.length + name.length + payload.length;
}

const centralBuffer = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralBuffer.length, 12);
end.writeUInt32LE(offset, 16);

await writeFile(outFile, Buffer.concat([...chunks, centralBuffer, end]));
const { size } = await stat(outFile);
console.log(`[package] ${outFile} (${files.length} files, ${(size / 1024).toFixed(1)} KiB)`);
