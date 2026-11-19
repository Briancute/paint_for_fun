import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const UNPACKED_DIR = path.join(ROOT_DIR, 'unpacked');

async function walkFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

/**
 * Lightweight pretty-printers (matching scripts/clone-and-unpack.mjs) to keep unpacked/ in sync.
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

function replaceExact(src, target, replacement, label) {
  if (!src.includes(target)) {
    throw new Error(`Patch target not found for [${label}]: ${target}`);
  }
  return src.split(target).join(replacement);
}

async function main() {
  // 1. Update all .html files in public/
  const allPublic = await walkFiles(PUBLIC_DIR);
  const htmlFiles = allPublic.filter((f) => f.endsWith('.html'));
  let htmlUpdated = 0;

  for (const file of htmlFiles) {
    const orig = await fs.readFile(file, 'utf8');
    const updated = orig
      .replace(/Surya Aditya/g, 'BRIAN FAJARDO')
      .replace(/Surya is open/g, 'Brian is open');
    if (updated !== orig) {
      await fs.writeFile(file, updated, 'utf8');
      htmlUpdated++;
    }
  }
  console.log(`Updated ${htmlUpdated}/${htmlFiles.length} HTML/partial files with BRIAN FAJARDO branding.`);

  // 2. Update unpacked/routes.json and re-pack public/r.bin
  const routesPath = path.join(UNPACKED_DIR, 'routes.json');
  const routesJson = JSON.parse(await fs.readFile(routesPath, 'utf8'));
  for (const routeEntry of Object.values(routesJson.rtes || {})) {
    if (typeof routeEntry.t === 'string') {
      routeEntry.t = routeEntry.t.replace(/Surya Aditya/g, 'BRIAN FAJARDO');
    }
  }
  await fs.writeFile(routesPath, JSON.stringify(routesJson, null, 2), 'utf8');

  const payloadBuf = Buffer.from(JSON.stringify({ v: 1, data: routesJson }), 'utf8');
  const gzipped = zlib.gzipSync(payloadBuf, { level: 9 });
  // Ensure FLG byte (index 3) is 0 and verify trailer size matches ga(k) check
  gzipped[3] = 0;
  const trailerSize = gzipped.readUInt32LE(gzipped.length - 4);
  if (gzipped[0] !== 31 || gzipped[1] !== 139 || gzipped[2] !== 8 || gzipped[3] !== 0 || trailerSize !== payloadBuf.length) {
    throw new Error('Re-packed r.bin failed binary header/trailer verification');
  }
  const verifyInflated = zlib.gunzipSync(gzipped);
  const verifyParsed = JSON.parse(verifyInflated.toString('utf8'));
  if (verifyParsed.v !== 1 || verifyParsed.data.rtes['/'].t !== 'BRIAN FAJARDO — Web Developer') {
    throw new Error('Re-packed r.bin failed round-trip decode check');
  }
  await fs.writeFile(path.join(PUBLIC_DIR, 'r.bin'), gzipped);
  console.log(`Re-packed public/r.bin (${gzipped.length} bytes, raw ${payloadBuf.length} bytes) and verified round-trip.`);

  // 3. Update CSS for BRIAN FAJARDO title width & mobile #ho-wo-im preview sizing
  const cssPath = path.join(PUBLIC_DIR, 'css', '_-1794994722331.css');
  let css = await fs.readFile(cssPath, 'utf8');

  css = replaceExact(
    css,
    '#ho-he-0-ti{font-size:calc((100vw - var(--g)*2)*285/1408);',
    '#ho-he-0-ti{font-size:calc((100vw - var(--g)*2)*262/1408);',
    'CSS #ho-he-0-ti font-size'
  );

  css = replaceExact(
    css,
    '@media (max-width:768px){#ho-wo{--ho-wo-display:21vw;--ho-wo-bottom:var(--g);padding-block-start:var(--g)}',
    '@media (max-width:768px){#ho-wo-im{block-size:28.325rem;inline-size:22rem;left:calc(50% - 11rem)!important}#ho-wo{--ho-wo-display:21vw;--ho-wo-bottom:var(--g);padding-block-start:var(--g)}',
    'CSS mobile #ho-wo-im'
  );

  await fs.writeFile(cssPath, css, 'utf8');
  await fs.writeFile(path.join(UNPACKED_DIR, 'css', 'styles.pretty.css'), prettyPrintCSS(css), 'utf8');
  console.log('Updated public/css/_-1794994722331.css and unpacked/css/styles.pretty.css.');

  // 4. Patch public/js/_-37333fww.js for consistent mobile & tablet effects + scroll triggers
  const jsPath = path.join(PUBLIC_DIR, 'js', '_-37333fww.js');
  let js = await fs.readFile(jsPath, 'utf8');

  // 4a. We resize listener: always attach resize + orientationchange
  js = replaceExact(
    js,
    'this.eT=hi?"orientationchange":"resize",this.d=new Er({de:40,cb:this.tick}),this.f=new Pt(this.run),e(window,"a",this.eT,this.fn)',
    'this.eT="resize",this.d=new Er({de:40,cb:this.tick}),this.f=new Pt(this.run),e(window,"a","resize",this.fn),e(window,"a","orientationchange",this.fn)',
    'JS We resize/orientationchange listener'
  );

  // 4b. Selected Works Ni + Wi active on mobile & tablet too
  js = replaceExact(
    js,
    'this.pt=new Vi(this),this.ar=__.vs?new Ni(this):null,this.bd=new Di(this),this.cv=this.ar?new Wi(this,this.ar):null,',
    'this.pt=new Vi(this),this.ar=new Ni(this),this.bd=new Di(this),this.cv=new Wi(this,this.ar),',
    'JS ji Ni/Wi enable on mobile/tablet'
  );

  // 4c. Preload all 14 project previews on homepage regardless of vs mode
  js = replaceExact(
    js,
    'return this.nativeHome(k)?P.slice(0,1):P',
    'return P',
    'JS preloadList all home previews'
  );
  js = replaceExact(
    js,
    'this.addPlanes(),k.vs)this.rgl.media.preloadRt(this.url)',
    'this.addPlanes(),!0)this.rgl.media.preloadRt(this.url)',
    'JS ho.init preloadRt unconditionally'
  );

  // 4d. Wi.scrollHover samples center of viewport when no mouse hover is active (mobile/tablet scroll)
  js = replaceExact(
    js,
    'if(this.psc=k,this.px<0)return;let L=document.elementFromPoint(this.px,this.py)?.closest?.(".ho-wo-r");',
    'this.psc=k;let L=document.elementFromPoint(this.px>=0?this.px:__.win.w*0.5,this.py>=0?this.py:__.win.h*0.5)?.closest?.(".ho-wo-r");',
    'JS Wi.scrollHover center-row fallback'
  );

  // 4e. Wi.enter & Wi.track allow touch interactions instead of dismissing preview
  js = replaceExact(
    js,
    'enter=(k)=>{if(this.blocked())return;if(this.track(k),k.pointerType==="touch")return;let P=k.currentTarget;',
    'enter=(k)=>{if(this.blocked())return;this.track(k);let P=k.currentTarget;',
    'JS Wi.enter touch support'
  );
  js = replaceExact(
    js,
    'track=(k)=>{let P=k;if(P.pointerType==="touch"){if(this.px=this.py=-1,this.hover=null,!this.blocked())this.hide();return}if(!Number.isFinite(P.clientX)||!Number.isFinite(P.clientY))return;this.px=P.clientX,this.py=P.clientY};',
    'track=(k)=>{let P=k;if(!Number.isFinite(P.clientX)||!Number.isFinite(P.clientY))return;this.px=P.clientX,this.py=P.clientY};',
    'JS Wi.track touch coordinates'
  );

  // 4f. Interactive pointer-ripple cutout (attachInk & accepts) on mobile/tablet
  js = replaceExact(
    js,
    'attachInk(k,P="page"){if(!__.vs||!this.rgl.ink)return null;',
    'attachInk(k,P="page"){if(!this.rgl.ink)return null;',
    'JS attachInk enable on mobile/tablet'
  );
  js = replaceExact(
    js,
    'accepts(k){return!this.retained&&this.enabled&&k.pointerType!=="touch"&&!this.reduced.matches&&__.iD}',
    'accepts(k){return!this.retained&&this.enabled&&!this.reduced.matches&&__.iD}',
    'JS pointer-ripple accepts touch'
  );

  // 4g. 3D matcap emblem touch tilt in About drawer (Nl.move)
  js = replaceExact(
    js,
    'move=(k)=>{if(k.pointerType==="touch"||!this.accepts())return;',
    'move=(k)=>{if(!this.accepts())return;',
    'JS Nl.move touch tilt'
  );

  // 4h. Add touch drag scroll support to Ue (virtual scroll dispatcher) for emulated/touch-laptop viewports
  js = replaceExact(
    js,
    'class Ue{_=[];len=0;fac=xo&&wo?2.5:1;t=!1;e=null;eT="";x=0;y=0;axe="";axeTm;stopped=!1;constructor(){n(Eh,5,this);e(document,"a","wheel",this.fn),e(document,"a","keydown",this.fn),this.axeTm=new Er({de:100,cb:()=>{this.axe=""}})}',
    'class Ue{_=[];len=0;fac=xo&&wo?2.5:1;t=!1;e=null;eT="";x=0;y=0;tx=0;ty=0;tOn=!1;axe="";axeTm;stopped=!1;constructor(){n(Eh,5,this);e(document,"a","wheel",this.fn),e(document,"a","keydown",this.fn),e(document,"a","touchstart",this.ts,{passive:!0}),e(document,"a","touchmove",this.tm,{passive:!1}),this.axeTm=new Er({de:100,cb:()=>{this.axe=""}})}ts=(k)=>{if(k.touches.length!==1)return;this.tx=k.touches[0].clientX,this.ty=k.touches[0].clientY,this.tOn=!0};tm=(k)=>{if(!this.tOn||k.touches.length!==1||this.stopped)return;let P=k.target;if(P instanceof Element&&P.closest("#pr-ga")&&__.win.w<=768)return;let L=k.touches[0].clientX,F=k.touches[0].clientY,I=this.tx-L,C=this.ty-F;if(this.tx=L,this.ty=F,Math.abs(I)<0.5&&Math.abs(C)<0.5)return;if(k.cancelable)k.preventDefault();this.e=k,this.eT="touchmove",this.x=I,this.y=C,this.axe=Math.abs(I)>Math.abs(C)?"x":"y",this.axeTm.run(),this.cb("w")};',
    'JS Ue touch drag scrolling'
  );

  await fs.writeFile(jsPath, js, 'utf8');
  await fs.writeFile(path.join(UNPACKED_DIR, 'js', 'engine.pretty.js'), prettyPrintJS(js), 'utf8');
  console.log('Patched public/js/_-37333fww.js and refreshed unpacked/js/engine.pretty.js.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
