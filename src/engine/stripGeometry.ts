/**
 * Geometry of paper strips standing on edge, as in paper quilling.
 *
 * Each strip is a thin slab swept along a 2D centre line. The cross section is
 * a rectangle `thickness` wide with slightly rounded top corners (a cut paper
 * edge), sunk a little into the board as if glued. Strips are not perfectly
 * regular: their height wavers, they lean a few degrees and lean differently
 * along their length, the way hand-placed paper does. The ends are cut square.
 *
 * Height is applied late (see `applyHeight`) so heights can change without
 * rebuilding the strips.
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
  /** Smoothing radius for traced, pixel-stepped input. */
  smooth?: number;
  /** Height of this strip relative to the others, e.g. for strips cut wider. */
  heightScale?: number;
}

/** How far strips sit into the board, so no light leaks under the glued edge. */
const SINK = 0.004;
/** Top corner radius relative to the half thickness. */
const CORNER = 0.6;
/** Simplification limits along the centre line. */
const TOLERANCE = 0.003;
const MAX_STEP = 0.25;
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

/** Points every `step` along the line, keeping both ends of an open line. */
function resample(points: Point2[], closed: boolean, step: number): Point2[] {
  const pts = closed ? [...points, points[0]] : points;
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  const count = Math.max(closed ? 3 : 2, Math.round(total / step));
  const spacing = total / count;
  const out: Point2[] = [pts[0]];
  let seg = 1;
  let segStart = 0;
  let segLen = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
  for (let k = 1; k < count; k++) {
    const target = k * spacing;
    while (segStart + segLen < target && seg < pts.length - 1) {
      segStart += segLen;
      seg++;
      segLen = Math.hypot(pts[seg][0] - pts[seg - 1][0], pts[seg][1] - pts[seg - 1][1]);
    }
    const t = segLen > 0 ? (target - segStart) / segLen : 0;
    const a = pts[seg - 1];
    const b = pts[seg];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  if (!closed) {
    out.push(pts[pts.length - 1]);
  }
  return out;
}

/**
 * Evens out a traced line: uniform resampling, then three box filter passes
 * (close to a Gaussian) over `radius`. Paper bends in smooth curves, so pixel
 * steps in traced contours must not show.
 */
export function smoothLine(points: Point2[], closed: boolean, radius: number) {
  const step = Math.min(radius / 3, 0.02);
  let pts = resample(points, closed, step);
  const n = pts.length;
  const k = Math.max(1, Math.round(radius / step / 2));
  for (let pass = 0; pass < 3; pass++) {
    const out: Point2[] = new Array(n);
    for (let i = 0; i < n; i++) {
      if (!closed && (i < 1 || i > n - 2)) {
        out[i] = pts[i];
        continue;
      }
      let x = 0;
      let y = 0;
      let m = 0;
      for (let j = -k; j <= k; j++) {
        let q = i + j;
        if (closed) {
          q = (q + n) % n;
        }
        else if (q < 0 || q >= n) {
          continue;
        }
        x += pts[q][0];
        y += pts[q][1];
        m++;
      }
      out[i] = [x / m, y / m];
    }
    pts = out;
  }
  return pts;
}

/** Squared distance from p to segment ab. */
function segDist2(p: Point2, a: Point2, b: Point2) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const ex = a[0] + dx * t - p[0];
  const ey = a[1] + dy * t - p[1];
  return ex * ex + ey * ey;
}

/**
 * Douglas-Peucker simplification with a segment length cap. Shading uses
 * averaged tangents, so a coarse centre line still reads as a smooth bend.
 */
export function simplify(points: Point2[], tolerance = TOLERANCE, maxStep = MAX_STEP): Point2[] {
  const n = points.length;
  if (n < 3) {
    return points.slice();
  }
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const tol2 = tolerance * tolerance;
  const maxStep2 = maxStep * maxStep;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop()!;
    if (i1 - i0 < 2) {
      continue;
    }
    let worst = -1;
    let worstD = tol2;
    for (let i = i0 + 1; i < i1; i++) {
      const d = segDist2(points[i], points[i0], points[i1]);
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst < 0) {
      const dx = points[i1][0] - points[i0][0];
      const dy = points[i1][1] - points[i0][1];
      if (dx * dx + dy * dy > maxStep2) {
        worst = (i0 + i1) >> 1;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([i0, worst], [worst, i1]);
    }
  }
  return points.filter((_, i) => keep[i]);
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
  if (opts.smooth) {
    pts = smoothLine(pts, closed, opts.smooth);
  }
  if (closed) {
    // Simplify as an open line that returns to its start.
    pts = simplify([...pts, pts[0]]);
    pts.pop();
  }
  else {
    pts = simplify(pts);
  }
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
  const heightScale = (opts.heightScale ?? 1) * (1 + imp * 0.05 * (rand() * 2 - 1));
  const heightWobble = wobble(rand, [2.4, 1.2]);
  const baseLean = imp * 0.06 * (rand() * 2 - 1);
  // Long waves only: short ones read as a crumpled strip rather than hand work.
  const leanWobble = wobble(rand, [3, 1.6]);

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
      hf[v] = heightScale * (1 + imp * 0.03 * heightWobble(s));
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
