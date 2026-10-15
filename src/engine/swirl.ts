/**
 * Swirls of several strips laid side by side and rolled together, the
 * signature of contemporary quilling: each curls in like a breaking wave,
 * wide at the rim and tightening into an off-centre eye.
 *
 * The strips follow one logarithmic spiral. A log spiral scaled about its
 * pole is the same spiral rotated, so the scaled copies used for the strips
 * stay parallel and never cross, and the gaps between them widen outwards
 * like paper fanning out as it is rolled.
 */

import type { Point2 } from './stripGeometry';

export interface SwirlParams {
  /** Centre of the swirl's outer loop. */
  x: number;
  y: number;
  /** Radius of the outer loop. */
  radius: number;
  /** Strips in the bundle. */
  strips: number;
  /** Radius ratio from one turn to the next, below 1; lower is a more open curl. */
  tightness: number;
  /** 1 counter-clockwise, -1 clockwise. */
  direction: number;
  /** Rotation of the whole swirl. */
  angle: number;
}

const SAMPLES_PER_TURN = 120;
/** The eye, where strips stop curling, relative to the outer radius. */
const EYE = 0.07;

export interface Swirl {
  /** Centre lines of the bundle, outermost first. */
  lines: Point2[][];
  /** Where the strips curl in, and the room left there. */
  eye: Point2;
  eyeRadius: number;
}

export function buildSwirl(p: SwirlParams): Swirl {
  const q = Math.min(Math.max(p.tightness, 0.2), 0.8);
  const b = -Math.log(q) / (Math.PI * 2);
  // Strips split each turn's width evenly: n strips span one radius ratio q.
  const f = q ** (1 / p.strips);

  // Built around the pole with an outer radius of 1, then fitted to the loop.
  const lines: Point2[][] = [];
  for (let s = 0; s < p.strips; s++) {
    const r0 = f ** s;
    const end = Math.log(r0 / EYE) / b;
    const steps = Math.ceil((end / (Math.PI * 2)) * SAMPLES_PER_TURN);
    const line: Point2[] = [];
    for (let i = 0; i <= steps; i++) {
      const theta = (i / steps) * end;
      const r = r0 * Math.exp(-b * theta);
      const phi = p.direction * theta;
      line.push([Math.cos(phi) * r, Math.sin(phi) * r]);
    }
    lines.push(line);
  }

  // The outer loop (first turn of the outermost strip) sets where the swirl sits.
  const loop = lines[0].slice(0, SAMPLES_PER_TURN + 1);
  let cx = 0;
  let cy = 0;
  for (const [x, y] of loop) {
    cx += x;
    cy += y;
  }
  cx /= loop.length;
  cy /= loop.length;
  let reach = 0;
  for (const [x, y] of loop) {
    reach = Math.max(reach, Math.hypot(x - cx, y - cy));
  }
  const scale = p.radius / reach;
  const c = Math.cos(p.angle);
  const s = Math.sin(p.angle);
  const place = ([x, y]: Point2): Point2 => {
    const dx = (x - cx) * scale;
    const dy = (y - cy) * scale;
    return [p.x + dx * c - dy * s, p.y + dx * s + dy * c];
  };
  return {
    lines: lines.map(line => line.map(place)),
    eye: place([0, 0]),
    eyeRadius: EYE * q ** (1 / p.strips) * scale * 0.8
  };
}
