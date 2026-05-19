import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, extname } from 'path';

const PORT = parseInt(process.env.PORT || '8765', 10);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'dashboard');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

createServer((req, res) => {
  let path = req.url.split('?')[0];
  if (path === '/' || path === '') path = '/standalone.html';
  const fp = join(ROOT, path);
  if (!fp.startsWith(ROOT) || !existsSync(fp)) {
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(fp)] || 'application/octet-stream' });
  res.end(readFileSync(fp));
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Static server on http://127.0.0.1:${PORT}/`);
});
