import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 5178);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.hdr': 'image/vnd.radiance',
  '.wasm': 'application/wasm',
};

const server = createServer(async (req, res) => {
  try {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
    const file = normalize(join(root, rel));
    if (!file.startsWith(root + sep) && file !== root) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const info = await stat(file);
    if (info.isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    const buf = await readFile(file);
    res.writeHead(200, {
      'content-type': types[extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(buf);
  } catch {
    res.writeHead(404).end('not found');
  }
});

server.on('error', (err) => {
  console.error('server error:', err.message);
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`像素蓝鲸 → http://127.0.0.1:${port}`);
});
