# Surya Aditya — 1:1 Local Clone & Unpacked Source

Complete local mirror and unpacked shader/source breakdown of [`https://surya-aditya.com/`](https://surya-aditya.com/).

## Quick Start

```bash
npm start
```

Open `http://localhost:3000` in Chrome/Edge (with WebGPU enabled, or WebGL2 fallback via `?renderer=webgl`).

To re-sync assets or re-unpack shaders from upstream:

```bash
npm run sync
```

## Architecture Overview

- **Zero external animation/3D libraries** — no Three.js, GSAP, Lenis, or OGL. Everything runs on a custom WebGPU-first (with WebGL2 fallback) rendering engine (`public/js/_-37333fww.js`) bootstrapped by `public/js/_-1794994722331.js`.
- **DOM-to-GPU Sync**: Semantic HTML elements (`[data-gl-text]`, `<section>`, `<a>`, `<figure class="r">`) remain in the DOM as accessible hit targets and layout anchors (`opacity: 0` when enhanced), while the fixed `#gl` `<canvas>` renders MSDF typography, 3D paper/cloth meshes, ink ripples, matcap 3D geometry, and datamosh route transitions using `getBoundingClientRect()` coordinates.
- **Virtual Scroll (`body.vs`)**: Captures `wheel` and `keydown` input (`Ue`) and translates sections inside `.pg` via `translate3d` in lockstep with the `#gl` viewport offset.
- **Interactive Effects**:
  - **Hero Portrait Pin & Focus (`portrait-focus`, `pointer-ripple`)**: Grayscale portrait scales up into `#ho-he-1`, reveals neon green (`#75fe4f`) recognition text, and opens a liquid ink cutout on hover revealing the projects section beneath.
  - **Selected Works Floating Preview (`preview-paper`, `ink-bleed`)**: Subdivided 3D grid mesh with paper curl, cloth wave, and organic fiber-based ink bleed transitions across 14 projects (with looping `.mp4` support for video projects).
  - **About Drawer (`/about`)**: Slides/peels open as a 6-column right-side paper panel (`preview-paper`) featuring an interactive 3D matcap `SA` emblem (`/ab/sa.glb` + `/ab/sa-mate.webp`) and a custom GPU `"CLOSE"` ink cursor (`ink-label`) over the dark backdrop.
  - **Datamosh Route Transitions (`Mosh`, `MoshFlow`, `MoshSeed`, `MoshBlit`, `MoshStatic`)**: Ping-pong framebuffer optical/block flow transitions between `/` and `/work/<slug>`.

## Directory Layout

- `server.mjs` — Zero-dependency Node.js HTTP server (`PORT=3000` by default) with clean route resolution, HTTP `Range` (`206`) video streaming, and optional caching proxy fallback.
- `scripts/clone-and-unpack.mjs` — Downloads all HTML pages, `p.html` partials, fonts, MSDF `.bin` atlases, `/ab/sa.glb`, `/ab/sa-mate.webp`, gallery images/videos, and unpacks `/r.bin`, `/gpu/gl.*.bin`, and `/gpu/gpu.*.bin`.
- `public/` — Complete static site mirror ready to serve.
- `unpacked/` — Human-readable decoded files:
  - `unpacked/routes.json` — Decoded `/r.bin` route & media manifest (18 routes).
  - `unpacked/shaders/gl/` — 33 WebGL2 GLSL shader files (`Cast`, `Image`, `Mesh`, `Mosh`, `MoshBlit`, `MoshFlow`, `MoshSeed`, `MoshStatic`, `Msdf`, `Parallax`, `ink-bleed`, `ink-label`, `intro-list`, `mosh-intro`, `pointer-ripple`, `portrait-focus`, `preview-paper`, `project-exit`).
  - `unpacked/shaders/gpu/` — `blit.wgsl`, `specs.json`, and 22 WebGPU vertex/fragment WGSL shader pairs.
  - `unpacked/css/styles.pretty.css` — Formatted CSS stylesheet.
  - `unpacked/js/core.pretty.js` & `unpacked/js/engine.pretty.js` — Formatted core bootstrap and engine source.
