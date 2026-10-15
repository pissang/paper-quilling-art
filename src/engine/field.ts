/** Distance fields and their iso-lines on a pixel grid (row 0 at the top). */

import type { Point2 } from './stripGeometry';

/** 1D squared distance transform (Felzenszwalb and Huttenlocher). */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s: number;
    do {
      const p = v[k];
      s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
    } while (s <= z[k] && --k >= 0);
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) {
      k++;
    }
    d[q] = (q - v[k]) ** 2 + f[v[k]];
  }
}

/**
 * Euclidean distance in pixels from each inside pixel to the nearest outside
 * pixel centre; 0 outside. Beyond the grid counts as outside unless
 * `edgeInside` is set, in which case only real outside pixels count.
 */
export function distanceTransform(inside: Uint8Array, w: number, h: number, edgeInside = false): Float32Array {
  // One pixel of padding makes the image border an edge (or not).
  const pw = w + 2;
  const ph = h + 2;
  const grid = new Float64Array(pw * ph).fill(edgeInside ? 1e20 : 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      grid[(y + 1) * pw + x + 1] = inside[y * w + x] ? 1e20 : 0;
    }
  }
  const len = Math.max(pw, ph);
  const f = new Float64Array(len);
  const d = new Float64Array(len);
  const v = new Int32Array(len);
  const z = new Float64Array(len + 1);
  for (let x = 0; x < pw; x++) {
    for (let y = 0; y < ph; y++) {
      f[y] = grid[y * pw + x];
    }
    edt1d(f, ph, d, v, z);
    for (let y = 0; y < ph; y++) {
      grid[y * pw + x] = d[y];
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      f[x] = grid[y * pw + x];
    }
    edt1d(f, pw, d, v, z);
    if (y >= 1 && y <= h) {
      for (let x = 1; x <= w; x++) {
        out[(y - 1) * w + x - 1] = Math.sqrt(d[x]);
      }
    }
  }
  return out;
}

/** 4-connected components of a mask: component id per pixel (-1 outside) and sizes. */
export function maskComponents(inside: Uint8Array, w: number, h: number) {
  const comp = new Int32Array(inside.length).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < inside.length; start++) {
    if (!inside[start] || comp[start] >= 0) {
      continue;
    }
    const id = sizes.length;
    let size = 0;
    comp[start] = id;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % w;
      const y = (p - x) / w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && inside[q] && comp[q] < 0) {
          comp[q] = id;
          stack.push(q);
        }
      }
    }
    sizes.push(size);
  }
  return { comp, sizes };
}

/** Bilinear lookup at fractional pixel coordinates, 0 beyond the grid. */
export function sampleField(field: Float32Array, w: number, h: number, fx: number, fy: number) {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : field[y * w + x]);
  return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty)
    + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
}

// Edges of a cell: top, right, bottom, left.
const T = 0, R = 1, B = 2, L = 3;
/** Segments per marching squares case; corners tl=8, tr=4, br=2, bl=1. Saddles handled separately. */
const CASES: number[][] = [
  [], [L, B], [B, R], [L, R], [T, R], [], [T, B], [T, L],
  [T, L], [T, B], [], [T, R], [L, R], [B, R], [L, B], []
];

/**
 * Closed iso-lines of `field` at `level`, in pixel coordinates. The grid is
 * surrounded by `border` (below the level), so every line closes.
 */
export function isoLines(field: Float32Array, w: number, h: number, level: number, border = 0): Point2[][] {
  const val = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? border : field[y * w + x]);
  const stride = w + 2;
  // Edge ids: horizontal edges below corner (x, y) and vertical edges right of it.
  const edgeKey = (x: number, y: number, horizontal: boolean) => (((y + 1) * stride + (x + 1)) << 1) | (horizontal ? 0 : 1);
  const points = new Map<number, Point2>();
  const links = new Map<number, number[]>();

  const edgePoint = (key: number, x0: number, y0: number, x1: number, y1: number) => {
    if (!points.has(key)) {
      const v0 = val(x0, y0);
      const v1 = val(x1, y1);
      const t = (level - v0) / (v1 - v0);
      points.set(key, [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
    }
    return key;
  };
  const link = (a: number, b: number) => {
    let la = links.get(a);
    if (!la) {
      links.set(a, la = []);
    }
    la.push(b);
    let lb = links.get(b);
    if (!lb) {
      links.set(b, lb = []);
    }
    lb.push(a);
  };

  for (let y = -1; y < h; y++) {
    for (let x = -1; x < w; x++) {
      const tl = val(x, y) > level;
      const tr = val(x + 1, y) > level;
      const br = val(x + 1, y + 1) > level;
      const bl = val(x, y + 1) > level;
      const idx = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
      if (idx === 0 || idx === 15) {
        continue;
      }
      const edge = (e: number) => {
        switch (e) {
          case T: return edgePoint(edgeKey(x, y, true), x, y, x + 1, y);
          case R: return edgePoint(edgeKey(x + 1, y, false), x + 1, y, x + 1, y + 1);
          case B: return edgePoint(edgeKey(x, y + 1, true), x, y + 1, x + 1, y + 1);
          default: return edgePoint(edgeKey(x, y, false), x, y, x, y + 1);
        }
      };
      let segments = CASES[idx];
      if (idx === 5 || idx === 10) {
        const centre = (val(x, y) + val(x + 1, y) + val(x + 1, y + 1) + val(x, y + 1)) / 4 > level;
        // Inside corners connect through the centre when it is inside.
        segments = (idx === 5) === centre ? [T, L, B, R] : [T, R, L, B];
      }
      for (let s = 0; s < segments.length; s += 2) {
        link(edge(segments[s]), edge(segments[s + 1]));
      }
    }
  }

  const lines: Point2[][] = [];
  const visited = new Set<number>();
  for (const start of links.keys()) {
    if (visited.has(start)) {
      continue;
    }
    const line: Point2[] = [];
    let prev = -1;
    let cur = start;
    while (cur !== undefined && !visited.has(cur)) {
      visited.add(cur);
      line.push(points.get(cur)!);
      const next: number[] = links.get(cur)!;
      const step = next[0] !== prev ? next[0] : next[1];
      prev = cur;
      cur = step;
    }
    if (line.length > 2) {
      lines.push(line);
    }
  }
  return lines;
}
