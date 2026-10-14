import { extrudePolyline } from 'geometry-extrude';
import clustering from 'density-clustering';
import seedrandom from 'seedrandom';
import { generatePerlin, perlinSeed } from '../lib/perlin';
import { createMaskImageData, createTextMaskImage, resizeImage } from '../lib/imageHelper';
import Potrace from '../lib/potrace';

export const BOX_SIZE = 11;
const BOX_MIN = [-BOX_SIZE, -BOX_SIZE];
const BOX_MAX = [BOX_SIZE, BOX_SIZE];
const OUTLINE_TRACE_SIZE = 512;

/** One extruded strip in the XY plane, extruded along +Z with depth 1. */
export interface Strip {
  position: Float32Array;
  normal: Float32Array;
  indices: Uint16Array | Uint32Array;
  /** First point of the polyline, used for color clustering. */
  start: [number, number];
}

export interface Mask {
  imageData: ImageData;
  outline: [number, number][][];
  outlinePoints: Float32Array;
}

export interface MaskSource {
  text: string;
  font: string;
  textSize: number;
  image: string;
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(src: string) {
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

/** Builds the mask from text (higher priority) or an image. Dark pixels are inside. */
export async function createMask(source: MaskSource): Promise<Mask | null> {
  let image: HTMLCanvasElement | HTMLImageElement;
  if (source.text) {
    image = createTextMaskImage(source.text, source.font, source.textSize);
  }
  else if (source.image) {
    image = await loadImage(source.image);
  }
  else {
    return null;
  }
  const imageData = createMaskImageData(image, 220, true);
  const { outline, outlinePoints } = traceOutline(image);
  return { imageData, outline, outlinePoints };
}

function traceOutline(image: HTMLCanvasElement | HTMLImageElement) {
  const potrace = Potrace(resizeImage(image, OUTLINE_TRACE_SIZE, OUTLINE_TRACE_SIZE));
  potrace.process();
  const svg = new DOMParser().parseFromString(potrace.getSVG(1), 'image/svg+xml');

  // getPointAtLength needs the paths attached to a rendered document.
  const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  host.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden';
  document.body.appendChild(host);

  const scale = (BOX_MAX[0] - BOX_MIN[0]) / OUTLINE_TRACE_SIZE;
  const outline: [number, number][][] = [];
  const points: number[] = [];
  svg.querySelectorAll('path').forEach(source => {
    const path = host.appendChild(document.importNode(source, true));
    const totalLength = path.getTotalLength();
    const polyline: [number, number][] = [];
    for (let i = 0; i <= totalLength; i += 0.2) {
      const pt = path.getPointAtLength(i);
      const x = pt.x * scale + BOX_MIN[0];
      const y = -(pt.y * scale + BOX_MIN[1]);
      polyline.push([x, y]);
      points.push(x, y);
    }
    outline.push(polyline);
  });
  host.remove();

  return { outline, outlinePoints: new Float32Array(points) };
}

export interface StripParams {
  seed: number;
  number: number;
  trail: number;
  noiseScale: number;
  thickness: number;
}

export function generateStrips(params: StripParams, mask: Mask | null): Strip[] {
  perlinSeed(params.seed);
  const polylines = generatePerlin(
    BOX_MIN, BOX_MAX,
    params.number, params.trail, params.noiseScale,
    mask?.imageData, mask?.outlinePoints
  );
  return polylines.map(polyline => {
    const { indices, position, normal } = extrudePolyline([polyline], {
      lineWidth: params.thickness,
      depth: 1,
      smoothSide: true,
      excludeBottom: true
    });
    return { indices, position, normal, start: [polyline[0][0], polyline[0][1]] };
  });
}

/** Assigns every strip a color index, by k-means on start points or round robin. */
export function assignColors(strips: Strip[], colorCount: number, cluster: boolean, seed: number): Uint8Array {
  const result = new Uint8Array(strips.length);
  if (!cluster || strips.length < colorCount * 4) {
    for (let i = 0; i < strips.length; i++) {
      result[i] = i % colorCount;
    }
    return result;
  }
  const rand = seedrandom(seed + '-cluster');
  const kmeans = new clustering.KMEANS();
  // Seeded centroid initialisation keeps the grouping stable across rebuilds.
  kmeans.randomCentroid = function () {
    let centroid;
    do {
      centroid = this.dataset[Math.round(rand() * (this.dataset.length - 1))];
    } while (this.centroids.indexOf(centroid) >= 0);
    return centroid;
  };
  const clusters = kmeans.run(strips.map(s => s.start.slice()), colorCount);
  clusters.forEach((members, idx) => {
    for (const member of members) {
      result[member] = idx;
    }
  });
  return result;
}

/** Deterministic per color group heights in [min, max]. */
export function groupHeights(count: number, min: number, max: number): number[] {
  const rand = seedrandom('height');
  const heights: number[] = [];
  for (let i = 0; i < count; i++) {
    heights.push(Math.max(rand() * (max - min) + min, 0.01));
  }
  return heights;
}

export interface MergedGeometry {
  position: Float32Array;
  normal: Float32Array;
  indices: Uint32Array;
}

/** Merges strips into one geometry, scaling the extruded depth to `height`. */
export function mergeStrips(strips: Strip[], height: number): MergedGeometry {
  let vertexCount = 0;
  let indexCount = 0;
  for (const strip of strips) {
    vertexCount += strip.position.length / 3;
    indexCount += strip.indices.length;
  }
  const position = new Float32Array(vertexCount * 3);
  const normal = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(indexCount);
  let vertexOffset = 0;
  let indexOffset = 0;
  for (const strip of strips) {
    position.set(strip.position, vertexOffset * 3);
    normal.set(strip.normal, vertexOffset * 3);
    for (let i = 0; i < strip.indices.length; i++) {
      indices[indexOffset + i] = strip.indices[i] + vertexOffset;
    }
    vertexOffset += strip.position.length / 3;
    indexOffset += strip.indices.length;
  }
  setExtrudeHeight(position, height);
  return { position, normal, indices };
}

/** Moves the top vertices (z > 0) of an extruded geometry to `height`. */
export function setExtrudeHeight(position: Float32Array, height: number) {
  for (let i = 2; i < position.length; i += 3) {
    if (position[i] > 0) {
      position[i] = height;
    }
  }
}
