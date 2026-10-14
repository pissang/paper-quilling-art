export function createTextMaskImage(text: string, font: string, fontSize: number): HTMLCanvasElement;
export function resizeImage(image: CanvasImageSource & { width: number; height: number }, targetWidth: number, targetHeight: number): HTMLCanvasElement;
export function createMaskImageData(image: CanvasImageSource & { width: number; height: number }, cutoff: number, inverse: boolean): ImageData;
