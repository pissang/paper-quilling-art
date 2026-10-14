import * as chromatic from 'd3-scale-chromatic';

export type RGB = [number, number, number];

export const MAX_COLORS = 7;

export const ENVIRONMENTS = {
  canyon: './img/canyon.hdr',
  hall: './img/hall.hdr',
  pisa: './img/pisa.hdr'
} as const;
export type EnvironmentName = keyof typeof ENVIRONMENTS | 'none';

export const PAPER_TEXTURES = {
  'paper-detail': './img/paper-detail.png',
  'cream-paper': './img/cream-paper-subtle-pattern.jpg',
  watercolor: './img/free-vector-watercolor-paper-texture.jpg'
} as const;

export interface Config {
  seed: number;

  // Paper strips
  number: number;
  trail: number;
  noiseScale: number;
  thickness: number;
  minHeight: number;
  maxHeight: number;
  paperVisible: boolean;

  // Colors
  clusterColors: boolean;
  colorNumber: number;
  colors: RGB[];

  // Mask
  maskText: string;
  maskTextFont: string;
  maskTextSize: number;
  /** Object URL of an uploaded mask image. Not persisted. */
  maskImage: string;
  outlineVisible: boolean;
  outlineColor: RGB;
  outlineThickness: number;
  outlineHeight: number;

  // Material
  paperRoughness: number;
  paperTexture: string;
  bumpScale: number;
  translucency: number;
  bevel: number;

  // Ground and background
  backgroundColor: RGB;
  showPlane: boolean;
  planeColor: RGB;
  shadowColor: RGB;
  shadowIntensity: number;

  // Lighting
  /** Horizontal offset of the light seen from above, in [-1, 1]. */
  lightDirection: [number, number];
  lightIntensity: number;
  lightSoftness: number;
  environment: EnvironmentName;
  environmentIntensity: number;

  // Camera
  spinAngle: number;
  fov: number;

  // Look
  exposure: number;
  toneMapping: 'agx' | 'aces' | 'cineon' | 'reinhard' | 'linear';
  contrast: number;
  saturation: number;
  vignette: number;
  bloom: number;

  // Path tracing
  maxSamples: number;
  bounces: number;
  denoise: boolean;
  /** Denoise while converging and during interaction. */
  liveDenoise: boolean;
}

const INITIAL_COLORS: RGB[] = [
  [4, 38, 77],
  [37, 106, 168],
  [11, 51, 77],
  [97, 202, 255],
  [0, 162, 255],
  [255, 217, 0],
  [255, 244, 137]
];

export function createDefaultConfig(): Config {
  return {
    seed: Math.random(),

    number: 800,
    trail: 100,
    noiseScale: 3,
    thickness: 0.01,
    minHeight: 0.6,
    maxHeight: 1.2,
    paperVisible: true,

    clusterColors: true,
    colorNumber: 6,
    colors: INITIAL_COLORS.map(c => [...c] as RGB),

    maskText: '',
    maskTextFont: 'sans-serif',
    maskTextSize: 100,
    maskImage: '',
    outlineVisible: true,
    outlineColor: [0, 63, 97],
    outlineThickness: 0.04,
    outlineHeight: 1.2,

    paperRoughness: 0.75,
    paperTexture: PAPER_TEXTURES['paper-detail'],
    bumpScale: 0.6,
    translucency: 0.15,
    bevel: 0.004,

    backgroundColor: [48, 48, 48],
    showPlane: true,
    planeColor: [0, 63, 97],
    shadowColor: [0, 0, 0],
    shadowIntensity: 0.8,

    lightDirection: [-0.3, 0.4],
    lightIntensity: 2.5,
    lightSoftness: 6,
    environment: 'canyon',
    environmentIntensity: 0.6,

    spinAngle: 0,
    fov: 40,

    exposure: 1.2,
    toneMapping: 'aces',
    contrast: 1,
    saturation: 1.05,
    vignette: 0.15,
    bloom: 0,

    maxSamples: 512,
    bounces: 5,
    denoise: true,
    liveDenoise: true
  };
}

export interface Palette {
  name: string;
  sample: (t: number) => string;
}

export const PALETTES: Palette[] = [
  ['Spectral', chromatic.interpolateSpectral],
  ['RdYlBu', chromatic.interpolateRdYlBu],
  ['RdYlGn', chromatic.interpolateRdYlGn],
  ['BrBG', chromatic.interpolateBrBG],
  ['PuOr', chromatic.interpolatePuOr],
  ['RdBu', chromatic.interpolateRdBu],
  ['Viridis', chromatic.interpolateViridis],
  ['Magma', chromatic.interpolateMagma],
  ['Plasma', chromatic.interpolatePlasma],
  ['Inferno', chromatic.interpolateInferno],
  ['Warm', chromatic.interpolateWarm],
  ['Cool', chromatic.interpolateCool],
  ['Rainbow', chromatic.interpolateRainbow],
  ['Sinebow', chromatic.interpolateSinebow],
  ['PuRd', chromatic.interpolatePuRd],
  ['YlGnBu', chromatic.interpolateYlGnBu]
].map(([name, sample]) => ({ name: name as string, sample: sample as (t: number) => string }));

export function paletteColors(palette: Palette, count = MAX_COLORS): RGB[] {
  const colors: RGB[] = [];
  for (let i = 0; i < count; i++) {
    colors.push(parseColor(palette.sample(1 - i / (count + 1))));
  }
  return colors;
}

/** Parses the `rgb(...)` / `#rrggbb` strings returned by d3 interpolators. */
export function parseColor(str: string): RGB {
  const rgb = str.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (rgb) {
    return [+rgb[1], +rgb[2], +rgb[3]];
  }
  const hex = str.replace('#', '');
  return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)) as RGB;
}

export function rgbToHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map(c => Math.round(c).toString(16).padStart(2, '0')).join('');
}

export function hexToRgb(hex: string): RGB {
  return parseColor(hex);
}
