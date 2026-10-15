/**
 * Fills regions with quilled pieces: flowers, leaves, coils and scrolls packed
 * edge to edge, largest first, with smaller pieces filling the gaps.
 *
 * Elements reuse a small set of prototype meshes shared by all regions. Sizes
 * snap to a geometric series, so thousands of elements share a few dozen
 * meshes and are rendered as instances.
 */

import seedrandom from 'seedrandom';
import { footprint, shapeCentreLine, type ShapeType } from './shapes';
import { buildStrip, type Point2, type StripMesh } from './stripGeometry';

export interface CompositionParams {
  seed: number;
  /** Half length of the largest elements. */
  size: number;
  /** Half length of the smallest elements. */
  minSize: number;
  /** Gap between neighbouring elements. */
  gap: number;
  /** Share of the largest spots that become flowers. */
  flowers: number;
  /** Turns of a loose coil, whatever its size. */
  turns: number;
  /** How far a coil's eye drifts off centre, 0 to 1. */
  eccentricity: number;
  /** How strongly pinching drags the turns towards the tips. */
  tipPull: number;
  /** Random height play of single pieces around their region's level. */
  heightJitter: number;
  thickness: number;
  imperfection: number;
}

export interface Element {
  prototype: number;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  /** Relative height offset, roughly in [-1, 2], scaled by the height variation. */
  height: number;
  /** Palette index. */
  color: number;
}

export interface Region {
  /** Area inside the region. */
  area: number;
  /** Typical half width of the region; pieces are kept to about this size. */
  span: number;
  /** Distance to the region edge, negative outside. */
  clearance(x: number, y: number): number;
  /** Preferred piece direction, e.g. along the region's contours. */
  direction?(x: number, y: number): number;
  /** Uniform random point inside the region. */
  sample(rand: () => number): Point2;
}

/** Ratio between consecutive element sizes. */
const SIZE_STEP = 0.76;
/** Pieces that do not fit are retried this much smaller, between two sizes. */
const SHRINK = [1, 0.9, 0.8];
/** Placed pieces swell up to this much to close gaps, as pieces are squeezed together. */
const GROW = [1.1, 1.2, 1.3];

type Disk = [number, number, number];

class DiskGrid {
  private cells = new Map<number, Disk[]>();
  constructor(private cell: number) {}

  private range(d: Disk) {
    const c = this.cell;
    return [
      Math.floor((d[0] - d[2]) / c), Math.floor((d[0] + d[2]) / c),
      Math.floor((d[1] - d[2]) / c), Math.floor((d[1] + d[2]) / c)
    ];
  }

  private key(i: number, j: number) {
    return (i + 32768) * 65536 + (j + 32768);
  }

  hits(d: Disk) {
    const [i0, i1, j0, j1] = this.range(d);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const list = this.cells.get(this.key(i, j));
        if (!list) {
          continue;
        }
        for (const o of list) {
          const dx = o[0] - d[0];
          const dy = o[1] - d[1];
          const rr = o[2] + d[2];
          if (dx * dx + dy * dy < rr * rr) {
            return true;
          }
        }
      }
    }
    return false;
  }

  add(d: Disk) {
    const [i0, i1, j0, j1] = this.range(d);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = this.key(i, j);
        let list = this.cells.get(k);
        if (!list) {
          this.cells.set(k, list = []);
        }
        list.push(d);
      }
    }
  }
}

/** Smooth scalar field from a few random plane waves, roughly in [-1, 1]. */
function waveField(rand: () => number, wavelength: number, count = 4) {
  const waves = Array.from({ length: count }, () => {
    const a = rand() * Math.PI * 2;
    const k = (Math.PI * 2) / (wavelength * (0.6 + rand() * 0.8));
    return { kx: Math.cos(a) * k, ky: Math.sin(a) * k, phase: rand() * Math.PI * 2 };
  });
  const norm = 1 / Math.sqrt(count / 2);
  return (x: number, y: number) => {
    let v = 0;
    for (const w of waves) {
      v += Math.sin(x * w.kx + y * w.ky + w.phase);
    }
    return v * norm;
  };
}

function pick<T>(rand: () => number, weighted: [T, number][]): T {
  let total = 0;
  for (const [, w] of weighted) {
    total += w;
  }
  let r = rand() * total;
  for (const [item, w] of weighted) {
    r -= w;
    if (r <= 0) {
      return item;
    }
  }
  return weighted[weighted.length - 1][0];
}

interface Prototype {
  /** Index into the meshes, or -1 until the first piece is placed. */
  index: number;
  line: Point2[];
  disks: Disk[];
}

export interface FillOptions {
  /** Restricts the shapes, without flowers. */
  kinds?: [ShapeType, number][];
  /** Gap between pieces, instead of the composition's. */
  gap?: number;
  /** Smallest piece relative to the largest, for sparse decoration. */
  minRatio?: number;
  /** Height level of the region's pieces, in [-1, 1]. */
  height?: number;
  /** Areas already taken, e.g. by swirls, as [x, y, radius]. */
  reserved?: [number, number, number][];
  /** Color for each single piece, instead of the region's. */
  pickColor?: () => number;
}

export interface Composer {
  prototypes: StripMesh[];
  elements: Element[];
  /** Packs pieces of `color` into the region; flower centres take `accent`. */
  fill(region: Region, color: number, accent: number, options?: FillOptions): void;
  /** Places a single tight coil, e.g. at the heart of a swirl. */
  addTightCoil(x: number, y: number, radius: number, color: number, height: number): void;
}

export function createComposer(params: CompositionParams): Composer {
  const rand = seedrandom(params.seed + '-compose');
  const meshRand = seedrandom(params.seed + '-paper');
  const size = Math.max(params.size, params.minSize);
  // Prototype sizes are levels of one series, so all regions share them.
  const levelOf = (r: number) => Math.max(0, Math.round(Math.log(r / size) / Math.log(SIZE_STEP)));
  const levelSize = (level: number) => size * SIZE_STEP ** level;

  const prototypes: StripMesh[] = [];
  const elements: Element[] = [];
  const protoCache = new Map<string, Prototype>();
  const getPrototype = (type: ShapeType, level: number, aspect: number, bend: number) => {
    const key = `${type}|${level}|${aspect}|${bend}`;
    let proto = protoCache.get(key);
    if (!proto) {
      const r = levelSize(level);
      const line = shapeCentreLine({
        type, r, aspect, bend,
        // Pieces are rolled from strips long enough for about the same number of turns.
        spacing: (type === 'teardrop' || type === 'marquise' ? r * aspect : r) / params.turns,
        eccentricity: params.eccentricity,
        tipPull: params.tipPull,
        thickness: params.thickness,
        rand: meshRand
      });
      proto = { index: -1, line, disks: footprint(line) };
      protoCache.set(key, proto);
    }
    return proto;
  };
  /** Meshes are only built for prototypes that end up placed. */
  const meshIndex = (proto: Prototype) => {
    if (proto.index < 0) {
      const mesh = buildStrip(proto.line, {
        thickness: params.thickness,
        imperfection: params.imperfection,
        rand: meshRand
      });
      if (!mesh) {
        return -1;
      }
      proto.index = prototypes.length;
      prototypes.push(mesh);
    }
    return proto.index;
  };

  const flow = waveField(rand, 9);
  const flowDetail = waveField(rand, 3);

  const chooseType = (relative: number): ShapeType => {
    if (relative > 0.55) {
      return pick<ShapeType>(rand, [['teardrop', 0.38], ['marquise', 0.36], ['coil', 0.1], ['cscroll', 0.08], ['sscroll', 0.08]]);
    }
    if (relative > 0.3) {
      return pick<ShapeType>(rand, [['coil', 0.34], ['teardrop', 0.3], ['marquise', 0.24], ['cscroll', 0.06], ['sscroll', 0.06]]);
    }
    return pick<ShapeType>(rand, [['coil', 0.5], ['tight', 0.3], ['teardrop', 0.2]]);
  };

  const fill = (region: Region, color: number, accent: number, options: FillOptions = {}) => {
    if (region.area <= 0) {
      return;
    }
    const { kinds } = options;
    const level = options.height ?? 0;
    // Pieces of one region stand at about one height, with some play.
    const pieceHeight = () => level * 0.7 + (rand() * 2 - 1) * params.heightJitter;
    const gap = options.gap ?? params.gap;
    // Long pieces lie along narrow areas, so they may be about twice the half width.
    const fit = Math.max(region.span * 2, 0.06);
    const top = Math.min(size, fit);
    const minSize = options.minRatio ? top * options.minRatio : Math.min(params.minSize, top * 0.25);
    const levels: number[] = [];
    for (let level = levelOf(top); levelSize(level) >= minSize * 0.999; level++) {
      levels.push(level);
    }
    const grid = new DiskGrid(Math.max(minSize, 0.1) * 2);
    for (const disk of options.reserved ?? []) {
      grid.add(disk);
    }
    const angleAt = (x: number, y: number) => region.direction
      ? region.direction(x, y)
      : flow(x, y) * Math.PI + flowDetail(x, y) * 0.5;

    /** Transformed footprint padded by half the gap; null if it leaves the region. */
    const place = (proto: Prototype, x: number, y: number, rotation: number, scale: number) => {
      const c = Math.cos(rotation);
      const s = Math.sin(rotation);
      const disks: Disk[] = [];
      for (const [dx, dy, dr] of proto.disks) {
        const px = x + (dx * c - dy * s) * scale;
        const py = y + (dx * s + dy * c) * scale;
        const pr = dr * scale + gap / 2;
        if (region.clearance(px, py) < pr || grid.hits([px, py, pr])) {
          return null;
        }
        disks.push([px, py, pr]);
      }
      return disks;
    };

    const add = (proto: Prototype, x: number, y: number, rotation: number, scale: number, height: number, c: number) => {
      const prototype = meshIndex(proto);
      if (prototype >= 0) {
        elements.push({ prototype, x, y, rotation, scale, height, color: c });
      }
    };

    const tryFlower = (x: number, y: number, r: number) => {
      const R = r * 1.3;
      const disk: Disk = [x, y, R + gap / 2];
      if (region.clearance(x, y) < disk[2] || grid.hits(disk)) {
        return;
      }
      const rc = R * (0.2 + rand() * 0.08);
      const centreLevel = levelOf(rc);
      const centre = getPrototype('tight', centreLevel, 1, 0);
      const half = (R - rc - gap) / 2;
      const dist = rc + gap / 2 + half;
      const petalType: ShapeType = rand() < 0.75 ? 'teardrop' : 'marquise';
      // Width of one petal relative to its length, for n petals around the centre.
      const fitFor = (count: number) => (Math.tan(Math.PI / count) * dist * 0.92) / half;
      let n = 8 + Math.floor(rand() * 5);
      while (n > 5 && fitFor(n) < 0.35) {
        n--;
      }
      const spread = fitFor(n);
      // Few aspect steps keep the number of petal meshes down.
      // Round down so petals never grow into their neighbours.
      const aspect = Math.max(Math.floor(Math.min(spread, 0.75) / 0.1) * 0.1, 0.3);
      const petalLevel = levelOf(half);
      const petal = getPrototype(petalType, petalLevel, aspect, 0);
      // Flowers stand proud of their surroundings, their centres highest.
      const height = pieceHeight() + 0.5;
      const start = rand() * Math.PI * 2;
      const petalScale = half / levelSize(petalLevel);
      for (let i = 0; i < n; i++) {
        const a = start + (i / n) * Math.PI * 2;
        // Teardrop petals are pinched at the centre.
        const rotation = petalType === 'teardrop' ? a + Math.PI : a;
        add(petal, x + Math.cos(a) * dist, y + Math.sin(a) * dist, rotation, petalScale, height, color);
      }
      add(centre, x, y, rand() * Math.PI * 2, rc / levelSize(centreLevel), height + 0.5, accent);
      grid.add(disk);
    };

    levels.forEach((level, i) => {
      const r = levelSize(level);
      const attempts = Math.min(60000, Math.max(300, Math.round((region.area / (Math.PI * r * r)) * 30)));
      const flowers = !kinds && i < 2 && r > size * 0.5 ? params.flowers : 0;
      for (let k = 0; k < attempts; k++) {
        const [x, y] = region.sample(rand);
        if (rand() < flowers) {
          tryFlower(x, y, r);
          continue;
        }
        const type = kinds ? pick(rand, kinds) : chooseType(r / size);
        const aspect = type === 'teardrop' ? (rand() < 0.5 ? 0.55 : 0.7)
          : type === 'marquise' ? (rand() < 0.5 ? 0.38 : 0.5)
            : 1;
        // Turning a marquise half way flips its bend, so one direction is enough.
        const bend = type === 'marquise' && rand() < 0.5 ? 0.3 : 0;
        const proto = getPrototype(type, level, aspect, bend);
        // Follow the flow, then try a few turns before giving up on the spot.
        const base = angleAt(x, y) + (rand() - 0.5) * 0.4;
        const jitter = 1 + (rand() - 0.5) * 0.06;
        placing: for (const shrink of SHRINK) {
          const scale = jitter * shrink;
          for (const turn of [0, Math.PI, 0.6, -0.6]) {
            const rotation = base + turn;
            let disks = place(proto, x, y, rotation, scale);
            if (disks) {
              let fitted = scale;
              for (const grow of GROW) {
                const bigger = place(proto, x, y, rotation, scale * grow);
                if (!bigger) {
                  break;
                }
                disks = bigger;
                fitted = scale * grow;
              }
              disks.forEach(d => grid.add(d));
              add(proto, x, y, rotation, fitted, pieceHeight(), options.pickColor ? options.pickColor() : color);
              break placing;
            }
          }
        }
      }
    });
  };

  const addTightCoil = (x: number, y: number, radius: number, color: number, height: number) => {
    const level = levelOf(radius);
    const prototype = meshIndex(getPrototype('tight', level, 1, 0));
    if (prototype >= 0) {
      elements.push({ prototype, x, y, rotation: rand() * Math.PI * 2, scale: radius / levelSize(level), height, color });
    }
  };

  return { prototypes, elements, fill, addTightCoil };
}
