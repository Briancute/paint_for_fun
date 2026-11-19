import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 3000;
const UPSTREAM_ORIGIN = 'https://surya-aditya.com';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.bin': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.gif': 'image/gif',
  '.txt': 'text/plain; charset=utf-8',
};

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function safeJoinPublic(relPath) {
  const normalized = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const full = path.resolve(PUBLIC_DIR, normalized);
  if (full !== PUBLIC_DIR && !full.startsWith(PUBLIC_DIR + path.sep)) {
    return null;
  }
  return full;
}

async function statFileIfExists(filePath) {
  if (!filePath) return null;
  try {
    const st = await fs.stat(filePath);
    if (st.isFile()) return st;
  } catch {
    return null;
  }
  return null;
}

async function resolveLocalFile(pathname) {
  const clean = decodeURIComponent(pathname).replace(/\/+$/, '') || '/';

  if (clean === '/') {
    const p = safeJoinPublic('index.html');
    const st = await statFileIfExists(p);
    if (st) return { filePath: p, stat: st };
  }

  const directPath = safeJoinPublic(clean.slice(1));
  const directStat = await statFileIfExists(directPath);
  if (directStat) return { filePath: directPath, stat: directStat };

  const indexPath = safeJoinPublic(path.join(clean.slice(1), 'index.html'));
  const indexStat = await statFileIfExists(indexPath);
  if (indexStat) return { filePath: indexPath, stat: indexStat };

  return null;
}

async function proxyAndCache(pathname, search) {
  const targetUrl = `${UPSTREAM_ORIGIN}${pathname}${search || ''}`;
  const res = await fetch(targetUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;

  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || '';
  const isHtml = contentType.includes('text/html') && !pathname.endsWith('.html');
  const clean = pathname.replace(/\/+$/, '') || '/';
  const destPath = isHtml
    ? clean === '/'
      ? safeJoinPublic('index.html')
      : safeJoinPublic(path.join(clean.slice(1), 'index.html'))
    : safeJoinPublic(clean.slice(1));

  if (destPath) {
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.writeFile(destPath, buf);
  }
  return { buf, contentType };
}

function sendFileWithRange(req, res, filePath, stat) {
  const contentType = getContentType(filePath);
  const total = stat.size;
  const range = req.headers.range;

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-cache');

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match) {
      res.writeHead(416, { 'Content-Range': `bytes */${total}` });
      res.end();
      return;
    }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
    if (start > end || start >= total) {
      res.writeHead(416, { 'Content-Range': `bytes */${total}` });
      res.end();
      return;
    }
    const chunkSize = end - start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Content-Length': chunkSize,
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, { 'Content-Length': total });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
      return;
    }

    const reqUrl = new URL(req.url || '/', `http://localhost:${PORT}`);
    const pathname = reqUrl.pathname;

    const resolved = await resolveLocalFile(pathname);
    if (resolved) {
      sendFileWithRange(req, res, resolved.filePath, resolved.stat);
      return;
    }

    try {
      const proxied = await proxyAndCache(pathname, reqUrl.search);
      if (proxied) {
        res.writeHead(200, {
          'Content-Type': proxied.contentType || getContentType(pathname),
          'Content-Length': proxied.buf.length,
          'Accept-Ranges': 'bytes',
        });
        res.end(req.method === 'HEAD' ? undefined : proxied.buf);
        return;
      }
    } catch {
      // Upstream unreachable or offline; fall through to 404
    }

    const notFoundPage = await statFileIfExists(safeJoinPublic('404.html'));
    if (notFoundPage && (req.headers.accept || '').includes('text/html')) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      if (req.method === 'HEAD') {
        res.end();
      } else {
        createReadStream(safeJoinPublic('404.html')).pipe(res);
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Internal Server Error: ${err.message}`);
  }
});

server.listen(PORT, () => {
  console.log(`Surya Aditya 1:1 local clone serving at http://localhost:${PORT}`);
});
