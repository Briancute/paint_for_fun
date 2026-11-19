import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const UNPACKED_DIR = path.join(ROOT_DIR, 'unpacked');

const ORIGIN = 'https://surya-aditya.com';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const MAX_BINARY_SIZE = 8388608;

/**
 * Validate and inspect the gzipped binary asset header/trailer exactly like `ga(k)` in the site engine.
 */
function parseBinaryHeader(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  if (
    bytes.length < 20 ||
    bytes.length > MAX_BINARY_SIZE ||
    bytes[0] !== 31 ||
    bytes[1] !== 139 ||
    bytes[2] !== 8 ||
    bytes[3] !== 0
  ) {
    throw new Error('Invalid binary asset header');
  }
  const view = new DataView(arrayBuffer);
  const size = view.getUint32(bytes.length - 4, true);
  if (!size || size > MAX_BINARY_SIZE) {
    throw new Error('Binary asset exceeds size limit');
  }
  return { bytes, size, view };
}

/**
 * Decode gzipped `{ v: 1, data }` binary archive exactly like `fu(k)` + `ba(k)` in the site engine.
 */
function decodeBinaryAsset(arrayBuffer) {
  const { bytes, size } = parseBinaryHeader(arrayBuffer);
  const inflated = zlib.gunzipSync(bytes);
  if (inflated.length !== size) {
    throw new Error(`Incomplete binary asset: expected ${size}, got ${inflated.length}`);
  }
  const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(inflated));
  if (!parsed || typeof parsed !== 'object' || parsed.v !== 1 || !('data' in parsed)) {
    throw new Error('Unsupported binary asset payload');
  }
  return parsed.data;
}

function cleanPathname(urlPath) {
  const clean = urlPath.split('#')[0].split('?')[0];
  return clean.startsWith('/') ? clean : `/${clean}`;
}

function localFilePathForUrl(urlPath, { isHtmlRoute = false } = {}) {
  const clean = cleanPathname(urlPath);
  if (isHtmlRoute) {
    if (clean === '/') return path.join(PUBLIC_DIR, 'index.html');
    if (clean === '/404') return path.join(PUBLIC_DIR, '404.html');
    return path.join(PUBLIC_DIR, clean.slice(1), 'index.html');
  }
  const rel = clean.slice(1);
  return path.join(PUBLIC_DIR, rel);
}

async function fetchBuffer(urlPath, query = '') {
  const clean = cleanPathname(urlPath);
  const targetUrl = `${ORIGIN}${clean}${query}`;
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(targetUrl, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} for ${targetUrl}`);
        err.status = res.status;
        throw err;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      return { buf, contentType: res.headers.get('content-type') || '' };
    } catch (err) {
      lastErr = err;
      if (err.status === 404) break;
      await new Promise((r) => setTimeout(r, attempt * 350));
    }
  }
  throw lastErr;
}

async function writeFileEnsured(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, data);
}

/**
 * Lightweight, string- and regex-aware JS pretty-printer for reading the minified bundle.
 */
function prettyPrintJS(source) {
  const out = [];
  let indent = 0;
  let i = 0;
  const n = source.length;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let templateExprDepth = 0;
  let inLineComment = false;
  let inBlockComment = false;
  let parenDepth = 0;
  let prevNonSpace = '';

  const pad = () => '  '.repeat(Math.max(0, indent));
  const isRegexStart = (ch) =>
    ch === '' ||
    '(=,[!&|?:;{}~^+-*%<>!'.includes(ch) ||
    source.slice(Math.max(0, i - 6), i).endsWith('return') ||
    source.slice(Math.max(0, i - 4), i).endsWith('else') ||
    source.slice(Math.max(0, i - 4), i).endsWith('case');

  while (i < n) {
    const ch = source[i];
    const next = source[i + 1] || '';

    if (inLineComment) {
      out.push(ch);
      if (ch === '\n') {
        inLineComment = false;
        out.push(pad());
      }
      i++;
      continue;
    }

    if (inBlockComment) {
      out.push(ch);
      if (ch === '*' && next === '/') {
        out.push('/');
        i += 2;
        inBlockComment = false;
        continue;
      }
      i++;
      continue;
    }

    if (inSingle) {
      out.push(ch);
      if (ch === '\\' && i + 1 < n) {
        out.push(source[i + 1]);
        i += 2;
        continue;
      }
      if (ch === "'") inSingle = false;
      prevNonSpace = "'";
      i++;
      continue;
    }

    if (inDouble) {
      out.push(ch);
      if (ch === '\\' && i + 1 < n) {
        out.push(source[i + 1]);
        i += 2;
        continue;
      }
      if (ch === '"') inDouble = false;
      prevNonSpace = '"';
      i++;
      continue;
    }

    if (inTemplate) {
      out.push(ch);
      if (ch === '\\' && i + 1 < n) {
        out.push(source[i + 1]);
        i += 2;
        continue;
      }
      if (ch === '$' && next === '{') {
        out.push('{');
        i += 2;
        templateExprDepth++;
        inTemplate = false;
        prevNonSpace = '{';
        continue;
      }
      if (ch === '`') inTemplate = false;
      prevNonSpace = '`';
      i++;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      out.push('//');
      i += 2;
      continue;
    }

    if (ch === '/' && next === '*') {
      inBlockComment = true;
      out.push('/*');
      i += 2;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      out.push(ch);
      i++;
      continue;
    }

    if (ch === '"') {
      inDouble = true;
      out.push(ch);
      i++;
      continue;
    }

    if (ch === '`') {
      inTemplate = true;
      out.push(ch);
      i++;
      continue;
    }

    // Regex literal check
    if (ch === '/' && isRegexStart(prevNonSpace)) {
      out.push(ch);
      i++;
      let inClass = false;
      while (i < n) {
        const rc = source[i];
        out.push(rc);
        if (rc === '\\' && i + 1 < n) {
          out.push(source[i + 1]);
          i += 2;
          continue;
        }
        if (rc === '[') inClass = true;
        else if (rc === ']') inClass = false;
        else if (rc === '/' && !inClass) {
          i++;
          while (i < n && /[gimsuvy]/.test(source[i])) {
            out.push(source[i]);
            i++;
          }
          break;
        }
        i++;
      }
      prevNonSpace = '/';
      continue;
    }

    if (ch === '(') parenDepth++;
    if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);

    if (ch === '{') {
      out.push(' {\n');
      indent++;
      out.push(pad());
      prevNonSpace = '{';
      i++;
      continue;
    }

    if (ch === '}') {
      if (templateExprDepth > 0) {
        indent = Math.max(0, indent - 1);
        out.push('}');
        templateExprDepth--;
        inTemplate = true;
        prevNonSpace = '`';
        i++;
        continue;
      }
      indent = Math.max(0, indent - 1);
      out.push('\n' + pad() + '}');
      if (next && !';,)]}'.includes(next)) {
        out.push('\n' + pad());
      }
      prevNonSpace = '}';
      i++;
      continue;
    }

    if (ch === ';' && parenDepth === 0) {
      out.push(';\n' + pad());
      prevNonSpace = ';';
      i++;
      continue;
    }

    out.push(ch);
    if (!/\s/.test(ch)) prevNonSpace = ch;
    i++;
  }

  return out.join('').replace(/\n[ \t]+\n/g, '\n\n');
}

/**
 * Clean CSS pretty-printer preserving strings, URLs, and media queries.
 */
function prettyPrintCSS(css) {
  const out = [];
  let indent = 0;
  let inSingle = false;
  let inDouble = false;
  const pad = () => '  '.repeat(Math.max(0, indent));

  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (inSingle) {
      out.push(ch);
      if (ch === '\\' && i + 1 < css.length) {
        out.push(css[++i]);
        continue;
      }
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      out.push(ch);
      if (ch === '\\' && i + 1 < css.length) {
        out.push(css[++i]);
        continue;
      }
      if (ch === '"') inDouble = false;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      out.push(ch);
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      out.push(ch);
      continue;
    }
    if (ch === '{') {
      indent++;
      out.push(' {\n' + pad());
    } else if (ch === '}') {
      indent = Math.max(0, indent - 1);
      out.push('\n' + pad() + '}\n' + pad());
    } else if (ch === ';') {
      out.push(';\n' + pad());
    } else {
      out.push(ch);
    }
  }
  return out.join('').replace(/\n[ \t]+\n/g, '\n\n').trim() + '\n';
}

function extractAssetRefsFromText(text, collector) {
  // src="...", href="...", poster="...", data-src="..."
  for (const m of text.matchAll(/\b(?:src|href|poster|data-src)=["'](\/[^"'?#\s>]+)["']/g)) {
    const p = m[1];
    if (!p.startsWith('//') && /\.[a-z0-9]{2,11}$/i.test(p)) {
      collector.add(p);
    }
  }
  // CSS url(...)
  for (const m of text.matchAll(/url\(["']?(\/[^)"'\s?#]+)["']?\)/g)) {
    collector.add(m[1]);
  }
  // JS string paths
  for (const m of text.matchAll(/["'](\/(?:ab|ho|wo|intro|fonts|favicon|css|js|gpu)\/[^"'\s?#]+|\/og\.jpg|\/r\.bin)["']/g)) {
    collector.add(m[1]);
  }
}

async function runPool(items, concurrency, fn) {
  let idx = 0;
  const results = [];
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  console.log(`Syncing and unpacking ${ORIGIN} -> ${ROOT_DIR}`);
  await fs.mkdir(PUBLIC_DIR, { recursive: true });
  await fs.mkdir(UNPACKED_DIR, { recursive: true });

  // 1. Download root index.html and parse __SEED__
  const { buf: indexBuf } = await fetchBuffer('/');
  const indexHtml = indexBuf.toString('utf8');
  await writeFileEnsured(localFilePathForUrl('/', { isHtmlRoute: true }), indexBuf);

  const seedMatch = indexHtml.match(/<script id="__SEED__"[^>]*>([\s\S]*?)<\/script>/);
  if (!seedMatch) throw new Error('Could not locate __SEED__ JSON in index.html');
  const seed = JSON.parse(seedMatch[1]);
  const versionQuery = seed.cfg?.v || '';
  console.log('Detected site config version:', versionQuery);

  const webglBinPath = seed.cfg.shaders.webgl;
  const webgpuBinPath = seed.cfg.shaders.webgpu;
  const coreJsPath = seed.cfg.assets.script;
  const mainCssPath = seed.cfg.assets.style;
  const rootCssPath = seed.cfg.assets.rootStyle;

  // 2. Download core assets + binary archives
  const coreDownloads = [
    { path: coreJsPath, query: '' },
    { path: mainCssPath, query: '' },
    { path: '/r.bin', query: versionQuery },
    { path: webglBinPath, query: versionQuery },
    { path: webgpuBinPath, query: versionQuery },
  ];

  const fetchedTexts = new Map();
  for (const item of coreDownloads) {
    const { buf } = await fetchBuffer(item.path, item.query);
    await writeFileEnsured(localFilePathForUrl(item.path), buf);
    fetchedTexts.set(item.path, buf);
    console.log(`Downloaded ${item.path} (${buf.length} bytes)`);
  }

  // rootStyle may or may not exist on upstream, fetch gracefully
  if (rootCssPath) {
    try {
      const { buf } = await fetchBuffer(rootCssPath);
      await writeFileEnsured(localFilePathForUrl(rootCssPath), buf);
      fetchedTexts.set(rootCssPath, buf);
      console.log(`Downloaded ${rootCssPath} (${buf.length} bytes)`);
    } catch (err) {
      console.warn(`Optional rootStyle ${rootCssPath} skipped: ${err.message}`);
    }
  }

  // Locate main engine JS imported by core JS
  const coreJsText = fetchedTexts.get(coreJsPath).toString('utf8');
  const engineMatch = coreJsText.match(/import\(["']\.\/([^"']+)["']\)/) || coreJsText.match(/\[\["\.\/[^"]+"\]\,\["\.\/([^"]+)"/);
  const engineJsPath = engineMatch ? `/js/${engineMatch[1]}` : '/js/_-37333fww.js';
  const { buf: engineBuf } = await fetchBuffer(engineJsPath);
  await writeFileEnsured(localFilePathForUrl(engineJsPath), engineBuf);
  const engineJsText = engineBuf.toString('utf8');
  console.log(`Downloaded ${engineJsPath} (${engineBuf.length} bytes)`);

  // 3. Decode binary archives (/r.bin, webgl shaders, webgpu shaders)
  const routeConfig = decodeBinaryAsset(
    fetchedTexts.get('/r.bin').buffer.slice(
      fetchedTexts.get('/r.bin').byteOffset,
      fetchedTexts.get('/r.bin').byteOffset + fetchedTexts.get('/r.bin').byteLength
    )
  );
  await writeFileEnsured(
    path.join(UNPACKED_DIR, 'routes.json'),
    JSON.stringify(routeConfig, null, 2)
  );
  console.log(`Decoded /r.bin -> unpacked/routes.json (${Object.keys(routeConfig.rtes).length} routes)`);

  const glShaders = decodeBinaryAsset(
    fetchedTexts.get(webglBinPath).buffer.slice(
      fetchedTexts.get(webglBinPath).byteOffset,
      fetchedTexts.get(webglBinPath).byteOffset + fetchedTexts.get(webglBinPath).byteLength
    )
  );
  let glShaderCount = 0;
  for (const [key, src] of Object.entries(glShaders)) {
    const rel = key.replace(/^@shader\//, '');
    await writeFileEnsured(path.join(UNPACKED_DIR, 'shaders', 'gl', rel), src);
    glShaderCount++;
  }
  console.log(`Unpacked ${glShaderCount} WebGL2 shaders -> unpacked/shaders/gl/`);

  const gpuBundle = decodeBinaryAsset(
    fetchedTexts.get(webgpuBinPath).buffer.slice(
      fetchedTexts.get(webgpuBinPath).byteOffset,
      fetchedTexts.get(webgpuBinPath).byteOffset + fetchedTexts.get(webgpuBinPath).byteLength
    )
  );
  await writeFileEnsured(
    path.join(UNPACKED_DIR, 'shaders', 'gpu', 'blit.wgsl'),
    gpuBundle.blit
  );
  const specsMeta = gpuBundle.specs.map(({ vertexCode, fragmentCode, ...rest }) => rest);
  await writeFileEnsured(
    path.join(UNPACKED_DIR, 'shaders', 'gpu', 'specs.json'),
    JSON.stringify(specsMeta, null, 2)
  );
  for (const spec of gpuBundle.specs) {
    const safeName = spec.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
    await writeFileEnsured(
      path.join(UNPACKED_DIR, 'shaders', 'gpu', `${safeName}.vert.wgsl`),
      spec.vertexCode
    );
    await writeFileEnsured(
      path.join(UNPACKED_DIR, 'shaders', 'gpu', `${safeName}.frag.wgsl`),
      spec.fragmentCode
    );
  }
  console.log(`Unpacked ${gpuBundle.specs.length} WebGPU shader specs + blit.wgsl -> unpacked/shaders/gpu/`);

  // 4. Write formatted CSS & JS to unpacked/
  await writeFileEnsured(
    path.join(UNPACKED_DIR, 'css', 'styles.pretty.css'),
    prettyPrintCSS(fetchedTexts.get(mainCssPath).toString('utf8'))
  );
  await writeFileEnsured(
    path.join(UNPACKED_DIR, 'js', 'core.pretty.js'),
    prettyPrintJS(coreJsText)
  );
  await writeFileEnsured(
    path.join(UNPACKED_DIR, 'js', 'engine.pretty.js'),
    prettyPrintJS(engineJsText)
  );
  console.log('Wrote formatted CSS and JS into unpacked/css/ and unpacked/js/');

  // 5. Download all HTML routes + p.html partials from routeConfig.rtes
  const assetUrls = new Set();
  extractAssetRefsFromText(indexHtml, assetUrls);
  extractAssetRefsFromText(fetchedTexts.get(mainCssPath).toString('utf8'), assetUrls);
  extractAssetRefsFromText(engineJsText, assetUrls);

  // Add MSDF font binary tiers (p4 & p7 across 512, 1024, 2048, 4096)
  for (const weight of ['p4', 'p7']) {
    for (const size of [512, 1024, 2048, 4096]) {
      assetUrls.add(`/fonts/msdf/${weight}-${size}.bin`);
    }
  }

  // Add all media listed in routeConfig.dta.gl
  for (const entries of Object.values(routeConfig.dta?.gl || {})) {
    if (!Array.isArray(entries)) continue;
    for (const item of entries) {
      if (item && typeof item.src === 'string' && item.src.startsWith('/')) {
        assetUrls.add(item.src);
      }
    }
  }

  // Download route full HTML pages and p.html partials
  const routeKeys = Object.keys(routeConfig.rtes || {});
  const extraRoutes = new Set([...routeKeys, '/about', '/contact']);

  await runPool([...extraRoutes], 6, async (routePath) => {
    if (routePath !== '/') {
      try {
        const { buf } = await fetchBuffer(routePath);
        await writeFileEnsured(localFilePathForUrl(routePath, { isHtmlRoute: true }), buf);
        extractAssetRefsFromText(buf.toString('utf8'), assetUrls);
        console.log(`Downloaded route HTML ${routePath}`);
      } catch (err) {
        console.warn(`Route HTML ${routePath} failed: ${err.message}`);
      }
    }

    if (routePath !== '/404') {
      const partialPath = `${routePath === '/' ? '' : routePath.replace(/\/+$/, '')}/p.html`;
      try {
        const { buf } = await fetchBuffer(partialPath, versionQuery);
        await writeFileEnsured(localFilePathForUrl(partialPath), buf);
        extractAssetRefsFromText(buf.toString('utf8'), assetUrls);
        console.log(`Downloaded partial ${partialPath}`);
      } catch (err) {
        console.warn(`Partial ${partialPath} skipped: ${err.message}`);
      }
    }
  });

  // Also grab /og.jpg and inspect site.webmanifest if present
  assetUrls.add('/og.jpg');
  if (assetUrls.has('/favicon/site.webmanifest')) {
    try {
      const { buf } = await fetchBuffer('/favicon/site.webmanifest');
      await writeFileEnsured(localFilePathForUrl('/favicon/site.webmanifest'), buf);
      const manifest = JSON.parse(buf.toString('utf8'));
      for (const icon of manifest.icons || []) {
        if (icon.src && icon.src.startsWith('/')) assetUrls.add(icon.src);
      }
      assetUrls.delete('/favicon/site.webmanifest');
      console.log('Downloaded /favicon/site.webmanifest');
    } catch (err) {
      console.warn(`Manifest warning: ${err.message}`);
    }
  }

  // Filter out CSS/JS already saved
  for (const already of [coreJsPath, engineJsPath, mainCssPath, rootCssPath, '/r.bin', webglBinPath, webgpuBinPath]) {
    if (already) assetUrls.delete(already);
  }

  const assetList = [...assetUrls].sort();
  console.log(`\nDownloading ${assetList.length} media, font, 3D, and icon assets...`);

  let okCount = 0;
  let failCount = 0;
  await runPool(assetList, 8, async (assetPath) => {
    try {
      const { buf } = await fetchBuffer(assetPath);
      await writeFileEnsured(localFilePathForUrl(assetPath), buf);
      okCount++;
      console.log(`[${okCount}/${assetList.length}] ${assetPath} (${buf.length} bytes)`);
    } catch (err) {
      failCount++;
      console.warn(`[FAIL] ${assetPath}: ${err.message}`);
    }
  });

  console.log(`\nSync complete: ${okCount} downloaded, ${failCount} failed/skipped.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
