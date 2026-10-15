/**
 * Builds a quilled picture from an image. Every color region of the analysed
 * image is outlined by a paper strip on edge, with a few echo strips running
 * parallel inside it. Large regions, like a face, are filled entirely with
 * such contour strips; smaller ones are packed with quilled pieces in their
 * color which follow the region's contours. Cream scrolls decorate the bare
 * board around the subject.
 */

import seedrandom from 'seedrandom';
import { MAX_COLORS, type RGB } from '../config';
import { analyzeImage, type Analysis, type AnalysisParams } from './analyze';
import { createComposer, type CompositionParams, type Element, type FillOptions, type Region } from './compose';
import type { ShapeType } from './shapes';
import { distanceTransform, isoLines, maskComponents, sampleField } from './field';
import { buildStrip, mergeStripMeshes, type Point2, type StripMesh } from './stripGeometry';
import { buildCard, type FlatMesh } from './card';
import { swirlLines } from './swirl';

export const BOX_SIZE = 11;
export const BOARD_MARGIN = 0.6;
/** Contour loops shorter than this are dropped. */
const MIN_LOOP_LENGTH = 0.3;
/** Base card thickness, a heavy card stock. */
const CARD_THICKNESS = 0.012;
/** Palette slot of the ornament paper, after all image colors. */
export const ORNAMENT_COLOR = MAX_COLORS;
const ORNAMENT_KINDS: [ShapeType, number][] = [['cscroll', 0.5], ['sscroll', 0.5]];

const imageCache = new Map<string, Promise<HTMLImageElement>>();

export function loadImage(src: string) {
  let promise = imageCache.get(src);
  if (!promise) {
    promise = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
    imageCache.set(src, promise);
  }
  return promise;
}

export async function analyzeSource(src: string, params: AnalysisParams): Promise<Analysis> {
  return analyzeImage(await loadImage(src), params);
}

export interface ArtworkParams extends CompositionParams {
  /** Strips along each region edge, including the outline itself. */
  contourLines: number;
  /** Distance between those strips. */
  contourSpacing: number;
  /** Regions larger than this share of the subject are filled with contour strips only. */
  lineFill: number;
  /** Width of the band of ornaments around the subject; 0 for none. */
  ornaments: number;
  /** Whether a cream strip outlines the whole subject. */
  silhouette: boolean;
  /** Whether each region sits on coloured card cut to its shape. */
  baseCard: boolean;
  /** Share of each region given to multi-strip swirls, 0 to 1. */
  swirls: number;
  /** Strips rolled together in a swirl. */
  swirlStrips: number;
  /** Largest swirl radius relative to the largest piece. */
  swirlSize: number;
}

export interface Artwork {
  palette: RGB[];
  /** Instanced quilled pieces. */
  prototypes: StripMesh[];
  elements: Element[];
  /** Merged contour strips per palette color. */
  contours: (StripMesh | null)[];
  /** Height level of each palette color's region, in [-1, 1]. */
  levels: number[];
  /** Cream strip, two layers thick, around the whole subject. */
  silhouette: StripMesh | null;
  /** Base card per palette color. */
  cards: (FlatMesh | null)[];
}

/** A strip of doubled paper hugging the outside of the subject, as quillers frame a shape. */
function buildSilhouette(
  analysis: Analysis,
  params: ArtworkParams,
  pixel: number,
  toBoard: (px: number, py: number) => Point2
) {
  const { width: w, height: h, labels } = analysis;
  const subject = new Uint8Array(w * h);
  const background = new Uint8Array(w * h);
  for (let i = 0; i < labels.length; i++) {
    subject[i] = labels[i] >= 0 ? 1 : 0;
    background[i] = 1 - subject[i];
  }
  // Signed distance: positive inside the subject, zero on its edge.
  const inside = distanceTransform(subject, w, h);
  const outside = distanceTransform(background, w, h, true);
  const signed = new Float32Array(w * h);
  for (let i = 0; i < signed.length; i++) {
    signed[i] = inside[i] - outside[i];
  }
  const thickness = params.thickness * 2;
  // Just outside the region outlines, which sit `inset` inside the edge.
  const offset = thickness / 2 + params.gap;
  const rand = seedrandom(params.seed + '-silhouette');
  const strips: StripMesh[] = [];
  for (const loop of isoLines(signed, w, h, -(0.5 + offset / pixel), -1e9)) {
    const points = loop.map(([px, py]) => toBoard(px, py));
    if (loopLength(points) < MIN_LOOP_LENGTH * 3) {
      continue;
    }
    const mesh = buildStrip(points, {
      thickness,
      imperfection: params.imperfection * 0.3,
      rand,
      closed: true,
      smooth: Math.max(pixel * 3, 0.15)
    });
    if (mesh) {
      strips.push(mesh);
    }
  }
  return strips.length ? mergeStripMeshes(strips) : null;
}

/** Scrolls and coils of cream paper in a band around the subject. */
function fillOrnaments(
  analysis: Analysis,
  params: ArtworkParams,
  pixel: number,
  toBoard: (px: number, py: number) => Point2,
  toPixel: (x: number, y: number) => number[],
  fill: (region: Region, color: number, accent: number, options?: FillOptions) => void
) {
  const { width: w, height: h, labels } = analysis;
  const background = new Uint8Array(w * h);
  for (let i = 0; i < labels.length; i++) {
    background[i] = labels[i] < 0 ? 1 : 0;
  }
  // Distance to the subject; the image border is not an edge.
  const field = distanceTransform(background, w, h, true);
  // Keep clear of the subject's outline and the silhouette strip around it.
  const margin = params.thickness * 3 + params.gap * 2;
  const band = params.ornaments;
  const depthAt = (fieldValue: number) => (fieldValue - 0.5) * pixel - margin;
  const clearance = (x: number, y: number) => {
    const [fx, fy] = toPixel(x, y);
    if (fx < 0 || fy < 0 || fx > w - 1 || fy > h - 1) {
      return -1;
    }
    const depth = depthAt(sampleField(field, w, h, fx, fy));
    return Math.min(depth, band - depth);
  };
  const candidates: number[] = [];
  for (let i = 0; i < field.length; i++) {
    const depth = depthAt(field[i]);
    if (depth > 0 && depth < band) {
      candidates.push(i);
    }
  }
  if (!candidates.length) {
    return;
  }
  const eps = pixel;
  fill({
    area: candidates.length * pixel * pixel,
    span: band / 2,
    clearance,
    direction(x, y) {
      const gx = clearance(x + eps, y) - clearance(x - eps, y);
      const gy = clearance(x, y + eps) - clearance(x, y - eps);
      return Math.atan2(gy, gx) + Math.PI / 2;
    },
    sample(r) {
      const i = candidates[Math.floor(r() * candidates.length)];
      const [x, y] = toBoard(i % w, Math.floor(i / w));
      return [x + (r() - 0.5) * pixel, y + (r() - 0.5) * pixel];
    }
  }, ORNAMENT_COLOR, ORNAMENT_COLOR, {
    kinds: ORNAMENT_KINDS,
    // Loose decoration: a few large scrolls with room between them.
    gap: Math.max(params.gap, 0.35),
    minRatio: 0.45,
    // Low, so the decoration never competes with the subject.
    height: -0.8
  });
}

function loopLength(points: Point2[]) {
  let len = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    len += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return len;
}

/** Flower centres take a color that stands out against the petals. */
function accentFor(palette: RGB[], present: number[], color: number, rand: () => number) {
  const others = present.filter(c => c !== color);
  if (!others.length) {
    return color;
  }
  const [r, g, b] = palette[color];
  const dist = (c: number) => (palette[c][0] - r) ** 2 + (palette[c][1] - g) ** 2 + (palette[c][2] - b) ** 2;
  others.sort((a, c) => dist(c) - dist(a));
  return others[Math.floor(rand() * Math.min(3, others.length))];
}

export function buildArtwork(analysis: Analysis, params: ArtworkParams): Artwork {
  const { width: w, height: h, labels, palette, counts } = analysis;
  const pixel = (2 * (BOX_SIZE - BOARD_MARGIN)) / Math.max(w, h);
  const toBoard = (px: number, py: number): Point2 => [(px + 0.5 - w / 2) * pixel, (h / 2 - py - 0.5) * pixel];
  const toPixel = (x: number, y: number) => [x / pixel + w / 2 - 0.5, h / 2 - 0.5 - y / pixel];

  const rand = seedrandom(params.seed + '-artwork');
  const stripRand = seedrandom(params.seed + '-contours');
  const composer = createComposer(params);
  const present = counts.map((n, c) => (n > 0 ? c : -1)).filter(c => c >= 0);
  const contours: (StripMesh | null)[] = palette.map(() => null);
  const cards: (FlatMesh | null)[] = palette.map(() => null);
  /** Strips by palette color, merged per color at the end. */
  const colorStrips: StripMesh[][] = palette.map(() => []);
  // Each color stands at its own height, like strips cut to different widths.
  const heightRand = seedrandom(params.seed + '-heights');
  const levels = palette.map(() => heightRand() * 2 - 1);

  const lines = Math.max(0, Math.round(params.contourLines));
  // Neighbouring regions each keep their outline half a gap off the shared edge.
  const inset = params.thickness / 2 + params.gap / 2;
  const fillStart = lines > 0 ? inset + (lines - 1) * params.contourSpacing + params.thickness / 2 + params.gap : 0;

  let subject = 0;
  for (let i = 0; i < labels.length; i++) {
    subject += labels[i] >= 0 ? 1 : 0;
  }
  const lineArea = params.lineFill >= 1 ? Infinity : params.lineFill * subject;

  /** Shades for a swirl's strips: the region color and its nearest neighbours, dark to light. */
  const rampFor = (color: number, count: number) => {
    const [r, g, b] = palette[color];
    const dist = (c: number) => (palette[c][0] - r) ** 2 + (palette[c][1] - g) ** 2 + (palette[c][2] - b) ** 2;
    const near = present.filter(c => c !== color).sort((a, c) => dist(a) - dist(c));
    const lum = (c: number) => 0.2126 * palette[c][0] + 0.7152 * palette[c][1] + 0.0722 * palette[c][2];
    return [color, ...near.slice(0, Math.max(0, count - 1))].sort((a, c) => lum(a) - lum(c));
  };

  /**
   * Puts swirls in the roomiest spots of a region until they cover the
   * requested share of it, and returns the discs they take.
   */
  const placeSwirls = (candidates: number[], depths: number[], color: number) => {
    const maxR = params.size * params.swirlSize;
    const minR = params.size * 0.8;
    const target = params.swirls * candidates.length * pixel * pixel;
    const order = candidates.map((_, k) => k).sort((a, b) => depths[b] - depths[a]);
    const disks: [number, number, number][] = [];
    const strips = Math.max(1, Math.round(params.swirlStrips));
    const ramp = rampFor(color, Math.min(strips, 3));
    let covered = 0;
    for (const k of order) {
      if (covered >= target || depths[k] < minR) {
        break;
      }
      const i = candidates[k];
      const [x, y] = toBoard(i % w, Math.floor(i / w));
      const radius = Math.min(depths[k] - params.gap, maxR);
      if (disks.some(([dx, dy, dr]) => Math.hypot(dx - x, dy - y) < dr + radius + params.gap)) {
        continue;
      }
      const lines = swirlLines({
        x, y, radius,
        strips,
        spacing: params.contourSpacing,
        direction: rand() < 0.5 ? 1 : -1,
        angle: rand() * Math.PI * 2
      });
      lines.forEach((line, s) => {
        const shade = ramp[Math.min(ramp.length - 1, Math.floor((s * ramp.length) / lines.length))];
        const mesh = buildStrip(line, {
          thickness: params.thickness,
          imperfection: params.imperfection * 0.5,
          rand: stripRand,
          // Outer strips of the bundle stand a little taller.
          heightScale: 0.85 + 0.3 * (s / Math.max(1, lines.length - 1))
        });
        if (mesh) {
          colorStrips[shade].push(mesh);
        }
      });
      // A tight coil plugs the eye of the swirl.
      const eye = Math.max(radius * 0.1, params.contourSpacing * 2) * 0.75;
      composer.addTightCoil(x, y, eye, accentFor(palette, present, color, rand), levels[color] + 0.5);
      disks.push([x, y, radius + params.gap / 2]);
      covered += Math.PI * radius * radius;
    }
    return disks;
  };

  for (const color of present) {
    const inside = new Uint8Array(w * h);
    for (let i = 0; i < inside.length; i++) {
      inside[i] = labels[i] === color ? 1 : 0;
    }
    // Pixel distances; the region edge lies half a pixel from the outermost centres.
    const field = distanceTransform(inside, w, h);
    // Large regions are filled with contour strips only, down to their core.
    const { comp, sizes } = maskComponents(inside, w, h);
    const linesOnly = sizes.map(size => size >= lineArea);
    const lineField = new Float32Array(field.length);
    let lineDepth = 0;
    for (let i = 0; i < field.length; i++) {
      if (comp[i] >= 0 && linesOnly[comp[i]]) {
        lineField[i] = field[i];
        lineDepth = Math.max(lineDepth, field[i]);
      }
    }

    if (params.baseCard) {
      // Cut a little inside the edge, so neighbouring cards do not overlap.
      const cardLoops = isoLines(field, w, h, 0.5 + params.gap / 2 / pixel)
        .map(loop => loop.map(([px, py]) => toBoard(px, py)))
        .filter(loop => loopLength(loop) >= MIN_LOOP_LENGTH);
      cards[color] = buildCard(cardLoops, CARD_THICKNESS, Math.max(pixel * 2.5, 0.12));
    }

    const strips = colorStrips[color];
    for (let k = 0; ; k++) {
      const level = 0.5 + (inset + k * params.contourSpacing) / pixel;
      if (k >= lines && level >= lineDepth) {
        break;
      }
      for (const loop of isoLines(k < lines ? field : lineField, w, h, level)) {
        const points = loop.map(([px, py]) => toBoard(px, py));
        if (loopLength(points) < MIN_LOOP_LENGTH) {
          continue;
        }
        const mesh = buildStrip(points, {
          thickness: params.thickness,
          imperfection: params.imperfection * 0.5,
          rand: stripRand,
          closed: true,
          smooth: Math.max(pixel * 2.5, 0.12)
        });
        if (mesh) {
          strips.push(mesh);
        }
      }
    }

    // Pieces fill what the contour strips leave.
    const clearanceAt = (x: number, y: number) => {
      const [fx, fy] = toPixel(x, y);
      return (sampleField(field, w, h, fx, fy) - 0.5) * pixel - fillStart;
    };
    const candidates: number[] = [];
    const depths: number[] = [];
    for (let i = 0; i < field.length; i++) {
      const depth = (field[i] - 0.5) * pixel - fillStart;
      if (depth > 0 && !linesOnly[comp[i]]) {
        candidates.push(i);
        depths.push(depth);
      }
    }
    if (!candidates.length) {
      continue;
    }
    const swirlDisks = params.swirls > 0
      ? placeSwirls(candidates, depths, color)
      : [];
    depths.sort((a, b) => a - b);
    const eps = pixel;
    const region: Region = {
      area: candidates.length * pixel * pixel,
      span: depths[Math.floor(depths.length * 0.9)],
      clearance: clearanceAt,
      direction(x, y) {
        // Pieces follow the region's contours, across the distance gradient.
        const gx = clearanceAt(x + eps, y) - clearanceAt(x - eps, y);
        const gy = clearanceAt(x, y + eps) - clearanceAt(x, y - eps);
        return Math.atan2(gy, gx) + Math.PI / 2;
      },
      sample(r) {
        const i = candidates[Math.floor(r() * candidates.length)];
        const [x, y] = toBoard(i % w, Math.floor(i / w));
        return [x + (r() - 0.5) * pixel, y + (r() - 0.5) * pixel];
      }
    };
    composer.fill(region, color, accentFor(palette, present, color, rand), {
      height: levels[color],
      reserved: swirlDisks
    });
  }

  palette.forEach((_, color) => {
    if (colorStrips[color].length) {
      contours[color] = mergeStripMeshes(colorStrips[color]);
    }
  });

  if (params.ornaments > 0 && subject > 0) {
    fillOrnaments(analysis, params, pixel, toBoard, toPixel, composer.fill);
  }
  const silhouette = params.silhouette && subject > 0 && subject < labels.length
    ? buildSilhouette(analysis, params, pixel, toBoard)
    : null;

  return { palette, prototypes: composer.prototypes, elements: composer.elements, contours, levels, silhouette, cards };
}
