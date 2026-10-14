import { createContext, useContext } from 'react';
import type { PaperRenderer } from './engine/PaperRenderer';

export const RendererContext = createContext<PaperRenderer | null>(null);

export function useRenderer() {
  return useContext(RendererContext);
}
