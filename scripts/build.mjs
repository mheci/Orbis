#!/usr/bin/env node
/**
 * esbuild bundling for the three entry points.
 * JSON domain files are inlined at build time, so the shipped add-on performs
 * no network access and no runtime file I/O.
 */
import { build, context } from 'esbuild';
import { mkdir } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
const dev = watch || process.env.NODE_ENV === 'development';

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: {
    background: 'src/background/index.ts',
    'popup/popup': 'src/popup/popup.ts',
    'options/options': 'src/options/options.ts',
  },
  outdir: 'dist',
  bundle: true,
  format: 'esm',
  target: ['firefox140'],
  platform: 'browser',
  sourcemap: dev ? 'inline' : false,
  minify: !dev,
  legalComments: 'none',
  logLevel: 'info',
  loader: { '.json': 'json' },
  define: { 'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production') },
};

await mkdir('dist', { recursive: true });

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('[build] watching for changes…');
} else {
  await build(options);
  console.log('[build] bundles written to dist/');
}
