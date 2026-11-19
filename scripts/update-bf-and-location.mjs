import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

// Brutalist geometric beveled BF paths in 1408 x 423.02 coordinate space
// Outer B is clockwise in SVG screen space; inner B cutouts are counter-clockwise (so both nonzero & evenodd render crisp holes)
const BF_PATH_B_1408 =
  'M0 0H504.469L684.574 65.089V178L618 211.51L684.574 245V357.953L504.469 423.02H0V0Z' +
  'M171.5 96V166H513V96H171.5Z' +
  'M171.5 257V327H513V257H171.5Z';

const BF_PATH_F_1408 =
  'M902.846 0H1227.63L1407.98 65.337V128H894V178H1290V234L1178 274H894V423.02H722.492V65.089L902.846 0Z';

// Scaled to 64 x 19 coordinate space (exact match to 63.2441 / 1407.98 x, 19 / 423.02 y)
const SX = 63.2441 / 1407.98;
const SY = 19 / 423.02;

function scalePath(d) {
  let isY = false;
  // Parse tokens cleanly (commands vs numbers)
  return d.replace(/[A-Za-z]|-?\d*\.?\d+/g, (tok) => {
    if (/^[A-Za-z]$/.test(tok)) {
      if (tok === 'V') isY = true;
      else if (tok === 'H') isY = false;
      else isY = false; // M, L start with x
      return tok;
    }
    const val = parseFloat(tok);
    const scaled = isY ? val * SY : val * SX;
    isY = !isY;
    return Number(scaled.toFixed(4)).toString();
  });
}

// Note: H and V single-argument commands need exact x/y scaling:
function scalePathExact(d) {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+/g);
  const out = [];
  let cmd = '';
  let argIdx = 0;
  for (const tok of tokens) {
    if (/^[A-Za-z]$/.test(tok)) {
      cmd = tok;
      argIdx = 0;
      out.push(tok);
      continue;
    }
    const v = parseFloat(tok);
    let useY = false;
    if (cmd === 'V') useY = true;
    else if (cmd === 'H') useY = false;
    else useY = argIdx % 2 === 1;
    const s = useY ? v * SY : v * SX;
    out.push(Number(s.toFixed(4)).toString());
    argIdx++;
  }
  // Reassemble tightly matching SVG path string format
  return out.reduce((acc, t, idx) => {
    if (idx === 0) return t;
    const prev = out[idx - 1];
    if (/^[A-Za-z]$/.test(t) || /^[A-Za-z]$/.test(prev)) return acc + t;
    return acc + ' ' + t;
  }, '');
}

const BF_PATH_B_64 = scalePathExact(BF_PATH_B_1408);
const BF_PATH_F_64 = scalePathExact(BF_PATH_F_1408);

const BF_PATHS_1408 =
  `<path d="${BF_PATH_B_1408}" fill="currentColor" fill-rule="evenodd"></path>` +
  `<path d="${BF_PATH_F_1408}" fill="currentColor"></path>`;

const BF_PATHS_64 =
  `<path d="${BF_PATH_B_64}" fill="currentColor" fill-rule="evenodd"></path>` +
  `<path d="${BF_PATH_F_64}" fill="currentColor"></path>`;

// ---------------- 3D GLB GENERATOR ----------------
function svgTo3D(x, y) {
  // Center horizontally around x = 704, y = 211.51 -> [-0.808..0.808], [-0.2485..0.2485]
  const nx = ((x - 703.99) / 703.99) * 0.808;
  const ny = ((211.51 - y) / 211.51) * 0.2485;
  return [nx, ny];
}

function addTri(pos, nrm, a, b, c, nx, ny, nz) {
  pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  nrm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
}

function addQuad(pos, nrm, a, b, c, d, nx, ny, nz) {
  addTri(pos, nrm, a, b, c, nx, ny, nz);
  addTri(pos, nrm, a, c, d, nx, ny, nz);
}

/**
 * Given a 2D polygon loop in SVG screen coords (CW for outer, CCW for holes),
 * extrudes vertical side walls with a front chamfer bevel for metallic reflections.
 */
function extrudeLoopBeveled(pos, nrm, loopPts2D, zBack, zMid, zFront, bevelScale = 0.014) {
  const n = loopPts2D.length;
  // Convert to 3D XY
  const pts = loopPts2D.map(([x, y]) => svgTo3D(x, y));

  // Compute signed area in 3D XY (XY is flipped Y relative to screen: screen CW becomes XY CCW -> area > 0)
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % n];
    area2 += x1 * y2 - x2 * y1;
  }
  const isOuter = area2 > 0;

  // Compute inset vertices for front face chamfer so front lip catches light
  const insetPts = [];
  for (let i = 0; i < n; i++) {
    const pPrev = pts[(i - 1 + n) % n];
    const pCurr = pts[i];
    const pNext = pts[(i + 1) % n];

    const e1x = pCurr[0] - pPrev[0];
    const e1y = pCurr[1] - pPrev[1];
    const l1 = Math.hypot(e1x, e1y) || 1;

    const e2x = pNext[0] - pCurr[0];
    const e2y = pNext[1] - pCurr[1];
    const l2 = Math.hypot(e2x, e2y) || 1;

    // Outward normal in 3D XY for CCW outer loop is (ey, -ex); for hole (CW) it is (-ey, ex), which is still (ey, -ex) pointing INTO hole!
    const n1x = e1y / l1;
    const n1y = -e1x / l1;
    const n2x = e2y / l2;
    const n2y = -e2x / l2;

    // Inward vector = -(n1 + n2) normalized, scaled by miter clamp
    let ix = -(n1x + n2x);
    let iy = -(n1y + n2y);
    const il = Math.hypot(ix, iy) || 1;
    ix /= il;
    iy /= il;
    const dot = Math.max(0.45, ix * (-n1x) + iy * (-n1y));
    const dist = Math.min(bevelScale / dot, bevelScale * 1.8);
    insetPts.push([pCurr[0] + ix * dist, pCurr[1] + iy * dist]);
  }

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = pts[i];
    const b = pts[j];
    const ai = insetPts[i];
    const bi = insetPts[j];

    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    // Outward normal for XY CCW outer loop (and inward into hole for XY CW hole) is (dy, -dx, 0)
    const onx = dy / len;
    const ony = -dx / len;

    // Back-to-mid vertical side wall
    addQuad(
      pos,
      nrm,
      [a[0], a[1], zBack],
      [b[0], b[1], zBack],
      [b[0], b[1], zMid],
      [a[0], a[1], zMid],
      onx,
      ony,
      0
    );

    // Front bevel chamfer strip (mid -> front inset)
    const bnx = onx * 0.7071;
    const bny = ony * 0.7071;
    const bnz = 0.7071;
    addQuad(
      pos,
      nrm,
      [a[0], a[1], zMid],
      [b[0], b[1], zMid],
      [bi[0], bi[1], zFront],
      [ai[0], ai[1], zFront],
      bnx,
      bny,
      bnz
    );
  }

  return { pts, insetPts, isOuter };
}

function addConvexQuadCap(pos, nrm, quad2D, z, frontFacing = true) {
  const pts = quad2D.map(([x, y]) => svgTo3D(x, y));
  // Ensure CCW winding in XY for front (+Z), CW for back (-Z)
  const [p0, p1, p2, p3] = pts;
  const cross = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
  const ccw = cross > 0;
  if (frontFacing) {
    if (ccw) addQuad(pos, nrm, [p0[0], p0[1], z], [p1[0], p1[1], z], [p2[0], p2[1], z], [p3[0], p3[1], z], 0, 0, 1);
    else addQuad(pos, nrm, [p0[0], p0[1], z], [p3[0], p3[1], z], [p2[0], p2[1], z], [p1[0], p1[1], z], 0, 0, 1);
  } else {
    if (!ccw) addQuad(pos, nrm, [p0[0], p0[1], z], [p1[0], p1[1], z], [p2[0], p2[1], z], [p3[0], p3[1], z], 0, 0, -1);
    else addQuad(pos, nrm, [p0[0], p0[1], z], [p3[0], p3[1], z], [p2[0], p2[1], z], [p1[0], p1[1], z], 0, 0, -1);
  }
}

function buildLetterB() {
  const pos = [];
  const nrm = [];
  const zBack = -0.008;
  const zMid = 0.148;
  const zFront = 0.178;

  // Outer B loop (CW in screen space)
  const outer = [
    [0, 0],
    [504.469, 0],
    [684.574, 65.089],
    [684.574, 178],
    [618, 211.51],
    [684.574, 245],
    [684.574, 357.953],
    [504.469, 423.02],
    [0, 423.02],
  ];
  // Hole 1 (CCW in screen space)
  const hole1 = [
    [171.5, 96],
    [171.5, 166],
    [513, 166],
    [513, 96],
  ];
  // Hole 2 (CCW in screen space)
  const hole2 = [
    [171.5, 257],
    [171.5, 327],
    [513, 327],
    [513, 257],
  ];

  // Non-overlapping convex quads partitioning letter B (back cap at zBack, front cap at zMid — seamless with chamfer!)
  const quads = [
    // Top cap
    [[0, 0], [504.469, 0], [684.574, 65.089], [0, 65.089]],
    [[0, 65.089], [684.574, 65.089], [684.574, 96], [0, 96]],
    // Upper walls
    [[0, 96], [171.5, 96], [171.5, 166], [0, 166]],
    [[513, 96], [684.574, 96], [684.574, 166], [513, 166]],
    // Middle bar
    [[0, 166], [684.574, 166], [684.574, 178], [0, 178]],
    [[0, 178], [684.574, 178], [618, 211.51], [0, 211.51]],
    [[0, 211.51], [618, 211.51], [684.574, 245], [0, 245]],
    [[0, 245], [684.574, 245], [684.574, 257], [0, 257]],
    // Lower walls
    [[0, 257], [171.5, 257], [171.5, 327], [0, 327]],
    [[513, 257], [684.574, 257], [684.574, 327], [513, 327]],
    // Bottom cap
    [[0, 327], [684.574, 327], [684.574, 357.953], [0, 357.953]],
    [[0, 357.953], [684.574, 357.953], [504.469, 423.02], [0, 423.02]],
  ];

  for (const q of quads) {
    addConvexQuadCap(pos, nrm, q, zFront, true);
    addConvexQuadCap(pos, nrm, q, zBack, false);
  }

  // Extrude outer & holes with front bevel (from zMid to zFront slightly inset, wait: front cap uses zFront so let's cap at zFront and bevel outward OR inset slightly!)
  // Wait: to keep caps flush with beveled inner ring without any gap, let's place front flat cap at zMid? No, flat cap at zFront must use insetPts, OR even cleaner: bevel from zMid (exact 2D) -> zFront (exact 2D)?? Wait: if zMid -> zFront doesn't inset XY, the bevel face is vertical (zero Z-slope). If we inset the front cap slightly by 16 SVG units (still completely flat & exact silhouette), wait — for 2-quad partition it's easiest to extrude zBack..zMid vertical, AND bevel zMid (exact) -> zFront (slightly scaled inward around each letter's local center OR inset!).
  // Wait: if we inset the front face slightly by building front caps on the inset coords? No, for B with notch/bevels, inset of inner holes moves *outward* into the solid, shrinking the strip width uniformly! Look how easy that is:
  // If we inset all edges by d=16 SVG units (d=0.0183 in 3D):
  //   outer top y: 0->16, bottom y: 423.02->407.02, left x: 0->16, right x: 684.574->668.574
  //   hole1 top y: 96->80, bottom y: 166->182, left x: 171.5->187.5, right x: 513->497
  // Actually, even simpler and 100% gap-free: keep the exact silhouette at zFront (no XY inset), and give the front edge ring a 45° smoothed vertex normal on the outer wall's top edge (or add a tiny 0.015 bevel using ear-free quad strips)!Wait: since Mesh/f.glsl uses smooth interpolated vertex normals `vN`, if we simply split the side wall into 2 vertical bands (`zBack -> zMid` flat side normal `(onx, ony, 0)`, and `zMid -> zFront` with bottom vertices normal `(onx, ony, 0)` and top vertices normal `normalize(onx, ony, 1.0)`), the front rim catches the exact smooth specular bevel highlight with ZERO gap and exact silhouette! Let's check: does `addQuad` support per-vertex normals? YES! Let's write `addQuadVN`!
  return { outer, holes: [hole1, hole2], quads };
}

function addQuadVN(pos, nrm, a, b, c, d, na, nb, nc, nd) {
  pos.push(
    a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2],
    a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]
  );
  nrm.push(
    na[0], na[1], na[2], nb[0], nb[1], nb[2], nc[0], nc[1], nc[2],
    na[0], na[1], na[2], nc[0], nc[1], nc[2], nd[0], nd[1], nd[2]
  );
}

function buildLetterMesh({ loops, quads }) {
  const pos = [];
  const nrm = [];
  const zBack = -0.008;
  const zMid = 0.145;
  const zFront = 0.178;

  for (const q of quads) {
    addConvexQuadCap(pos, nrm, q, zFront, true);
    addConvexQuadCap(pos, nrm, q, zBack, false);
  }

  for (const loopPts2D of loops) {
    const n = loopPts2D.length;
    const pts = loopPts2D.map(([x, y]) => svgTo3D(x, y));
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = pts[i];
      const b = pts[j];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      const onx = dy / len;
      const ony = -dx / len;
      const nSide = [onx, ony, 0];
      const inv = Math.SQRT1_2;
      const nLip = [onx * inv, ony * inv, inv];

      // Lower side wall (crisp extruded side)
      addQuadVN(
        pos, nrm,
        [a[0], a[1], zBack],
        [b[0], b[1], zBack],
        [b[0], b[1], zMid],
        [a[0], a[1], zMid],
        nSide, nSide, nSide, nSide
      );
      // Upper bevel highlight lip (smoothly catches studio reflection at 45 deg)
      addQuadVN(
        pos, nrm,
        [a[0], a[1], zMid],
        [b[0], b[1], zMid],
        [b[0], b[1], zFront],
        [a[0], a[1], zFront],
        nSide, nSide, nLip, nLip
      );
    }
  }

  return {
    pos: new Float32Array(pos),
    nrm: new Float32Array(nrm),
  };
}

function computeMinMax(arr) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < arr.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (arr[i + k] < min[k]) min[k] = arr[i + k];
      if (arr[i + k] > max[k]) max[k] = arr[i + k];
    }
  }
  return { min, max };
}

function createBFGlb() {
  const bSpec = {
    loops: [
      [
        [0, 0],
        [504.469, 0],
        [684.574, 65.089],
        [684.574, 178],
        [618, 211.51],
        [684.574, 245],
        [684.574, 357.953],
        [504.469, 423.02],
        [0, 423.02],
      ],
      [
        [171.5, 96],
        [171.5, 166],
        [513, 166],
        [513, 96],
      ],
      [
        [171.5, 257],
        [171.5, 327],
        [513, 327],
        [513, 257],
      ],
    ],
    quads: [
      [[0, 0], [504.469, 0], [684.574, 65.089], [0, 65.089]],
      [[0, 65.089], [684.574, 65.089], [684.574, 96], [0, 96]],
      [[0, 96], [171.5, 96], [171.5, 166], [0, 166]],
      [[513, 96], [684.574, 96], [684.574, 166], [513, 166]],
      [[0, 166], [684.574, 166], [684.574, 178], [0, 178]],
      [[0, 178], [684.574, 178], [618, 211.51], [0, 211.51]],
      [[0, 211.51], [618, 211.51], [684.574, 245], [0, 245]],
      [[0, 245], [684.574, 245], [684.574, 257], [0, 257]],
      [[0, 257], [171.5, 257], [171.5, 327], [0, 327]],
      [[513, 257], [684.574, 257], [684.574, 327], [513, 327]],
      [[0, 327], [684.574, 327], [684.574, 357.953], [0, 357.953]],
      [[0, 357.953], [684.574, 357.953], [504.469, 423.02], [0, 423.02]],
    ],
  };

  const fSpec = {
    loops: [
      [
        [902.846, 0],
        [1227.63, 0],
        [1407.98, 65.337],
        [1407.98, 128],
        [894, 128],
        [894, 178],
        [1290, 178],
        [1290, 234],
        [1178, 274],
        [894, 274],
        [894, 423.02],
        [722.492, 423.02],
        [722.492, 65.089],
      ],
    ],
    quads: [
      [[902.846, 0], [1227.63, 0], [1407.98, 65.337], [722.492, 65.089]],
      [[722.492, 65.089], [1407.98, 65.337], [1407.98, 128], [722.492, 128]],
      [[722.492, 128], [894, 128], [894, 178], [722.492, 178]],
      [[722.492, 178], [1290, 178], [1290, 234], [722.492, 234]],
      [[722.492, 234], [1290, 234], [1178, 274], [722.492, 274]],
      [[722.492, 274], [894, 274], [894, 423.02], [722.492, 423.02]],
    ],
  };

  const meshB = buildLetterMesh(bSpec);
  const meshF = buildLetterMesh(fSpec);

  const bMM = computeMinMax(meshB.pos);
  const fMM = computeMinMax(meshF.pos);

  const bPosBuf = Buffer.from(meshB.pos.buffer);
  const bNrmBuf = Buffer.from(meshB.nrm.buffer);
  const fPosBuf = Buffer.from(meshF.pos.buffer);
  const fNrmBuf = Buffer.from(meshF.nrm.buffer);

  const binBufRaw = Buffer.concat([bPosBuf, bNrmBuf, fPosBuf, fNrmBuf]);
  const binPad = (4 - (binBufRaw.length % 4)) % 4;
  const binChunk = Buffer.concat([binBufRaw, Buffer.alloc(binPad, 0)]);

  const gltf = {
    asset: { version: '2.0', generator: 'bf-emblem-generator' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'bf_emblem', children: [1, 2] },
      { name: 'letter_b', mesh: 0 },
      { name: 'letter_f', mesh: 1 },
    ],
    meshes: [
      { primitives: [{ mode: 4, attributes: { POSITION: 0, NORMAL: 1 } }] },
      { primitives: [{ mode: 4, attributes: { POSITION: 2, NORMAL: 3 } }] },
    ],
    buffers: [{ byteLength: binBufRaw.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: bPosBuf.length, target: 34962 },
      { buffer: 0, byteOffset: bPosBuf.length, byteLength: bNrmBuf.length, target: 34962 },
      { buffer: 0, byteOffset: bPosBuf.length + bNrmBuf.length, byteLength: fPosBuf.length, target: 34962 },
      {
        buffer: 0,
        byteOffset: bPosBuf.length + bNrmBuf.length + fPosBuf.length,
        byteLength: fNrmBuf.length,
        target: 34962,
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: meshB.pos.length / 3,
        type: 'VEC3',
        min: bMM.min,
        max: bMM.max,
      },
      { bufferView: 1, componentType: 5126, count: meshB.nrm.length / 3, type: 'VEC3' },
      {
        bufferView: 2,
        componentType: 5126,
        count: meshF.pos.length / 3,
        type: 'VEC3',
        min: fMM.min,
        max: fMM.max,
      },
      { bufferView: 3, componentType: 5126, count: meshF.nrm.length / 3, type: 'VEC3' },
    ],
  };

  const jsonRaw = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jsonPad = (4 - (jsonRaw.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonRaw, Buffer.alloc(jsonPad, 0x20)]);

  const totalLength = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const glb = Buffer.alloc(totalLength);
  let off = 0;
  glb.writeUInt32LE(0x46546c67, off); off += 4; // "glTF"
  glb.writeUInt32LE(2, off); off += 4;          // version 2
  glb.writeUInt32LE(totalLength, off); off += 4;

  glb.writeUInt32LE(jsonChunk.length, off); off += 4;
  glb.writeUInt32LE(0x4e4f534a, off); off += 4; // "JSON"
  jsonChunk.copy(glb, off); off += jsonChunk.length;

  glb.writeUInt32LE(binChunk.length, off); off += 4;
  glb.writeUInt32LE(0x004e4942, off); off += 4; // "BIN\0"
  binChunk.copy(glb, off);

  return {
    glb,
    vertexCount: (meshB.pos.length + meshF.pos.length) / 3,
    bMM,
    fMM,
  };
}

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

function replaceSvgInner(html, svgId, replacementInner) {
  const re = new RegExp(`(<svg[^>]*\\bid="${svgId}"[^>]*>)([\\s\\S]*?)(<\\/svg>)`, 'g');
  return html.replace(re, (full, open, inner, close) => {
    if (svgId === 'lo-mark-svg') {
      const rectMatch = inner.match(/<rect[^>]*><\/rect>/);
      const rect = rectMatch ? rectMatch[0] : '<rect width="1408" height="424" fill="currentColor"></rect>';
      return open + rect + replacementInner + close;
    }
    return open + replacementInner + close;
  });
}

async function main() {
  const allPublic = await walkFiles(PUBLIC_DIR);
  const htmlFiles = allPublic.filter((f) => f.endsWith('.html'));

  let updatedHtmlCount = 0;
  for (const file of htmlFiles) {
    let text = await fs.readFile(file, 'utf8');
    const orig = text;

    // Update location text
    text = text.replace(/born in Bali, Indonesia/g, 'born in Cebu, Philippines');

    // Replace all 1408-scale and 64-scale monograms with BF
    text = replaceSvgInner(text, 'ho-he-0-fo-lg', BF_PATHS_1408);
    text = replaceSvgInner(text, 'ho-fo-lg', BF_PATHS_1408);
    text = replaceSvgInner(text, 'lo-mark-svg', BF_PATHS_1408);
    text = replaceSvgInner(text, 'ho-he-1-lg', BF_PATHS_64);
    text = replaceSvgInner(text, 'ab-lg', BF_PATHS_64);
    text = replaceSvgInner(text, 'ab-im-lg', BF_PATHS_64);

    if (text !== orig) {
      await fs.writeFile(file, text, 'utf8');
      updatedHtmlCount++;
    }
  }
  console.log(`Updated ${updatedHtmlCount}/${htmlFiles.length} HTML/partial files with BF monograms & Cebu, Philippines.`);

  // Update favicon.svg and site.webmanifest
  const faviconSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">` +
    `<rect width="512" height="512" fill="#000"/>` +
    `<g transform="translate(46 193) scale(0.2983)">` +
    `<path d="${BF_PATH_B_1408}" fill="#fff" fill-rule="evenodd"/>` +
    `<path d="${BF_PATH_F_1408}" fill="#fff"/>` +
    `</g></svg>\n`;
  await fs.writeFile(path.join(PUBLIC_DIR, 'favicon', 'favicon.svg'), faviconSvg, 'utf8');

  const manifestPath = path.join(PUBLIC_DIR, 'favicon', 'site.webmanifest');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.name = 'BF';
  manifest.short_name = 'BF';
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log('Updated favicon.svg and site.webmanifest to BF.');

  // Generate 3D BF GLB mesh
  const { glb, vertexCount, bMM, fMM } = createBFGlb();
  const glbPath = path.join(PUBLIC_DIR, 'ab', 'sa.glb');
  await fs.writeFile(glbPath, glb);
  console.log(`Generated 3D BF GLB -> public/ab/sa.glb (${glb.length} bytes, ${vertexCount} vertices)`);
  console.log('letter_b bounds:', bMM, 'letter_f bounds:', fMM);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
