export type Point2 = [number, number];
export function generatePerlin(
  min: number[],
  max: number[],
  number: number,
  trail: number,
  noiseScale: number,
  maskImage: ImageData | null | undefined,
  outlinePoints: Float32Array | null | undefined
): Point2[][];
export function perlinSeed(value: number | string): void;
export function rand(): number;
