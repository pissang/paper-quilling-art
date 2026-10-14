interface PotraceInstance {
  setParameter(params: Record<string, unknown>): void;
  process(callback?: () => void): void;
  getSVG(size: number, type?: string): string;
}
declare function Potrace(img: CanvasImageSource & { width: number; height: number }, parameter?: Record<string, unknown>): PotraceInstance;
export default Potrace;
