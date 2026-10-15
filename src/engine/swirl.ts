/**
 * Swirls of several strips laid side by side and rolled together into one
 * open spiral, the signature of contemporary quilling. Neighbouring strips
 * take neighbouring shades, so a swirl reads as a gradient of paper.
 */

import type { Point2 } from './stripGeometry';

export interface SwirlParams {
  x: number;
  y: number;
  /** Outer radius. */
  radius: number;
  /** Strips in the bundle. */
  strips: number;
  /** Distance between neighbouring strips. */
  spacing: number;
  /** 1 counter-clockwise, -1 clockwise. */
  direction: number;
  /** Angle of the outer end. */
  angle: number;
}

const SAMPLES_PER_TURN = 96;
/** Most turns a swirl makes; real ones stay open. */
const MAX_TURNS = 2.6;

/**
 * Centre lines of the bundle, innermost first. All strips follow one
 * Archimedean spiral, each shifted outwards by its place in the bundle, so
 * they stay parallel and never cross; the gap between turns leaves room for
 * the whole bundle.
 */
export function swirlLines(p: SwirlParams): Point2[][] {
  const bundle = (p.strips - 1) * p.spacing;
  const inner = Math.max(p.radius * 0.1, p.spacing * 2);
  const reach = p.radius - bundle - inner;
  if (reach <= 0) {
    return [];
  }
  // Turn gap: the bundle plus air, and few enough turns to stay open.
  const gap = Math.max(bundle + p.spacing * 2.5, reach / MAX_TURNS);
  const turns = reach / gap;
  const total = turns * Math.PI * 2;
  const a = gap / (Math.PI * 2);
  const steps = Math.ceil(turns * SAMPLES_PER_TURN);
  const lines: Point2[][] = [];
  for (let s = 0; s < p.strips; s++) {
    const line: Point2[] = [];
    // Inner strips start later so the bundle's centre curls stay apart.
    const start = Math.min(total * 0.25, (s * p.spacing) / Math.max(a, 1e-3) * 0.5);
    for (let i = 0; i <= steps; i++) {
      const theta = (i / steps) * total;
      if (theta < start) {
        continue;
      }
      const r = inner + a * theta + s * p.spacing;
      // The outer end sits at `angle`; the spiral winds inwards from there.
      const phi = p.angle - p.direction * (total - theta);
      line.push([p.x + Math.cos(phi) * r, p.y + Math.sin(phi) * r]);
    }
    if (line.length > 2) {
      lines.push(line);
    }
  }
  return lines;
}
