export type RGB = [number, number, number];

export const MAX_COLORS = 16;

export interface Style {
  name: string;
  description: string;
  settings: Partial<Config>;
}

/**
 * Looks from different quilling traditions. Their methods pull against each
 * other (swirls take the room pieces would fill, line fills replace pieces),
 * so each is a set of settings rather than all at once.
 */
export const STYLES: Style[] = [
  {
    name: 'Pieces',
    description: 'Coils, teardrops and leaves packed edge to edge.',
    settings: {
      lineFill: 1, contourLines: 0, silhouette: 0, baseCard: false, swirls: 0,
      flowers: 0.15, coilTurns: 6, heightVariation: 0.6
    }
  },
  {
    name: 'Swirls',
    description: 'Big open swirls of several shaded strips, small coils in between.',
    settings: {
      lineFill: 1, contourLines: 0, silhouette: 0, baseCard: false, swirls: 0.65,
      swirlStrips: 4, swirlSize: 2.4, flowers: 0, coilTurns: 5, heightVariation: 0.8
    }
  },
  {
    name: 'Card',
    description: 'Shapes cut from card, edged with a strip and filled with pieces.',
    settings: {
      lineFill: 1, contourLines: 1, silhouette: 1.3, baseCard: true, cardTone: -0.12,
      swirls: 0.25, swirlStrips: 2, swirlSize: 1.6, flowers: 0.3, coilTurns: 6, heightVariation: 0.35
    }
  },
  {
    name: 'Contours',
    description: 'Large areas filled with flowing parallel strips, like a quilled portrait.',
    settings: {
      lineFill: 0.12, contourLines: 2, silhouette: 1.2, baseCard: false, swirls: 0,
      flowers: 0.15, coilTurns: 6, heightVariation: 0.5
    }
  }
];

export interface Sample {
  name: string;
  url: string;
  /** Settings that suit the picture, applied when it is picked. */
  settings: Partial<Config>;
}

/** Bundled cut-paper pictures to start from. */
export const SAMPLES: Sample[] = [
  { name: 'Cat', url: './img/samples/cat.svg', settings: { ...STYLES[0].settings, colorNumber: 8 } },
  // The face reads best as flowing contour lines, like a quilled portrait.
  { name: 'Portrait', url: './img/samples/portrait.svg', settings: { ...STYLES[3].settings, colorNumber: 10 } },
  { name: 'Hummingbird', url: './img/samples/hummingbird.svg', settings: { ...STYLES[1].settings, colorNumber: 10 } },
  { name: 'Koi', url: './img/samples/koi.svg', settings: { ...STYLES[0].settings, colorNumber: 8 } },
  { name: 'Butterfly', url: './img/samples/butterfly.svg', settings: { ...STYLES[2].settings, colorNumber: 8 } }
];

export const PAPER_TEXTURES = {
  'paper-detail': './img/paper-detail.png',
  'cream-paper': './img/cream-paper-subtle-pattern.jpg',
  watercolor: './img/free-vector-watercolor-paper-texture.jpg'
} as const;

export interface Config {
  seed: number;

  // Picture
  /** Image URL; uploads are object URLs that do not survive a reload. */
  image: string;
  /** Paper colors taken from the image. */
  colorNumber: number;
  /** Long side of the analysed image in pixels; more keeps finer detail. */
  detail: number;
  /** Leave a plain background around the subject as bare board. */
  removeBackground: boolean;
  /** Saturation of the paper relative to the image colors. */
  colorBoost: number;
  /** Strips along each region edge, including the outline. */
  contourLines: number;
  contourSpacing: number;
  /** Regions larger than this share of the subject are filled with contour strips only. */
  lineFill: number;
  /** Width of the band of cream scrolls around the subject; 0 for none. */
  ornaments: number;
  ornamentColor: RGB;
  /** Height of the cream strip around the subject relative to the strips; 0 for none. */
  silhouette: number;
  /** Lay each region on coloured card cut to its shape. */
  baseCard: boolean;
  /** Card shade relative to the paper: negative darker, positive lighter. */
  cardTone: number;
  /** Share of each region given to multi-strip swirls, 0 to 1. */
  swirls: number;
  /** Strips rolled together in a swirl. */
  swirlStrips: number;
  /** Largest swirl radius relative to the largest piece. */
  swirlSize: number;

  // Quilled elements
  /** Half length of the largest elements. */
  elementSize: number;
  /** Half length of the smallest filler coils. */
  minElementSize: number;
  /** Gap between neighbouring elements. */
  gap: number;
  /** Share of the largest spots that become flowers. */
  flowers: number;
  /** Turns of a loose coil. */
  coilTurns: number;
  /** How far a coil's eye drifts off centre, 0 to 1. */
  coilEccentricity: number;
  /** How strongly pinching drags a teardrop's turns towards its tip. */
  tipPull: number;
  /** Paper thickness. */
  thickness: number;
  /** Strip width, i.e. how tall the paper stands. */
  stripHeight: number;
  /** Height difference between regions and pieces, as a fraction of the strip width. */
  heightVariation: number;
  /** Share of that difference that varies piece by piece rather than by region. */
  heightJitter: number;
  /** Hand made irregularity of the strips: lean and uneven height, in [0, 1]. */
  imperfection: number;
  paperVisible: boolean;

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
  /** Clear coat on the board, which reflects the light and the paper. */
  planeGloss: number;
  /** Roughness of that coat; lower is a sharper reflection. */
  planeRoughness: number;
  shadowColor: RGB;
  shadowIntensity: number;

  // Lighting
  /** Horizontal offset of the light seen from above, in [-1, 1]. */
  lightDirection: [number, number];
  lightIntensity: number;
  /** Angular size of the key light in degrees. */
  lightSoftness: number;
  lightColor: RGB;
  /** Cool fill from the opposite side. */
  fillIntensity: number;
  /** Broad overhead panel. */
  skyIntensity: number;

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
  /** Viewport resolution relative to the screen; snapshots and exports are always full. */
  renderScale: number;
  maxSamples: number;
  bounces: number;
  denoise: boolean;
  /** Denoise while converging and during interaction. */
  liveDenoise: boolean;
}

export function createDefaultConfig(): Config {
  return {
    seed: Math.random(),

    image: SAMPLES[0].url,
    colorNumber: 8,
    detail: 320,
    removeBackground: true,
    colorBoost: 1.3,
    contourLines: 0,
    contourSpacing: 0.07,
    lineFill: 1,
    ornaments: 2.5,
    ornamentColor: [246, 238, 222],
    silhouette: 0,
    baseCard: false,
    cardTone: -0.12,
    swirls: 0,
    swirlStrips: 4,
    swirlSize: 2.2,

    elementSize: 0.9,
    minElementSize: 0.12,
    gap: 0.008,
    flowers: 0.15,
    coilTurns: 6,
    coilEccentricity: 0.7,
    tipPull: 1.5,
    thickness: 0.01,
    stripHeight: 0.38,
    heightVariation: 0.6,
    heightJitter: 0.6,
    imperfection: 0.5,
    paperVisible: true,

    paperRoughness: 0.6,
    paperTexture: '',
    bumpScale: 0,
    translucency: 0.45,
    bevel: 0.003,

    backgroundColor: [255, 255, 255],
    showPlane: true,
    planeColor: [255, 255, 255],
    planeGloss: 1,
    planeRoughness: 0.12,
    shadowColor: [0, 0, 0],
    shadowIntensity: 0.8,

    lightDirection: [-0.3, 0.4],
    lightIntensity: 3.4,
    lightSoftness: 20,
    lightColor: [255, 241, 222],
    fillIntensity: 0.4,
    skyIntensity: 0.7,

    spinAngle: 0,
    fov: 40,

    exposure: 1.1,
    toneMapping: 'aces',
    contrast: 1,
    saturation: 1.05,
    vignette: 0.15,
    bloom: 0,

    renderScale: 0.5,
    maxSamples: 16,
    bounces: 4,
    denoise: true,
    liveDenoise: false
  };
}

/** Parses `rgb(...)` and `#rrggbb` strings. */
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
