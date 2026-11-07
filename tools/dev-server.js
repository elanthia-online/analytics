// Serves site/ on http://localhost:8000 for local development, with the
// headers GitHub Pages would send for these file types. No build step:
// what you see here is what Pages publishes.
//
//   node tools/dev-server.js [--port 8000]
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const at = args.indexOf('--port');
const PORT = Number(at >= 0 ? args[at + 1] : 8000);
const ROOT = fileURLToPath(new URL('../site/', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '': 'text/plain',
};

export function startDevServer(port = PORT) {
  const server = http.createServer(async (req, res) => {
    let path;
    // A malformed percent escape is the client's mistake, not a reason to stop serving
    try { path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); res.end(); return; }
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startDevServer().then(() => console.log(`site/ on http://localhost:${PORT}`));
}
