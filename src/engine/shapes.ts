/**
 * Centre lines of classic quilled elements, in a local frame where the element
 * spans x ∈ [-r, r] and points (if it has a point) towards +x.
 *
 * Closed shapes start as a loose coil: a strip rolled around the quilling tool
 * and released, so the turns relax and the centre drifts off-centre. Pinching
 * the coil turns the outer layer into a teardrop or marquise while the inner
 * turns stay rounder, and the layers bunch up towards the pinched tips. The
 * strip end is glued down, which wraps the outer layer twice.
 */

import type { Point2 } from './stripGeometry';

export type ShapeType = 'coil' | 'tight' | 'teardrop' | 'marquise' | 'cscroll' | 'sscroll';

export interface ShapeParams {
  type: ShapeType;
  /** Half length along x. */
  r: number;
  /** Half width over half length for pinched shapes. */
  aspect: number;
  /** Bend of a marquise into a crescent, as a fraction of r. */
  bend: number;
  /** Distance between turns of a loose coil. */
  spacing: number;
  /** How far the coil's eye drifts off centre, 0 to 1. */
  eccentricity: number;
  /** How strongly pinching drags the turns towards the tips. */
  tipPull: number;
  thickness: number;
  rand: () => number;
}

const TAU = Math.PI * 2;
const SAMPLES_PER_TURN = 72;
/** Hole left by the quilling tool. */
const CORE = 0.025;

/** Max of sin(t)·sin(t/2), so teardrops can be normalised to their aspect. */
const TEARDROP_WIDTH = 0.7698;

/** Outer outline at parameter t (radians), with the point of the shape at t = 0. */
function outline(type: ShapeType, aspect: number, t: number): Point2 {
  const c = Math.cos(t);
  const s = Math.sin(t);
  switch (type) {
    case 'teardrop':
      return [c, (aspect * s * Math.sin(t / 2)) / TEARDROP_WIDTH];
    case 'marquise':
      return [c, aspect * s * Math.abs(s)];
    default:
      return [c, s];
  }
}

/** Weight of the pinched tip(s) at parameter t. */
function tipWeight(type: ShapeType, t: number) {
  const near = (a: number) => {
    const d = Math.atan2(Math.sin(t - a), Math.cos(t - a));
    return Math.exp(-(d * d) / 0.35);
  };
  if (type === 'teardrop') {
    return near(0);
  }
  if (type === 'marquise') {
    return Math.max(near(0), near(Math.PI));
  }
  return 0;
}

function pinchedCoil(p: ShapeParams): Point2[] {
  const { type, r, aspect, rand, thickness } = p;
  const tight = type === 'tight';
  // A tight coil reads as a solid disk; ten turns are plenty to show the spiral.
  const spacing = tight ? Math.max(thickness * 1.3, r / 10) : p.spacing;
  // Narrow shapes fit fewer turns across their width.
  const halfWidth = type === 'teardrop' || type === 'marquise' ? r * aspect : r;
  const core = tight ? thickness * 1.5 : CORE;
  const turns = Math.max(1.5, (halfWidth - core) / spacing);

  // The relaxed coil's eye drifts off centre; a teardrop's sits in its round end.
  let ex = 0;
  let ey = 0;
  if (!tight) {
    const drift = p.eccentricity;
    if (type === 'teardrop') {
      ex = -r * (0.18 + rand() * 0.15) * drift;
      ey = (rand() * 2 - 1) * halfWidth * 0.15 * drift;
    }
    else if (type === 'marquise') {
      ex = (rand() * 2 - 1) * r * 0.2 * drift;
    }
    else {
      const a = rand() * TAU;
      const d = halfWidth * (0.2 + rand() * 0.25) * drift;
      ex = Math.cos(a) * d;
      ey = Math.sin(a) * d;
    }
  }

  // Every turn lies on the same rays from the eye to the outline, further out
  // than the turn before, so turns can never cross. The shapes are convex and
  // the eye is inside, so the rays sweep the outline once per turn.
  const ray = (t: number) => {
    const [ox, oy] = outline(type, aspect, t);
    const dx = ox * r - ex;
    const dy = oy * r - ey;
    const len = Math.hypot(dx, dy);
    return { dx: dx / len, dy: dy / len, len };
  };
  let shortest = Infinity;
  for (let i = 0; i < 64; i++) {
    shortest = Math.min(shortest, ray((i / 64) * TAU).len);
  }
  const phase = rand() * TAU;
  const total = turns * TAU;
  const steps = Math.ceil(turns * SAMPLES_PER_TURN);
  const points: Point2[] = [];

  /** Point at outline parameter t, `u` of the way out, plus `extra` beyond the outline. */
  const point = (t: number, u: number, extra = 0): Point2 => {
    const { dx, dy, len } = ray(t);
    // Inner turns are round; they take on the outline's shape on the way out.
    const reach = shortest + (len - shortest) * u;
    // A released coil keeps a tight eye and opens up towards the outside.
    let frac = core / reach + (1 - core / reach) * Math.pow(u, tight ? 1 : 1.35);
    // Pinching drags the turns towards the tips.
    frac = Math.pow(frac, 1 / (1 + p.tipPull * tipWeight(type, t)));
    const dist = frac * reach + extra;
    return [ex + dx * dist, ey + dy * dist];
  };

  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    points.push(point(u * total + phase, u));
  }
  // The glued end wraps the outside once more, a strip thickness out.
  if (!tight) {
    const wrapSteps = Math.ceil(SAMPLES_PER_TURN * 0.85);
    for (let i = 1; i <= wrapSteps; i++) {
      const k = i / wrapSteps;
      points.push(point(total + phase + k * TAU * 0.85, 1, thickness * 1.4 * Math.min(1, k * 4)));
    }
  }
  return points;
}

/** Spiral around `c` from radius r0 to r1, angle a0 to a1. */
function spiral(c: Point2, r0: number, r1: number, a0: number, a1: number, steps: number): Point2[] {
  const points: Point2[] = [];
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    const a = a0 + (a1 - a0) * k;
    const rr = r0 + (r1 - r0) * Math.pow(k, 0.9);
    points.push([c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr]);
  }
  return points;
}

/** Hermite segment joining two points with the given unit tangents. */
function hermite(p0: Point2, t0: Point2, p1: Point2, t1: Point2, steps: number): Point2[] {
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const points: Point2[] = [];
  for (let i = 1; i < steps; i++) {
    const s = i / steps;
    const h00 = 2 * s ** 3 - 3 * s ** 2 + 1;
    const h10 = s ** 3 - 2 * s ** 2 + s;
    const h01 = -2 * s ** 3 + 3 * s ** 2;
    const h11 = s ** 3 - s ** 2;
    points.push([
      h00 * p0[0] + h10 * t0[0] * len + h01 * p1[0] + h11 * t1[0] * len,
      h00 * p0[1] + h10 * t0[1] * len + h01 * p1[1] + h11 * t1[1] * len
    ]);
  }
  return points;
}

/** Open scrolls: both strip ends rolled in, the same way (C) or opposite ways (S). */
function scroll(p: ShapeParams): Point2[] {
  const { r, rand, spacing } = p;
  const rs = r * (0.38 + rand() * 0.08);
  const turns = Math.max(1.2, Math.min(2.5, rs / (spacing * 1.6)));
  const steps = Math.ceil(turns * SAMPLES_PER_TURN);
  const a: Point2 = [-r + rs, 0];
  const b: Point2 = [r - rs, 0];
  const top = Math.PI / 2;
  // Left spiral unwinds clockwise and leaves its top heading +x.
  const left = spiral(a, CORE, rs, top + turns * TAU, top, steps);
  let right: Point2[];
  let entry: Point2;
  let entryTangent: Point2;
  if (p.type === 'cscroll') {
    right = spiral(b, rs, CORE, top, top - turns * TAU, steps);
    entry = right[0];
    entryTangent = [1, 0];
  }
  else {
    right = spiral(b, rs, CORE, -top, -top + turns * TAU, steps);
    entry = right[0];
    entryTangent = [1, 0];
  }
  const exit = left[left.length - 1];
  const bridge = hermite(exit, [1, 0], entry, entryTangent, 24);
  return [...left, ...bridge, ...right];
}

export function shapeCentreLine(p: ShapeParams): Point2[] {
  const points = p.type === 'cscroll' || p.type === 'sscroll' ? scroll(p) : pinchedCoil(p);
  if (p.bend && p.type === 'marquise') {
    // Curve the leaf into a crescent.
    for (const pt of points) {
      const x = pt[0] / p.r;
      pt[1] += p.bend * p.r * (1 - x * x);
    }
  }
  return points;
}

/** Disks along x covering a centre line, for packing. */
export function footprint(points: Point2[], slices = 10): [number, number, number][] {
  let minX = Infinity;
  let maxX = -Infinity;
  for (const [x] of points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
  }
  const width = (maxX - minX) / slices || 1e-3;
  const lo = new Array(slices).fill(Infinity);
  const hi = new Array(slices).fill(-Infinity);
  for (const [x, y] of points) {
    const i = Math.min(slices - 1, Math.floor((x - minX) / width));
    lo[i] = Math.min(lo[i], y);
    hi[i] = Math.max(hi[i], y);
  }
  const disks: [number, number, number][] = [];
  for (let i = 0; i < slices; i++) {
    if (lo[i] > hi[i]) {
      continue;
    }
    const cx = minX + (i + 0.5) * width;
    const cy = (lo[i] + hi[i]) / 2;
    disks.push([cx, cy, Math.hypot((hi[i] - lo[i]) / 2, width / 2)]);
  }
  return disks;
}
