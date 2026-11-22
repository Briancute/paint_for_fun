import fs from 'node:fs/promises';
import path from 'node:path';
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
    if (entry.isDirectory()) files.push(...(await walkFiles(full)));
    else files.push(full);
  }
  return files;
}

function replaceExact(src, target, replacement, label) {
  if (!src.includes(target)) {
    throw new Error(`Patch target not found for [${label}]: ${target}`);
  }
  return src.split(target).join(replacement);
}

function replaceIdempotent(src, target, replacement, label) {
  if (src.includes(replacement)) return src;
  return replaceExact(src, target, replacement, label);
}

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

async function main() {
  // 1. Patch public/js/_-37333fww.js
  const jsPath = path.join(PUBLIC_DIR, 'js', '_-37333fww.js');
  let js = await fs.readFile(jsPath, 'utf8');

  // 1a. Restore native mobile/tablet fast paths (avoid per-frame getBoundingClientRect, elementFromPoint, and unsolicited popups during native scroll)
  js = replaceIdempotent(
    js,
    'this.pt=new Vi(this),this.ar=new Ni(this),this.bd=new Di(this),this.cv=new Wi(this,this.ar),',
    'this.pt=new Vi(this),this.ar=__.vs?new Ni(this):null,this.bd=new Di(this),this.cv=this.ar?new Wi(this,this.ar):null,',
    'JS restore ji vs-gated Ni/Wi'
  );

  js = replaceIdempotent(
    js,
    'nativeHome(k){return!__.vs&&__.rts?.[k]==="ho"}preloadList(k){let P=this.list(k);if(__.rts?.[k]==="pr"){if(this.rt!==k)return P.slice(0,1);let L=new Set(this._.filter((F)=>F.el.isConnected&&this.inView(rt(F.el))).map((F)=>F.src));return P.filter((F)=>L.has(F.src))}return P}',
    'nativeHome(k){return!__.vs&&__.rts?.[k]==="ho"}preloadList(k){let P=this.list(k);if(__.rts?.[k]==="pr"){if(this.rt!==k)return P.slice(0,1);let L=new Set(this._.filter((F)=>F.el.isConnected&&this.inView(rt(F.el))).map((F)=>F.src));return P.filter((F)=>L.has(F.src))}return this.nativeHome(k)?P.slice(0,1):P}',
    'JS restore preloadList mobile limit'
  );

  js = replaceIdempotent(
    js,
    'this.addPlanes(),!0)this.rgl.media.preloadRt(this.url)',
    'this.addPlanes(),k.vs)this.rgl.media.preloadRt(this.url)',
    'JS restore ho.init preloadRt gate'
  );

  js = replaceIdempotent(
    js,
    'this.psc=k;let L=document.elementFromPoint(this.px>=0?this.px:__.win.w*0.5,this.py>=0?this.py:__.win.h*0.5)?.closest?.(".ho-wo-r");',
    'if(this.psc=k,this.px<0)return;let L=document.elementFromPoint(this.px,this.py)?.closest?.(".ho-wo-r");',
    'JS restore Wi.scrollHover'
  );

  js = replaceIdempotent(
    js,
    'enter=(k)=>{if(this.blocked())return;this.track(k);let P=k.currentTarget;',
    'enter=(k)=>{if(this.blocked())return;if(this.track(k),k.pointerType==="touch")return;let P=k.currentTarget;',
    'JS restore Wi.enter touch guard'
  );

  js = replaceIdempotent(
    js,
    'track=(k)=>{let P=k;if(!Number.isFinite(P.clientX)||!Number.isFinite(P.clientY))return;this.px=P.clientX,this.py=P.clientY};',
    'track=(k)=>{let P=k;if(P.pointerType==="touch"){if(this.px=this.py=-1,this.hover=null,!this.blocked())this.hide();return}if(!Number.isFinite(P.clientX)||!Number.isFinite(P.clientY))return;this.px=P.clientX,this.py=P.clientY};',
    'JS restore Wi.track touch guard'
  );

  js = replaceIdempotent(
    js,
    'attachInk(k,P="page"){if(!this.rgl.ink)return null;',
    'attachInk(k,P="page"){if(!__.vs||!this.rgl.ink)return null;',
    'JS restore attachInk vs guard'
  );

  js = replaceIdempotent(
    js,
    'accepts(k){return!this.retained&&this.enabled&&!this.reduced.matches&&__.iD}',
    'accepts(k){return!this.retained&&this.enabled&&k.pointerType!=="touch"&&!this.reduced.matches&&__.iD}',
    'JS restore pointer-ripple touch guard'
  );

  // 1b. Cap Mobile/Tablet canvas DPR (1.75 max on <=1024px) and portraitFocus FBO (2048 on <=1024px)
  js = replaceIdempotent(
    js,
    'let k=__.win,P=this.gl,L=k.w<600?3:__.vs&&k.w>1920?1.5:2;',
    'let k=__.win,P=this.gl,L=k.w<=1024?1.75:__.vs&&k.w>1920?1.5:2;',
    'JS cap DPR on mobile and tablet'
  );

  js = replaceIdempotent(
    js,
    'new en(k,this.tex,__.vs?4096:2048)',
    'new en(k,this.tex,__.vs&&__.win.w>1024?4096:2048)',
    'JS cap focus FBO size on tablet'
  );

  // 1c. Upgrade Ue touch scroll: only attach when !hi (so real mobile native compositor scroll is untouched),
  //     and add momentum inertia on touchend + wheel cancellation
  js = replaceIdempotent(
    js,
    'class Ue{_=[];len=0;fac=xo&&wo?2.5:1;t=!1;e=null;eT="";x=0;y=0;tx=0;ty=0;tOn=!1;axe="";axeTm;stopped=!1;constructor(){n(Eh,5,this);e(document,"a","wheel",this.fn),e(document,"a","keydown",this.fn),e(document,"a","touchstart",this.ts,{passive:!0}),e(document,"a","touchmove",this.tm,{passive:!1}),this.axeTm=new Er({de:100,cb:()=>{this.axe=""}})}ts=(k)=>{if(k.touches.length!==1)return;this.tx=k.touches[0].clientX,this.ty=k.touches[0].clientY,this.tOn=!0};tm=(k)=>{if(!this.tOn||k.touches.length!==1||this.stopped)return;let P=k.target;if(P instanceof Element&&P.closest("#pr-ga")&&__.win.w<=768)return;let L=k.touches[0].clientX,F=k.touches[0].clientY,I=this.tx-L,C=this.ty-F;if(this.tx=L,this.ty=F,Math.abs(I)<0.5&&Math.abs(C)<0.5)return;if(k.cancelable)k.preventDefault();this.e=k,this.eT="touchmove",this.x=I,this.y=C,this.axe=Math.abs(I)>Math.abs(C)?"x":"y",this.axeTm.run(),this.cb("w")};',
    'class Ue{_=[];len=0;fac=xo&&wo?2.5:1;t=!1;e=null;eT="";x=0;y=0;tx=0;ty=0;tOn=!1;tv=0;tAxe="y";tRaf=0;axe="";axeTm;stopped=!1;constructor(){n(Eh,5,this);e(document,"a","wheel",this.fn),e(document,"a","keydown",this.fn);if(!hi)e(document,"a","touchstart",this.ts,{passive:!0}),e(document,"a","touchmove",this.tm,{passive:!1}),e(document,"a","touchend",this.te,{passive:!0}),e(document,"a","touchcancel",this.te,{passive:!0});this.axeTm=new Er({de:100,cb:()=>{this.axe=""}})}ts=(k)=>{if(this.tRaf)cancelAnimationFrame(this.tRaf),this.tRaf=0,this.tv=0;if(k.touches.length!==1)return;this.tx=k.touches[0].clientX,this.ty=k.touches[0].clientY,this.tOn=!0};tm=(k)=>{if(!this.tOn||k.touches.length!==1||this.stopped)return;let P=k.target;if(P instanceof Element&&P.closest("#pr-ga")&&__.win.w<=768)return;let L=k.touches[0].clientX,F=k.touches[0].clientY,I=this.tx-L,C=this.ty-F;if(this.tx=L,this.ty=F,Math.abs(I)<0.5&&Math.abs(C)<0.5)return;if(k.cancelable)k.preventDefault();let H=Math.abs(I)>Math.abs(C)?"x":"y",B=H==="x"?I:C;this.tAxe=H,this.tv=this.tv*0.4+B*1.15,this.e=k,this.eT="touchmove",this.x=I,this.y=C,this.axe=H,this.axeTm.run(),this.cb("w")};te=()=>{if(!this.tOn)return;if(this.tOn=!1,Math.abs(this.tv)<1||this.stopped)return void(this.tv=0);let k=()=>{if(!this.tOn&&!this.stopped&&Math.abs(this.tv)>=0.4){this.x=this.tAxe==="x"?this.tv:0,this.y=this.tAxe==="y"?this.tv:0,this.axe=this.tAxe,this.cb("w"),this.tv*=0.92,this.tRaf=requestAnimationFrame(k)}else this.tRaf=0,this.tv=0};this.tRaf=requestAnimationFrame(k)};',
    'JS Ue touch momentum and !hi guard'
  );

  js = replaceIdempotent(
    js,
    'fn(k){this.e=k,this.eT=k.type;',
    'fn(k){if(this.tRaf)cancelAnimationFrame(this.tRaf),this.tRaf=0,this.tv=0;this.e=k,this.eT=k.type;',
    'JS Ue cancel touch momentum on wheel/key'
  );

  // 1d. Keep 3D BF emblem front-facing across scroll (-20deg..+20deg instead of starting 180deg backwards)
  js = replaceIdempotent(
    js,
    'var gn=Math.PI,mp=-Math.PI;function bn(k,P,L=16){',
    'var gn=-0.35,mp=0.7;function bn(k,P,L=16){',
    'JS fix 3D BF emblem orientation'
  );

  // 1e. Fix lr.rz() line-splitter gate & self-healing resize sync for MSDF/native text, Ye, and Le
  js = replaceIdempotent(
    js,
    'class lr{v=!1;layoutVersion=0;',
    'class lr{v=!1;_rw=0;_rh=0;layoutVersion=0;',
    'JS add lr resize tracking fields'
  );

  js = replaceIdempotent(
    js,
    'this.lineInkBottom=I.lineHeight,this.rgl.dirt=!0,this.draw();return}if(!this.font)return;if(this.lineReveal&&!this.sl&&!t.c("y",this.el).length){',
    'this.lineInkBottom=I.lineHeight,this._rw=__.win.w,this._rh=__.win.h,this.rgl.dirt=!0,this.draw();return}if(!this.font)return;if(!this.sl&&!t.c("y",this.el).length){',
    'JS enable lr line splitter on all wrapped text'
  );

  js = replaceIdempotent(
    js,
    'this.mesh.upload(F),this.layoutVersion++}upd(k){let P=this.rgl,',
    'this.mesh.upload(F),this.layoutVersion++,this._rw=__.win.w,this._rh=__.win.h}upd(k){if((this.font||this.native)&&(this._rw!==__.win.w||this._rh!==__.win.h))this.rz();let P=this.rgl,',
    'JS lr self-healing resize sync in upd'
  );

  js = replaceIdempotent(
    js,
    'infoFrame=null;constructor(k){this.h=k}',
    'infoFrame=null;_rw=0;_rh=0;constructor(k){this.h=k}',
    'JS add Ye resize tracking fields'
  );

  js = replaceIdempotent(
    js,
    'this.scroll=this.h.sc(),this.cloth.set(0),this.grow()}tick(){this.grow()}',
    'this.scroll=this.h.sc(),this.cloth.set(0),this._rw=F.w,this._rh=F.h,this.grow()}tick(){if(this._rw!==__.win.w||this._rh!==__.win.h)this.h.rz();this.grow()}',
    'JS Ye self-healing resize sync'
  );

  js = replaceIdempotent(
    js,
    'rz(){for(let k of this._v)k.rz?.();this.s.rz()}on(){this.s.on();for(let k of this._v)k.on?.()}off(){this.s.off();for(let k of this._v)k.off?.()}settle(){for(let k of this._v)k.settle?.()}tick(){this.s.tick();for(let k of this._v)k.tick?.();this.rgl.loop()}',
    'rz(){__.win.upd(innerWidth,innerHeight);this.rgl.rz();this.s.rz();for(let k of this._v)k.rz?.()}on(){this.s.on();for(let k of this._v)k.on?.()}off(){this.s.off();for(let k of this._v)k.off?.()}settle(){for(let k of this._v)k.settle?.()}tick(){if(innerWidth!==__.win.w||innerHeight!==__.win.h)this.rz();this.s.tick();for(let k of this._v)k.tick?.();this.rgl.loop()}',
    'JS Le resize ordering and per-frame viewport check'
  );

  await fs.writeFile(jsPath, js, 'utf8');
  await fs.writeFile(path.join(UNPACKED_DIR, 'js', 'engine.pretty.js'), prettyPrintJS(js), 'utf8');
  console.log('Updated public/js/_-37333fww.js and unpacked/js/engine.pretty.js.');

  // 2. Patch root-size floor in all HTML files and root-1794994722331.css
  const allPublic = await walkFiles(PUBLIC_DIR);
  const rootTarget = '@media (min-width:769px){html{font-size:min(.694444vw,1.23457svh)}}';
  const rootReplacement = '@media (min-width:769px){html{font-size:max(8.5px,min(.694444vw,1.23457svh))}}';

  let htmlRootCount = 0;
  for (const f of allPublic) {
    if (!f.endsWith('.html')) continue;
    const orig = await fs.readFile(f, 'utf8');
    if (orig.includes(rootTarget)) {
      await fs.writeFile(f, orig.split(rootTarget).join(rootReplacement), 'utf8');
      htmlRootCount++;
    }
  }
  const rootCssPath = path.join(PUBLIC_DIR, 'css', 'root-1794994722331.css');
  const rootCssOrig = await fs.readFile(rootCssPath, 'utf8');
  if (rootCssOrig.includes(rootTarget)) {
    await fs.writeFile(rootCssPath, rootCssOrig.split(rootTarget).join(rootReplacement), 'utf8');
  }
  console.log(`Updated tablet rem floor in ${htmlRootCount} HTML files and root-1794994722331.css.`);

  // 3. Patch mobile font sizing & add dedicated Tablet (769px-1024px) responsive layout rules in CSS
  const cssPath = path.join(PUBLIC_DIR, 'css', '_-1794994722331.css');
  let css = await fs.readFile(cssPath, 'utf8');

  css = replaceIdempotent(
    css,
    '#ho-he-0-fo{--portrait-width:clamp(5.6rem,17vw,9.6rem);gap:.5rem;max-inline-size:62rem;font-size:clamp(12px,3.35vw,20px);line-height:1.04}',
    '#ho-he-0-fo{--portrait-width:clamp(5.6rem,17vw,9.6rem);gap:.5rem;max-inline-size:62rem;font-size:clamp(10px,2.95vw,18px);line-height:1.04}',
    'CSS mobile #ho-he-0-fo font-size'
  );

  css = replaceIdempotent(
    css,
    '#ab-st{grid-template-columns:minmax(0,1fr)auto minmax(0,1fr);gap:0 .4rem;inline-size:calc(100% + 1.2rem);margin-block-start:.5rem;font-size:clamp(11px,3.05vw,20px);line-height:1.04}',
    '#ab-st{grid-template-columns:minmax(0,1fr)auto minmax(0,1fr);gap:0 .4rem;inline-size:calc(100% + 1.2rem);margin-block-start:.5rem;font-size:clamp(10px,2.85vw,18px);line-height:1.04}',
    'CSS mobile #ab-st font-size'
  );

  const oldTabletMedia =
    '@media (min-width:769px) and (max-width:1024px){' +
    '#ho-he-0-me{grid-template-columns:calc(var(--col)*5 + var(--g)*4) 1fr auto}' +
    '#ho-he-1-co{margin-left:calc(var(--col)*2 + var(--g)*2);grid-template-columns:minmax(0,1fr) auto auto}' +
    '#ho-wo{--ho-wo-display:19.5vw}' +
    '#ho-wo-im{block-size:32.96rem;inline-size:25.6rem;left:calc(50% - 12.8rem)!important}' +
    '#ab-co{inline-size:calc(var(--col)*8 + var(--g)*7)}' +
    '}';

  const tabletMedia =
    '@media (min-width:769px) and (max-width:1024px){' +
    '#ho-he-0-me{grid-template-columns:calc(var(--col)*5 + var(--g)*4) 1fr auto}' +
    '#ho-he-1-co{margin-left:calc(var(--col)*2 + var(--g)*2);grid-template-columns:minmax(0,1fr) auto auto}' +
    '#ho-wo{--ho-wo-display:19.5vw}' +
    '.ho-wo-mt{grid-template-columns:calc(var(--col)*4 + var(--g)*3) calc(var(--col)*3 + var(--g)*2) calc(var(--col)*4 + var(--g)*3) var(--col);line-height:1.2}' +
    '#ho-wo-im{block-size:32.96rem;inline-size:25.6rem;left:calc(50% - 12.8rem)!important}' +
    '#ab-co{inline-size:calc(var(--col)*8 + var(--g)*7)}' +
    '}';

  if (css.includes(oldTabletMedia)) {
    css = replaceExact(css, oldTabletMedia, tabletMedia, 'CSS upgrade tablet breakpoint');
  } else {
    css = replaceIdempotent(
      css,
      'html:not(.enhanced) :where(body,#m)',
      tabletMedia + 'html:not(.enhanced) :where(body,#m)',
      'CSS insert tablet breakpoint'
    );
  }

  await fs.writeFile(cssPath, css, 'utf8');
  await fs.writeFile(path.join(UNPACKED_DIR, 'css', 'styles.pretty.css'), prettyPrintCSS(css), 'utf8');
  console.log('Updated public/css/_-1794994722331.css and unpacked/css/styles.pretty.css.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
