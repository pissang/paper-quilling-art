import { useEffect, useRef, useState } from 'react';
import { PaperRenderer } from './engine/PaperRenderer';
import { RendererContext } from './RendererContext';
import { Sidebar } from './components/Sidebar';
import { ViewportOverlay } from './components/ViewportOverlay';
import { useConfig } from './store';

export default function App() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [renderer, setRenderer] = useState<PaperRenderer | null>(null);

  useEffect(() => {
    const instance = new PaperRenderer(viewportRef.current!);
    setRenderer(instance);
    if (import.meta.env.DEV) {
      Object.assign(window, { __renderer: instance });
    }
    return () => instance.dispose();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, [contenteditable]')) {
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? useConfig.getState().redo() : useConfig.getState().undo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <RendererContext.Provider value={renderer}>
      <div className="app">
        <main className="viewport" ref={viewportRef}>
          <ViewportOverlay />
        </main>
        <Sidebar />
      </div>
    </RendererContext.Provider>
  );
}
