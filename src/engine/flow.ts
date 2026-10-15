/**
 * Fills a region with evenly spaced, flowing strips, the way quillers lay
 * paper across a face or a sweep of hair: open strips following one smooth
 * direction, each starting and stopping where it meets the edge or its
 * neighbours, rather than closed rings echoing the outline.
 *
 * Evenly spaced streamlines after Jobard and Lefer (1997): each new strip is
 * seeded one spacing away from an existing one and grown in both directions
 * until it leaves the region or comes closer than half a spacing to another.
 */

import type { Point2 } from './stripGeometry';

export interface FlowParams {
  /** Room left before the region edge; negative outside. */
  clearance(x: number, y: number): number;
  /** Unit direction of the flow, or null where it is undefined. Sign does not matter. */
  direction(x: number, y: number): Point2 | null;
  /** Where to start: the first is used first, the rest fill areas no strip reached. */
  seeds: Point2[];
  spacing: number;
  /** Strips shorter than this are dropped. */
  minLength: number;
}

/** Strips stop this close to another strip, relative to the spacing. */
const STOP = 0.55;
/** Integration step relative to the spacing. */
const STEP = 0.3;
/** Longest strip, in steps; also guards against closed orbits. */
const MAX_STEPS = 4000;

class PointGrid {
  private cells = new Map<number, { x: number; y: number; line: number; index: number }[]>();
  constructor(private cell: number) {}

  private key(i: number, j: number) {
    return (i + 32768) * 65536 + (j + 32768);
  }

  private touched = new Map<number, Set<number>>();

  add(x: number, y: number, line: number, index: number) {
    const k = this.key(Math.floor(x / this.cell), Math.floor(y / this.cell));
    let list = this.cells.get(k);
    if (!list) {
      this.cells.set(k, list = []);
    }
    list.push({ x, y, line, index });
    let keys = this.touched.get(line);
    if (!keys) {
      this.touched.set(line, keys = new Set());
    }
    keys.add(k);
  }

  /** Drops every point of a line. */
  remove(line: number) {
    for (const k of this.touched.get(line) ?? []) {
      const list = this.cells.get(k);
      if (list) {
        this.cells.set(k, list.filter(p => p.line !== line));
      }
    }
    this.touched.delete(line);
  }

  /** Whether a point of another line, or of `line` itself more than `skip` points back, is within `r`. */
  near(x: number, y: number, r: number, line = -1, index = 0, skip = 0) {
    const i0 = Math.floor((x - r) / this.cell);
    const i1 = Math.floor((x + r) / this.cell);
    const j0 = Math.floor((y - r) / this.cell);
    const j1 = Math.floor((y + r) / this.cell);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const list = this.cells.get(this.key(i, j));
        if (!list) {
          continue;
        }
        for (const p of list) {
          if (p.line === line && Math.abs(p.index - index) <= skip) {
            continue;
          }
          if ((p.x - x) ** 2 + (p.y - y) ** 2 < r * r) {
            return true;
          }
        }
      }
    }
    return false;
  }
}

export function flowLines(p: FlowParams): Point2[][] {
  const { spacing } = p;
  const step = spacing * STEP;
  const stop = spacing * STOP;
  const grid = new PointGrid(spacing);
  const lines: Point2[][] = [];
  const queue: Point2[] = [...p.seeds];
  // Points of the strip being grown are compared with the strip itself only far back.
  const selfSkip = Math.ceil((spacing * 3) / step);

  /** Direction at a point, flipped to agree with the previous heading. */
  const heading = (x: number, y: number, prev: Point2): Point2 | null => {
    const d = p.direction(x, y);
    if (!d) {
      return null;
    }
    return d[0] * prev[0] + d[1] * prev[1] < 0 ? [-d[0], -d[1]] : d;
  };

  /**
   * Grows from a seed along `dir`, returning the points after the seed. Points
   * go into the grid as they are made, so a strip cannot run into itself.
   */
  const grow = (seed: Point2, dir: Point2, line: number, sign: number): Point2[] => {
    const out: Point2[] = [];
    let [x, y] = seed;
    let prev = dir;
    for (let k = 0; k < MAX_STEPS; k++) {
      // Midpoint integration keeps curves from drifting outwards.
      const d0 = heading(x, y, prev);
      if (!d0) {
        break;
      }
      const d1 = heading(x + d0[0] * step / 2, y + d0[1] * step / 2, d0);
      if (!d1) {
        break;
      }
      const nx = x + d1[0] * step;
      const ny = y + d1[1] * step;
      if (p.clearance(nx, ny) < 0) {
        break;
      }
      const index = sign * (k + 1);
      if (grid.near(nx, ny, stop, line, index, selfSkip)) {
        break;
      }
      x = nx;
      y = ny;
      prev = d1;
      out.push([x, y]);
      grid.add(x, y, line, index);
    }
    return out;
  };

  while (queue.length) {
    const seed = queue.shift()!;
    if (p.clearance(seed[0], seed[1]) < 0 || grid.near(seed[0], seed[1], spacing * 0.9)) {
      continue;
    }
    const d = p.direction(seed[0], seed[1]);
    if (!d) {
      continue;
    }
    const id = lines.length;
    grid.add(seed[0], seed[1], id, 0);
    // Grow forwards and backwards; the halves are indexed outwards from the seed.
    const forward = grow(seed, d, id, 1);
    const backward = grow(seed, [-d[0], -d[1]], id, -1);
    const line = [...backward.reverse(), seed, ...forward];
    let length = 0;
    for (let i = 1; i < line.length; i++) {
      length += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    }
    if (length < p.minLength) {
      grid.remove(id);
      continue;
    }
    lines.push(line);
    // New seeds one spacing to either side, along the whole strip.
    const every = Math.max(1, Math.round(spacing / step));
    for (let i = 0; i < line.length; i += every) {
      const a = line[Math.max(0, i - 1)];
      const b = line[Math.min(line.length - 1, i + 1)];
      const tx = b[0] - a[0];
      const ty = b[1] - a[1];
      const tl = Math.hypot(tx, ty) || 1;
      const nx = -ty / tl;
      const ny = tx / tl;
      // Seeds join the front, so the fill spreads out from the first strip.
      queue.unshift(
        [line[i][0] + nx * spacing, line[i][1] + ny * spacing],
        [line[i][0] - nx * spacing, line[i][1] - ny * spacing]
      );
    }
  }
  return lines;
}
