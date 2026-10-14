import { Loader } from '@mantine/core';
import { useRenderInfo } from '../store';

export function ViewportOverlay() {
  const phase = useRenderInfo(s => s.phase);
  const generating = useRenderInfo(s => s.generating);
  const paperCount = useRenderInfo(s => s.paperCount);
  const triangleCount = useRenderInfo(s => s.triangleCount);
  const starting = phase === 'preparing' || phase === 'compiling';

  return (
    <>
      {(starting || generating) && (
        <div className="overlay overlay-top-left">
          <div className="glass hint" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Loader size={12} color="gray" />
            {generating ? 'Building strips…' : phase === 'compiling' ? 'Compiling path tracer…' : 'Preparing scene…'}
          </div>
        </div>
      )}
      <div className="overlay overlay-bottom-left">
        <div className="glass hint">
          <kbd>Drag</kbd> orbit · <kbd>Scroll</kbd> zoom · <kbd>Right drag</kbd> spin
        </div>
      </div>
      <div className="overlay overlay-bottom-right">
        <div className="glass hint credits">
          {paperCount.toLocaleString()} strips · {(triangleCount / 1000).toFixed(0)}k tris · rendered with{' '}
          <a href="https://github.com/pissang/mutracer" target="_blank" rel="noreferrer">MuTracer</a>
        </div>
      </div>
    </>
  );
}
