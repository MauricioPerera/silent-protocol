// Servidor estático endurecido para jugar en el navegador
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF_PATH = fileURLToPath(import.meta.url);
export const DEFAULT_ROOT = fileURLToPath(new URL('.', import.meta.url));
const HOST = process.env.HOST || '127.0.0.1';
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8',
};

function isForbiddenRelative(rel) {
  if (rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || isAbsolute(rel)) return true;
  if (!rel) return false;
  return rel.split(/[\\/]/).some((seg) => seg.startsWith('.'));
}

export function createStaticHandler(rootDir = DEFAULT_ROOT) {
  let resolvedRootPromise = null;
  return async (req, res) => {
    try {
      const method = req.method || 'GET';
      if (method !== 'GET' && method !== 'HEAD') {
        res.writeHead(405, {
          'content-type': 'text/plain; charset=utf-8',
          allow: 'GET, HEAD',
          'x-content-type-options': 'nosniff',
        }).end('method not allowed');
        return;
      }

      const rawUrl = (req.url || '/').split('?')[0];
      let decoded;
      try {
        decoded = decodeURIComponent(rawUrl);
      } catch {
        res.writeHead(400, {
          'content-type': 'text/plain; charset=utf-8',
          'x-content-type-options': 'nosniff',
        }).end('bad request');
        return;
      }
      if (decoded.includes('\0')) {
        res.writeHead(400, {
          'content-type': 'text/plain; charset=utf-8',
          'x-content-type-options': 'nosniff',
        }).end('bad request');
        return;
      }

      resolvedRootPromise ||= realpath(resolve(rootDir));
      const rootReal = await resolvedRootPromise;
      const stripped = decoded.replace(/^[\\/]+/, '');
      let candidate = resolve(rootReal, stripped);
      const lexRel = relative(rootReal, candidate);
      if (isForbiddenRelative(lexRel)) {
        res.writeHead(403, {
          'content-type': 'text/plain; charset=utf-8',
          'x-content-type-options': 'nosniff',
        }).end('forbidden');
        return;
      }

      let s = await stat(candidate).catch(() => null);
      if (s && s.isDirectory()) {
        candidate = join(candidate, 'index.html');
        s = await stat(candidate).catch(() => null);
      }
      if (!s || !s.isFile()) {
        res.writeHead(404, {
          'content-type': 'text/plain; charset=utf-8',
          'x-content-type-options': 'nosniff',
        }).end('404');
        return;
      }

      const targetReal = await realpath(candidate).catch(() => null);
      if (!targetReal) {
        res.writeHead(404, {
          'content-type': 'text/plain; charset=utf-8',
          'x-content-type-options': 'nosniff',
        }).end('404');
        return;
      }
      const realRel = relative(rootReal, targetReal);
      if (isForbiddenRelative(realRel)) {
        res.writeHead(403, {
          'content-type': 'text/plain; charset=utf-8',
          'x-content-type-options': 'nosniff',
        }).end('forbidden');
        return;
      }

      const headers = {
        'content-type': TYPES[extname(targetReal).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff',
      };
      if (method === 'HEAD') {
        headers['content-length'] = String(s.size);
        res.writeHead(200, headers).end();
        return;
      }

      const data = await readFile(targetReal);
      headers['content-length'] = String(data.byteLength);
      res.writeHead(200, headers).end(data);
    } catch {
      res.writeHead(500, {
        'content-type': 'text/plain; charset=utf-8',
        'x-content-type-options': 'nosniff',
      }).end('internal error');
    }
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(SELF_PATH)) {
  createServer(createStaticHandler()).listen(PORT, HOST, () => {
    console.log(`SILENT PROTOCOL en http://${HOST}:${PORT}`);
  });
}
