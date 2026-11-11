import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
await esbuild.build({
  entryPoints: [path.join(root, 'src/main.tsx')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020', 'chrome90', 'edge90'],
  outfile: path.join(dist, 'app.js'),
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none',
  jsx: 'automatic',
});
fs.copyFileSync(path.join(root, 'index.html'), path.join(dist, 'index.html'));
fs.mkdirSync(path.join(dist, 'data'), { recursive: true });
fs.copyFileSync(path.join(root, 'data/coinglass_latest.json'), path.join(dist, 'data/coinglass_latest.json'));
console.log('app.js', fs.statSync(path.join(dist, 'app.js')).size, 'bytes');
