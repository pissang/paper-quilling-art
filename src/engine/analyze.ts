/**
 * Turns a picture into what a quilling artist works from: a handful of paper
 * colors and clean regions of those colors, without the background.
 *
 * The image is smoothed, its colors clustered with k-means in Lab space, and
 * the label map cleaned with a majority filter. Specks too small to hold a
 * piece of paper merge into their neighbours. A background in one plain
 * color around the subject, or transparency, is left as bare board.
 */

import seedrandom from 'seedrandom';
import type { RGB } from '../config';

export interface Analysis {
  width: number;
  height: number;
  /** Palette index per pixel, -1 for background. Row 0 at the top. */
  labels: Int16Array;
  palette: RGB[];
  /** Pixels of each palette color. */
  counts: number[];
}

export interface AnalysisParams {
  colors: number;
  /** Long side of the working image in pixels. */
  resolution: number;
  /** Smallest region kept, in pixels. */
  minRegion: number;
  removeBackground: boolean;
}

// Color space -----------------------------------------------------------------

function srgbToLinear(c: number) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * lr + 0.3576 * lg + 0.1805 * lb) / 0.95047);
  const y = f(0.2126 * lr + 0.7152 * lg + 0.0722 * lb);
  const z = f((0.0193 * lr + 0.1192 * lg + 0.9505 * lb) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

// Steps -----------------------------------------------------------------------

/** Separable box blur on interleaved RGB, in place. */
function boxBlur(rgb: Float32Array, w: number, h: number, radius: number) {
  const tmp = new Float32Array(rgb.length);
  const pass = (src: Float32Array, dst: Float32Array, horizontal: boolean) => {
    const outer = horizontal ? h : w;
    const inner = horizontal ? w : h;
    for (let o = 0; o < outer; o++) {
      for (let i = 0; i < inner; i++) {
        let r = 0, g = 0, b = 0, n = 0;
        for (let k = -radius; k <= radius; k++) {
          const j = i + k;
          if (j < 0 || j >= inner) {
            continue;
          }
          const p = (horizontal ? o * w + j : j * w + o) * 3;
          r += src[p];
          g += src[p + 1];
          b += src[p + 2];
          n++;
        }
        const q = (horizontal ? o * w + i : i * w + o) * 3;
        dst[q] = r / n;
        dst[q + 1] = g / n;
        dst[q + 2] = b / n;
      }
    }
  };
  pass(rgb, tmp, true);
  pass(tmp, rgb, false);
}

function kmeans(lab: Float32Array, valid: Uint8Array, k: number, rand: () => number) {
  const indices: number[] = [];
  for (let i = 0; i < valid.length; i++) {
    if (valid[i]) {
      indices.push(i);
    }
  }
  // Cluster a subsample; assignment of every pixel happens afterwards.
  const sample = indices.length > 12000
    ? Array.from({ length: 12000 }, () => indices[Math.floor(rand() * indices.length)])
    : indices;
  const n = sample.length;
  k = Math.max(1, Math.min(k, n));
  const centres = new Float32Array(k * 3);
  // k-means++ seeding.
  const dist = new Float32Array(n).fill(Infinity);
  let pickIdx = sample[Math.floor(rand() * n)];
  for (let c = 0; c < k; c++) {
    centres.set(lab.subarray(pickIdx * 3, pickIdx * 3 + 3), c * 3);
    let total = 0;
    for (let i = 0; i < n; i++) {
      const p = sample[i] * 3;
      const d = (lab[p] - centres[c * 3]) ** 2 + (lab[p + 1] - centres[c * 3 + 1]) ** 2 + (lab[p + 2] - centres[c * 3 + 2]) ** 2;
      dist[i] = Math.min(dist[i], d);
      total += dist[i];
    }
    let r = rand() * total;
    for (let i = 0; i < n; i++) {
      r -= dist[i];
      if (r <= 0) {
        pickIdx = sample[i];
        break;
      }
    }
  }
  const assign = new Int32Array(n);
  for (let iter = 0; iter < 16; iter++) {
    const sums = new Float64Array(k * 4);
    for (let i = 0; i < n; i++) {
      const p = sample[i] * 3;
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = (lab[p] - centres[c * 3]) ** 2 + (lab[p + 1] - centres[c * 3 + 1]) ** 2 + (lab[p + 2] - centres[c * 3 + 2]) ** 2;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      assign[i] = best;
      sums[best * 4] += lab[p];
      sums[best * 4 + 1] += lab[p + 1];
      sums[best * 4 + 2] += lab[p + 2];
      sums[best * 4 + 3]++;
    }
    for (let c = 0; c < k; c++) {
      const m = sums[c * 4 + 3];
      if (m > 0) {
        centres[c * 3] = sums[c * 4] / m;
        centres[c * 3 + 1] = sums[c * 4 + 1] / m;
        centres[c * 3 + 2] = sums[c * 4 + 2] / m;
      }
    }
  }
  return { centres, k };
}

/** Majority of the 3×3 neighbourhood, which smooths ragged region edges. */
function majorityFilter(labels: Int16Array, w: number, h: number, k: number) {
  const out = new Int16Array(labels.length);
  const votes = new Int32Array(k + 1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      votes.fill(0);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          const yy = Math.min(h - 1, Math.max(0, y + dy));
          votes[labels[yy * w + xx] + 1]++;
        }
      }
      let best = labels[y * w + x];
      let bestVotes = votes[best + 1];
      for (let c = 0; c <= k; c++) {
        if (votes[c] > bestVotes) {
          bestVotes = votes[c];
          best = c - 1;
        }
      }
      out[y * w + x] = best;
    }
  }
  labels.set(out);
}

/** Connected components of equal labels (4-connected). */
function components(labels: Int16Array, w: number, h: number) {
  const comp = new Int32Array(labels.length).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  let count = 0;
  for (let start = 0; start < labels.length; start++) {
    if (comp[start] >= 0) {
      continue;
    }
    const label = labels[start];
    comp[start] = count;
    stack.push(start);
    let size = 0;
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % w;
      const y = (p - x) / w;
      const visit = (q: number) => {
        if (comp[q] < 0 && labels[q] === label) {
          comp[q] = count;
          stack.push(q);
        }
      };
      if (x > 0) visit(p - 1);
      if (x < w - 1) visit(p + 1);
      if (y > 0) visit(p - w);
      if (y < h - 1) visit(p + w);
    }
    sizes.push(size);
    count++;
  }
  return { comp, sizes };
}

/**
 * Merges specks into the most common neighbouring paper color: components
 * smaller than `minSize`, and slivers at most two pixels wide, which are the
 * halos left along edges between two colors.
 */
function removeSpecks(labels: Int16Array, w: number, h: number, minSize: number) {
  for (let pass = 0; pass < 3; pass++) {
    const { comp, sizes } = components(labels, w, h);
    // Pixels whose whole 3×3 neighbourhood shares their component.
    const interior = new Int32Array(sizes.length);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        const c = comp[p];
        if (comp[p - 1] === c && comp[p + 1] === c && comp[p - w] === c && comp[p + w] === c
          && comp[p - w - 1] === c && comp[p - w + 1] === c && comp[p + w - 1] === c && comp[p + w + 1] === c) {
          interior[c]++;
        }
      }
    }
    const isSpeck = (c: number) => sizes[c] < minSize || interior[c] < sizes[c] * 0.05;
    let changed = false;
    const neighbours = new Map<number, Map<number, number>>();
    for (let p = 0; p < labels.length; p++) {
      const c = comp[p];
      if (!isSpeck(c)) {
        continue;
      }
      const x = p % w;
      const y = (p - x) / w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && comp[q] !== c) {
          let votes = neighbours.get(c);
          if (!votes) {
            neighbours.set(c, votes = new Map());
          }
          votes.set(labels[q], (votes.get(labels[q]) ?? 0) + 1);
        }
      }
    }
    const target = new Map<number, number>();
    for (const [c, votes] of neighbours) {
      let best = -2;
      let bestVotes = -1;
      for (const [label, v] of votes) {
        // Paper wins over background, so halos join the shape they outline.
        const weight = label < 0 ? v * 0.25 : v;
        if (weight > bestVotes) {
          bestVotes = weight;
          best = label;
        }
      }
      target.set(c, best);
    }
    for (let p = 0; p < labels.length; p++) {
      const t = target.get(comp[p]);
      if (t !== undefined && t !== labels[p]) {
        labels[p] = t;
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }
}

/** Lab distance below which a pixel matches the background color. */
const BACKGROUND_DELTA = 7;
/** Lab change across two pixels above which a pixel is an edge. */
const CORE_GRADIENT = 10;

/**
 * If most of the border shares one plain color, every pixel of that color is
 * background, including pockets of it enclosed by the subject. Done before
 * clustering, so similar but distinct subject colors keep their own paper.
 */
function clearBackground(lab: Float32Array, valid: Uint8Array, w: number, h: number): number[] | null {
  const border: number[] = [];
  for (let x = 0; x < w; x++) {
    border.push(x, (h - 1) * w + x);
  }
  for (let y = 1; y < h - 1; y++) {
    border.push(y * w, y * w + w - 1);
  }
  const opaque = border.filter(p => valid[p]);
  if (opaque.length < border.length * 0.4) {
    return null;
  }
  // Per channel median of the border is robust to the subject touching it.
  const median = [0, 1, 2].map(ch => {
    const values = opaque.map(p => lab[p * 3 + ch]).sort((a, b) => a - b);
    return values[values.length >> 1];
  });
  const near = (p: number) => Math.hypot(lab[p * 3] - median[0], lab[p * 3 + 1] - median[1], lab[p * 3 + 2] - median[2]) < BACKGROUND_DELTA;
  if (opaque.filter(near).length < border.length * 0.4) {
    return null;
  }
  for (let p = 0; p < valid.length; p++) {
    if (valid[p] && near(p)) {
      valid[p] = 0;
    }
  }
  return median;
}

/**
 * Pixels away from edges. Edge pixels mix the colors on both sides, and
 * clustering them would add paper colors that are only halos.
 */
function corePixels(lab: Float32Array, valid: Uint8Array, w: number, h: number) {
  const core = new Uint8Array(valid.length);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (!valid[p]) {
        continue;
      }
      let g = 0;
      for (let ch = 0; ch < 3; ch++) {
        const dx = lab[(p + 1) * 3 + ch] - lab[(p - 1) * 3 + ch];
        const dy = lab[(p + w) * 3 + ch] - lab[(p - w) * 3 + ch];
        g += dx * dx + dy * dy;
      }
      core[p] = g < CORE_GRADIENT * CORE_GRADIENT ? 1 : 0;
    }
  }
  return core;
}

export function analyzeImage(image: CanvasImageSource & { width: number; height: number }, params: AnalysisParams): Analysis {
  const aspect = image.width / image.height;
  const w = Math.max(8, Math.round(aspect >= 1 ? params.resolution : params.resolution * aspect));
  const h = Math.max(8, Math.round(aspect >= 1 ? params.resolution / aspect : params.resolution));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, w, h);
  const pixels = ctx.getImageData(0, 0, w, h).data;

  const n = w * h;
  const rgb = new Float32Array(n * 3);
  const valid = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    rgb[i * 3] = pixels[i * 4];
    rgb[i * 3 + 1] = pixels[i * 4 + 1];
    rgb[i * 3 + 2] = pixels[i * 4 + 2];
    valid[i] = pixels[i * 4 + 3] >= 128 ? 1 : 0;
  }
  // Paper colors are flat; blur away texture and noise before clustering.
  boxBlur(rgb, w, h, Math.max(1, Math.round(params.resolution / 160)));

  const lab = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    lab.set(rgbToLab(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]), i * 3);
  }
  const background = params.removeBackground ? clearBackground(lab, valid, w, h) : null;
  const rand = seedrandom('palette');
  let core = corePixels(lab, valid, w, h);
  if (core.reduce((a, b) => a + b, 0) < 64) {
    core = valid;
  }
  const { centres, k } = kmeans(lab, core, params.colors, rand);

  const labels = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    if (!valid[i]) {
      labels[i] = -1;
      continue;
    }
    let best = 0;
    let bestD = Infinity;
    for (let c = 0; c < k; c++) {
      const d = (lab[i * 3] - centres[c * 3]) ** 2 + (lab[i * 3 + 1] - centres[c * 3 + 1]) ** 2
        + (lab[i * 3 + 2] - centres[c * 3 + 2]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    // Halo pixels closer to the background than to any paper go with it.
    if (background) {
      const d = (lab[i * 3] - background[0]) ** 2 + (lab[i * 3 + 1] - background[1]) ** 2 + (lab[i * 3 + 2] - background[2]) ** 2;
      if (d < bestD) {
        best = -1;
      }
    }
    labels[i] = best;
  }
  majorityFilter(labels, w, h, k);
  majorityFilter(labels, w, h, k);
  removeSpecks(labels, w, h, params.minRegion);

  // Palette from the mean original color of each final region.
  const sums = new Float64Array(k * 3);
  const counts = new Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    const c = labels[i];
    if (c >= 0) {
      sums[c * 3] += rgb[i * 3];
      sums[c * 3 + 1] += rgb[i * 3 + 1];
      sums[c * 3 + 2] += rgb[i * 3 + 2];
      counts[c]++;
    }
  }
  // Drop colors that lost all their pixels, darkest first for a stable order.
  const used = counts.map((m, c) => (m > 0 ? c : -1)).filter(c => c >= 0);
  const lum = (c: number) => (0.2126 * sums[c * 3] + 0.7152 * sums[c * 3 + 1] + 0.0722 * sums[c * 3 + 2]) / counts[c];
  used.sort((a, b) => lum(a) - lum(b));
  const remap = new Int16Array(k).fill(-1);
  used.forEach((c, i) => {
    remap[c] = i;
  });
  for (let i = 0; i < n; i++) {
    if (labels[i] >= 0) {
      labels[i] = remap[labels[i]];
    }
  }
  const palette: RGB[] = used.map(c => [
    Math.round(sums[c * 3] / counts[c]),
    Math.round(sums[c * 3 + 1] / counts[c]),
    Math.round(sums[c * 3 + 2] / counts[c])
  ]);
  return { width: w, height: h, labels, palette, counts: used.map(c => counts[c]) };
}
