#!/usr/bin/env node
import { rm } from 'node:fs/promises';
for (const dir of ['dist', 'web-ext-artifacts']) {
  await rm(dir, { recursive: true, force: true });
}
console.log('[clean] removed dist/ and web-ext-artifacts/');
