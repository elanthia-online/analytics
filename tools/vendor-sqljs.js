// Copies the browser build of sql.js from node_modules into site/vendor, with
// its license and a checksum file, so the published site has no CDN or build
// step. Run after changing the sql.js version in package.json, and commit
// the result. CI checks the copies still match (npm run vendor -- --check).
import { createHash } from 'node:crypto';
import { copyFileSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const from = new URL('../node_modules/sql.js/', import.meta.url);
const to = new URL('../site/vendor/sql.js/', import.meta.url);
const files = [['dist/sql-wasm-browser.js', 'sql-wasm-browser.js'], ['dist/sql-wasm-browser.wasm', 'sql-wasm-browser.wasm'], ['LICENSE', 'LICENSE']];
const version = JSON.parse(readFileSync(new URL('package.json', from))).version;
const sha = (url) => createHash('sha256').update(readFileSync(url)).digest('hex');
const manifest = `sql.js ${version} (https://github.com/sql-js/sql.js), MIT licensed\n` +
  files.map(([src, dst]) => `${sha(new URL(src, from))}  ${dst}`).join('\n') + '\n';

if (process.argv.includes('--check')) {
  const have = readFileSync(new URL('VERSION', to), 'utf8');
  const copies = files.every(([, dst]) => have.includes(`${sha(new URL(dst, to))}  ${dst}`));
  if (have !== manifest || !copies) {
    console.error('site/vendor/sql.js does not match node_modules/sql.js; run npm run vendor and commit');
    process.exit(1);
  }
  console.log(`site/vendor/sql.js matches sql.js ${version}`);
} else {
  mkdirSync(to, { recursive: true });
  for (const [src, dst] of files) copyFileSync(new URL(src, from), new URL(dst, to));
  writeFileSync(new URL('VERSION', to), manifest);
  console.log(`vendored sql.js ${version}`);
}
