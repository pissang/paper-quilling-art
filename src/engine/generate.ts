import clustering from 'density-clustering';
import seedrandom from 'seedrandom';
import { generatePerlin, perlinSeed } from '../lib/perlin';
import { createMaskImageData, createTextMaskImage, resizeImage } from '../lib/imageHelper';
import Potrace from '../lib/potrace';
import { applyHeight, buildStrip, curlEnds, mergeStripMeshes, type StripMesh } from './stripGeometry';

export const BOX_SIZE = 11;
const BOX_MIN = [-BOX_SIZE, -BOX_SIZE];
const BOX_MAX = [BOX_SIZE, BOX_SIZE];
const OUTLINE_TRACE_SIZE = 512;

/** One paper strip standing on the XY plane, raised along +Z by its layer height. */
export interface Strip {
  mesh: StripMesh;
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
  imperfection: number;
  curl: number;
}

export function generateStrips(params: StripParams, mask: Mask | null): Strip[] {
  perlinSeed(params.seed);
  const polylines = generatePerlin(
    BOX_MIN, BOX_MAX,
    params.number, params.trail, params.noiseScale,
    mask?.imageData, mask?.outlinePoints
  );
  // Separate stream so the flow field does not depend on the paper variation.
  const rand = seedrandom(params.seed + '-paper');
  const strips: Strip[] = [];
  for (const polyline of polylines) {
    const line = params.curl > 0 ? curlEnds(polyline, params.curl, rand) : polyline;
    const mesh = buildStrip(line, { thickness: params.thickness, imperfection: params.imperfection, rand });
    if (mesh) {
      strips.push({ mesh, start: [polyline[0][0], polyline[0][1]] });
    }
  }
  return strips;
}

/** The traced mask outline as closed strips of a fixed height. */
export function buildOutline(mask: Mask, thickness: number, height: number, imperfection: number, seed: number) {
  const rand = seedrandom(seed + '-outline');
  const meshes: StripMesh[] = [];
  for (const polyline of mask.outline) {
    // Outlines are traced from closed paths.
    const mesh = buildStrip(polyline, { thickness, imperfection: imperfection * 0.5, rand, closed: true });
    if (mesh) {
      meshes.push(mesh);
    }
  }
  return toGeometry(mergeStripMeshes(meshes), height);
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
  /** Height independent layout for `setStripHeight`. */
  layout: StripMesh;
}

function toGeometry(mesh: StripMesh, height: number): MergedGeometry {
  return { position: applyHeight(mesh, height), normal: mesh.normal, indices: mesh.indices, layout: mesh };
}

/** Merges strips into one geometry raised to `height`. */
export function mergeStrips(strips: Strip[], height: number): MergedGeometry {
  return toGeometry(mergeStripMeshes(strips.map(s => s.mesh)), height);
}

/** Raises merged strips to a new `height` in place. */
export function setStripHeight(geometry: MergedGeometry, height: number) {
  applyHeight(geometry.layout, height, geometry.position);
}
