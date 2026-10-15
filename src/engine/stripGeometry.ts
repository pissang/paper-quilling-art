/**
 * Geometry of paper strips standing on edge, as in paper quilling.
 *
 * Each strip is a thin slab swept along a 2D centre line. The cross section is
 * a rectangle `thickness` wide with slightly rounded top corners (a cut paper
 * edge), sunk a little into the board as if glued. Strips are not perfectly
 * regular: their height wavers, they lean a few degrees and lean differently
 * along their length, the way hand-placed paper does. The ends are cut square.
 *
 * Height is applied late (see `applyHeight`) so layer heights can change
 * without rebuilding the strips.
 */

export type Point2 = [number, number];

/** Height independent vertex data. Position = base + lean·z, z = hf·height + dz. */
export interface StripLayout {
  /** Centre line offset by the cross section, xy per vertex. */
  base: Float32Array;
  /** Horizontal shift per unit height, xy per vertex. */
  lean: Float32Array;
  /** Fraction of the layer height (0 for the glued bottom edge). */
  hf: Float32Array;
  /** Absolute z offset (sink and top corner rounding). */
  dz: Float32Array;
}

export interface StripMesh extends StripLayout {
  normal: Float32Array;
  indices: Uint32Array;
}

export interface StripOptions {
  thickness: number;
  /** 0 is machine perfect, 1 is noticeably hand made. */
  imperfection: number;
  rand: () => number;
  /** Treat the polyline as a loop (no end caps). */
  closed?: boolean;
}

/** How far strips sit into the board, so no light leaks under the glued edge. */
const SINK = 0.004;
/** Top corner radius relative to the half thickness. */
const CORNER = 0.6;
/** Resampling limits along the centre line. */
const MAX_STEP = 0.06;
const MAX_TURN = (5 * Math.PI) / 180;
/** Miter scale limit at sharp turns. */
const MITER_LIMIT = 2;

/**
 * Cross section, left to right: [side offset in half thicknesses, height
 * fraction, z offset in half thicknesses, normal u, normal z].
 */
const C45 = Math.SQRT1_2;
const PROFILE: [number, number, number, number, number][] = [
  [-1, 0, 0, -1, 0],
  [-1, 1, -CORNER, -1, 0],
  [-1 + CORNER * (1 - C45), 1, -CORNER * (1 - C45), -C45, C45],
  [1 - CORNER * (1 - C45), 1, -CORNER * (1 - C45), C45, C45],
  [1, 1, -CORNER, 1, 0],
  [1, 0, 0, 1, 0]
];
const RING = PROFILE.length;

// Centre line ----------------------------------------------------------------

function dedupe(points: Point2[], eps: number) {
  const out: Point2[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    if (Math.hypot(points[i][0] - prev[0], points[i][1] - prev[1]) > eps) {
      out.push(points[i]);
    }
  }
  return out;
}

/** Chaikin corner cutting. Paper cannot hold a kink, it bends with some radius. */
function chaikin(points: Point2[], closed: boolean, iterations: number) {
  let pts = points;
  for (let iter = 0; iter < iterations; iter++) {
    const n = pts.length;
    const out: Point2[] = closed ? [] : [pts[0]];
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      out.push(
        [a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25],
        [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]
      );
    }
    if (!closed) {
      out.push(pts[n - 1]);
    }
    pts = out;
  }
  return pts;
}

/** Keeps a point when the strip has run MAX_STEP or turned MAX_TURN since the last kept one. */
function decimate(points: Point2[]) {
  const out: Point2[] = [points[0]];
  let run = 0;
  let turn = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i - 1];
    const c = points[i];
    const q = points[i + 1];
    run += Math.hypot(c[0] - p[0], c[1] - p[1]);
    const a0 = Math.atan2(c[1] - p[1], c[0] - p[0]);
    const a1 = Math.atan2(q[1] - c[1], q[0] - c[0]);
    let da = a1 - a0;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    turn += Math.abs(da);
    if (run >= MAX_STEP || turn >= MAX_TURN) {
      out.push(c);
      run = turn = 0;
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Signed turning of the last few segments, used to pick the curl direction. */
function endTurn(points: Point2[]) {
  const n = points.length;
  const k = Math.min(6, n - 1);
  const a = points[n - 1 - k];
  const b = points[n - 1 - Math.floor(k / 2)];
  const c = points[n - 1];
  return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
}

/** Appends a tightening scroll, the classic quilled end. */
function appendCurl(points: Point2[], rand: () => number) {
  const n = points.length;
  const last = points[n - 1];
  const prev = points[Math.max(n - 3, 0)];
  let heading = Math.atan2(last[1] - prev[1], last[0] - prev[0]);
  const turn = endTurn(points);
  const side = Math.abs(turn) > 1e-6 ? Math.sign(turn) : rand() < 0.5 ? -1 : 1;
  const r0 = 0.08 + rand() * 0.07;
  const total = Math.PI * (1.4 + rand() * 0.9);
  const ds = 0.008;
  let [x, y] = last;
  let turned = 0;
  while (turned < total) {
    const r = r0 * (1 - 0.7 * turned / total);
    const dθ = ds / r;
    heading += side * dθ;
    turned += dθ;
    x += Math.cos(heading) * ds;
    y += Math.sin(heading) * ds;
    points.push([x, y]);
  }
}

/** Adds scrolls to the ends of an open polyline, each end with probability `amount`. */
export function curlEnds(points: Point2[], amount: number, rand: () => number): Point2[] {
  // Draw both numbers every time so the rest of the sequence stays stable.
  const curlEnd = rand() < amount;
  const curlStart = rand() < amount;
  let pts = points.slice();
  if (curlEnd && pts.length > 2) {
    appendCurl(pts, rand);
  }
  if (curlStart && pts.length > 2) {
    pts.reverse();
    appendCurl(pts, rand);
    pts.reverse();
  }
  return pts;
}

// Hand made variation ---------------------------------------------------------

/** Smooth 1D wobble: a few sines with random phases, roughly in [-1, 1]. */
function wobble(rand: () => number, wavelengths: number[]) {
  const terms = wavelengths.map(w => ({
    k: (Math.PI * 2) / (w * (0.7 + rand() * 0.6)),
    phase: rand() * Math.PI * 2
  }));
  const norm = 1 / Math.sqrt(terms.length);
  return (s: number) => {
    let v = 0;
    for (const t of terms) {
      v += Math.sin(s * t.k + t.phase);
    }
    return v * norm;
  };
}

// Mesh -----------------------------------------------------------------------

export function buildStrip(polyline: Point2[], opts: StripOptions): StripMesh | null {
  const { thickness, imperfection, rand } = opts;
  let closed = !!opts.closed;

  let pts = dedupe(polyline, 1e-5);
  if (closed && pts.length > 2) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-3) {
      pts.pop();
    }
  }
  if (pts.length < 2) {
    return null;
  }
  if (pts.length < 3) {
    closed = false;
  }
  pts = decimate(chaikin(pts, closed, 2));
  const n = pts.length;
  if (n < 2) {
    return null;
  }

  // Tangents, normals and arc length.
  const nx = new Float32Array(n);
  const ny = new Float32Array(n);
  const miter = new Float32Array(n);
  const arc = new Float32Array(n);
  const segDir = (i: number): Point2 => {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  };
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      arc[i] = arc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    }
    const hasPrev = closed || i > 0;
    const hasNext = closed || i < n - 1;
    const d0 = hasPrev ? segDir((i - 1 + n) % n) : segDir(i);
    const d1 = hasNext ? segDir(i) : d0;
    let tx = d0[0] + d1[0];
    let ty = d0[1] + d1[1];
    const tl = Math.hypot(tx, ty);
    if (tl < 1e-6) {
      // Full reversal, keep the incoming direction.
      tx = d0[0];
      ty = d0[1];
    }
    else {
      tx /= tl;
      ty /= tl;
    }
    nx[i] = -ty;
    ny[i] = tx;
    // Offset along the averaged normal by 1/cos(half angle) keeps the slab thickness.
    const cos = -ty * -d1[1] + tx * d1[0];
    miter[i] = Math.min(1 / Math.max(cos, 1e-3), MITER_LIMIT);
  }

  // Per strip and along the strip variation.
  const imp = imperfection;
  const heightScale = 1 + imp * 0.05 * (rand() * 2 - 1);
  const heightWobble = wobble(rand, [1.6, 0.55]);
  const edgeWobble = wobble(rand, [0.12, 0.07]);
  const baseLean = imp * 0.06 * (rand() * 2 - 1);
  const leanWobble = wobble(rand, [2.2, 0.9]);

  const half = thickness / 2;
  const capVerts = closed ? 0 : RING * 2;
  const vertexCount = n * RING + capVerts;
  const base = new Float32Array(vertexCount * 2);
  const lean = new Float32Array(vertexCount * 2);
  const hf = new Float32Array(vertexCount);
  const dz = new Float32Array(vertexCount);
  const normal = new Float32Array(vertexCount * 3);

  const writeVertex = (v: number, i: number, p: number, nxOverride?: number, nyOverride?: number) => {
    const [u, h, z, nu, nz] = PROFILE[p];
    const s = arc[i];
    const offset = u * half * miter[i];
    base[v * 2] = pts[i][0] + nx[i] * offset;
    base[v * 2 + 1] = pts[i][1] + ny[i] * offset;
    const tilt = baseLean + imp * 0.025 * leanWobble(s);
    lean[v * 2] = nx[i] * tilt;
    lean[v * 2 + 1] = ny[i] * tilt;
    if (h > 0) {
      hf[v] = heightScale * (1 + imp * (0.03 * heightWobble(s) + 0.006 * edgeWobble(s)));
      dz[v] = z * half;
    }
    else {
      hf[v] = 0;
      dz[v] = -SINK;
    }
    if (nxOverride !== undefined) {
      normal[v * 3] = nxOverride;
      normal[v * 3 + 1] = nyOverride!;
      normal[v * 3 + 2] = 0;
    }
    else {
      normal[v * 3] = nx[i] * nu;
      normal[v * 3 + 1] = ny[i] * nu;
      normal[v * 3 + 2] = nz;
    }
  };

  for (let i = 0; i < n; i++) {
    for (let p = 0; p < RING; p++) {
      writeVertex(i * RING + p, i, p);
    }
  }

  const segments = closed ? n : n - 1;
  const capTris = closed ? 0 : (RING - 2) * 2;
  const indices = new Uint32Array(segments * (RING - 1) * 6 + capTris * 3);
  let k = 0;
  for (let i = 0; i < segments; i++) {
    const a = i * RING;
    const b = ((i + 1) % n) * RING;
    for (let p = 0; p < RING - 1; p++) {
      // Winding gives outward facing triangles for left (-u) to right (+u) rings.
      indices[k++] = a + p;
      indices[k++] = b + p;
      indices[k++] = a + p + 1;
      indices[k++] = a + p + 1;
      indices[k++] = b + p;
      indices[k++] = b + p + 1;
    }
  }

  if (!closed) {
    // Square cut ends with their own flat normals.
    const ends: [number, number, number][] = [[0, -1, n * RING], [n - 1, 1, n * RING + RING]];
    for (const [i, dir, start] of ends) {
      const tx = ny[i] * dir;
      const ty = -nx[i] * dir;
      for (let p = 0; p < RING; p++) {
        writeVertex(start + p, i, p, tx, ty);
      }
      for (let p = 1; p < RING - 1; p++) {
        if (dir < 0) {
          indices[k++] = start;
          indices[k++] = start + p;
          indices[k++] = start + p + 1;
        }
        else {
          indices[k++] = start;
          indices[k++] = start + p + 1;
          indices[k++] = start + p;
        }
      }
    }
  }

  return { base, lean, hf, dz, normal, indices };
}

/** Concatenates strips. The result's layout drives `applyHeight`. */
export function mergeStripMeshes(meshes: StripMesh[]): StripMesh {
  let vertexCount = 0;
  let indexCount = 0;
  for (const m of meshes) {
    vertexCount += m.hf.length;
    indexCount += m.indices.length;
  }
  const out: StripMesh = {
    base: new Float32Array(vertexCount * 2),
    lean: new Float32Array(vertexCount * 2),
    hf: new Float32Array(vertexCount),
    dz: new Float32Array(vertexCount),
    normal: new Float32Array(vertexCount * 3),
    indices: new Uint32Array(indexCount)
  };
  let v = 0;
  let k = 0;
  for (const m of meshes) {
    out.base.set(m.base, v * 2);
    out.lean.set(m.lean, v * 2);
    out.hf.set(m.hf, v);
    out.dz.set(m.dz, v);
    out.normal.set(m.normal, v * 3);
    for (let i = 0; i < m.indices.length; i++) {
      out.indices[k + i] = m.indices[i] + v;
    }
    v += m.hf.length;
    k += m.indices.length;
  }
  return out;
}

/** Writes xyz positions for strips raised to `height`. */
export function applyHeight(layout: StripLayout, height: number, position: Float32Array = new Float32Array(layout.hf.length * 3)) {
  const { base, lean, hf, dz } = layout;
  for (let v = 0; v < hf.length; v++) {
    const z = hf[v] * height + dz[v];
    position[v * 3] = base[v * 2] + lean[v * 2] * z;
    position[v * 3 + 1] = base[v * 2 + 1] + lean[v * 2 + 1] * z;
    position[v * 3 + 2] = z;
  }
  return position;
}
