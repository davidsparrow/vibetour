// Builds the VS Code extension, the browser app (webview / companion / demo)
// and the standalone CLI companion with esbuild.
//
//   node scripts/build.mjs            production build
//   node scripts/build.mjs --dev      unminified with sourcemaps
//   node scripts/build.mjs --watch    rebuild on change
import * as esbuild from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const dev = args.has('--dev') || args.has('--watch');
const watch = args.has('--watch');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

const define = { __VIBETOUR_VERSION__: JSON.stringify(pkg.version) };

/** @type {esbuild.BuildOptions[]} */
const builds = [
  {
    entryPoints: [join(root, 'src/extension/extension.ts')],
    outfile: join(root, 'dist/extension.js'),
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['vscode'],
  },
  {
    entryPoints: [join(root, 'src/cli/companion.ts')],
    outfile: join(root, 'dist/cli.js'),
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    entryPoints: { app: join(root, 'src/webview/main.ts') },
    outdir: join(root, 'dist/webview'),
    platform: 'browser',
    format: 'iife',
    target: ['chrome110', 'firefox115', 'safari16'],
    loader: { '.css': 'css' },
  },
];

async function copyStatic() {
  await mkdir(join(root, 'dist/webview'), { recursive: true });
  await copyFile(join(root, 'src/webview/index.html'), join(root, 'dist/webview/index.html'));
  await copyFile(join(root, 'src/webview/favicon.svg'), join(root, 'dist/webview/favicon.svg'));
  await writeFile(join(root, 'dist/webview/version.json'), JSON.stringify({ version: pkg.version }));
}

const common = { bundle: true, minify: !dev, sourcemap: dev, define, logLevel: 'info', legalComments: 'none' };

if (watch) {
  for (const b of builds) {
    const ctx = await esbuild.context({ ...common, ...b });
    await ctx.watch();
  }
  await copyStatic();
  console.log('watching…');
} else {
  await Promise.all(builds.map((b) => esbuild.build({ ...common, ...b })));
  await copyStatic();
}
