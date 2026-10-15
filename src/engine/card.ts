/**
 * Coloured card cut to a region's shape and glued to the board, the way
 * quillers lay a base colour before standing strips on it. Gaps between the
 * pieces then show tinted card instead of bare board.
 */

import { ShapeUtils, Vector2 } from 'three';
import { simplify, smoothLine, type Point2 } from './stripGeometry';

export interface FlatMesh {
  position: Float32Array;
  normal: Float32Array;
  indices: Uint32Array;
}

/** How far the card's walls reach into the board, so its edge casts no light leak. */
const SINK = 0.003;

function signedArea(loop: Point2[]) {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const [x0, y0] = loop[i];
    const [x1, y1] = loop[(i + 1) % loop.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

function contains(loop: Point2[], [x, y]: Point2) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, yi] = loop[i];
    const [xj, yj] = loop[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Builds a card of `thickness` from closed boundary loops in board units.
 * Loops nested an odd number of times are holes.
 */
export function buildCard(rawLoops: Point2[][], thickness: number, smooth: number): FlatMesh | null {
  const loops = rawLoops
    .map(loop => {
      const smoothed = smoothLine(loop, true, smooth);
      const simple = simplify([...smoothed, smoothed[0]]);
      simple.pop();
      return simple;
    })
    .filter(loop => loop.length >= 3 && Math.abs(signedArea(loop)) > 1e-4);
  if (!loops.length) {
    return null;
  }
  const depth = loops.map((loop, i) => loops.reduce((d, other, j) => d + (i !== j && contains(other, loop[0]) ? 1 : 0), 0));

  const position: number[] = [];
  const normal: number[] = [];
  const indices: number[] = [];
  const top = thickness;

  loops.forEach((outer, i) => {
    if (depth[i] % 2) {
      return;
    }
    const holes = loops.filter((hole, j) => depth[j] === depth[i] + 1 && contains(outer, hole[0]));
    const contour = outer.map(([x, y]) => new Vector2(x, y));
    const holeVecs = holes.map(hole => hole.map(([x, y]) => new Vector2(x, y)));
    const faces = ShapeUtils.triangulateShape(contour, holeVecs);
    const base = position.length / 3;
    for (const v of [...contour, ...holeVecs.flat()]) {
      position.push(v.x, v.y, top);
      normal.push(0, 0, 1);
    }
    const all = [...contour, ...holeVecs.flat()];
    for (const [a, b, c] of faces) {
      // Face the top upwards whatever the loop orientation.
      const cross = (all[b].x - all[a].x) * (all[c].y - all[a].y) - (all[b].y - all[a].y) * (all[c].x - all[a].x);
      if (cross >= 0) {
        indices.push(base + a, base + b, base + c);
      }
      else {
        indices.push(base + a, base + c, base + b);
      }
    }
  });

  // Edge walls, with normals pointing away from the card.
  loops.forEach((loop, i) => {
    const hole = depth[i] % 2 === 1;
    // Counter-clockwise outer loops face right of their direction; holes the opposite.
    const sign = (signedArea(loop) > 0) !== hole ? 1 : -1;
    const n = loop.length;
    for (let k = 0; k < n; k++) {
      const [x0, y0] = loop[k];
      const [x1, y1] = loop[(k + 1) % n];
      const len = Math.hypot(x1 - x0, y1 - y0) || 1;
      const nx = ((y1 - y0) / len) * sign;
      const ny = (-(x1 - x0) / len) * sign;
      const b = position.length / 3;
      position.push(x0, y0, -SINK, x1, y1, -SINK, x1, y1, top, x0, y0, top);
      for (let q = 0; q < 4; q++) {
        normal.push(nx, ny, 0);
      }
      if (sign > 0) {
        indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
      else {
        indices.push(b, b + 2, b + 1, b, b + 3, b + 2);
      }
    }
  });

  return {
    position: new Float32Array(position),
    normal: new Float32Array(normal),
    indices: new Uint32Array(indices)
  };
}
