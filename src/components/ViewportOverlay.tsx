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
          <div className="glass hint">
            <Loader size={12} color="clay.4" />
            {generating ? 'Building strips…' : phase === 'compiling' ? 'Compiling path tracer…' : 'Preparing scene…'}
          </div>
        </div>
      )}
      <div className="overlay overlay-bottom-left">
        <div className="glass hint">
          <span><kbd>Drag</kbd> orbit</span>
          <span className="hint-sep" />
          <span><kbd>Scroll</kbd> zoom</span>
          <span className="hint-sep" />
          <span><kbd>Right drag</kbd> pan</span>
        </div>
      </div>
      <div className="overlay overlay-bottom-right">
        <div className="glass hint credits">
          {paperCount.toLocaleString()} pieces
          <span className="hint-sep" />
          {(triangleCount / 1000).toFixed(0)}k tris
          <span className="hint-sep" />
          <a href="https://github.com/pissang/mutracer" target="_blank" rel="noreferrer">MuTracer</a>
        </div>
      </div>
    </>
  );
}
