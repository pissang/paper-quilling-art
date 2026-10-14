import { create } from 'zustand';
import { createDefaultConfig, type Config } from './config';

const STORAGE_KEY = 'paper-quilling-config';
const SCHEMA_VERSION = 2;
const HISTORY_LIMIT = 50;
/** Edits closer together than this merge into one undo step (slider drags). */
const HISTORY_MERGE_MS = 400;

function loadConfig(): Config {
  const defaults = createDefaultConfig();
  if (location.search.includes('reset')) {
    return defaults;
  }
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && saved.version === SCHEMA_VERSION) {
      // Object URLs do not survive a reload.
      return { ...defaults, ...saved.config, maskImage: '' };
    }
  }
  catch (e) {
    console.warn('Failed to restore config', e);
  }
  return defaults;
}

function saveConfig(config: Config) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: SCHEMA_VERSION, config }));
  }
  catch (e) {
    // Storage can be unavailable (private mode); persistence is optional.
  }
}

interface ConfigState {
  config: Config;
  past: Config[];
  future: Config[];
  lastEditAt: number;
  set: (patch: Partial<Config>) => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
}

export const useConfig = create<ConfigState>((set, get) => ({
  config: loadConfig(),
  past: [],
  future: [],
  lastEditAt: 0,

  set(patch) {
    const { config, past, lastEditAt } = get();
    const now = performance.now();
    const merge = now - lastEditAt < HISTORY_MERGE_MS && past.length > 0;
    set({
      config: { ...config, ...patch },
      past: merge ? past : [...past, config].slice(-HISTORY_LIMIT),
      future: [],
      lastEditAt: now
    });
  },

  undo() {
    const { config, past, future } = get();
    if (!past.length) {
      return;
    }
    set({
      config: past[past.length - 1],
      past: past.slice(0, -1),
      future: [config, ...future],
      lastEditAt: 0
    });
  },

  redo() {
    const { config, past, future } = get();
    if (!future.length) {
      return;
    }
    set({
      config: future[0],
      past: [...past, config],
      future: future.slice(1),
      lastEditAt: 0
    });
  },

  reset() {
    get().set({ ...createDefaultConfig() });
    set({ lastEditAt: 0 });
  }
}));

saveConfig(useConfig.getState().config);

let saveTimer = 0;
useConfig.subscribe(state => {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => saveConfig(state.config), 500);
});

export function useConfigValue<K extends keyof Config>(key: K): Config[K] {
  return useConfig(state => state.config[key]);
}

export function setConfig(patch: Partial<Config>) {
  useConfig.getState().set(patch);
}

export type RenderPhase = 'preparing' | 'compiling' | 'previewing' | 'converging' | 'denoising' | 'finished' | 'error';

export interface RenderInfo {
  phase: RenderPhase;
  samples: number;
  maxSamples: number;
  backend: string;
  adapter: string;
  generating: boolean;
  /** Progress of an offline high quality render, or undefined. */
  offline?: { samples: number; target: number; stage: string };
  error?: string;
  paperCount: number;
  triangleCount: number;
}

export const useRenderInfo = create<RenderInfo>(() => ({
  phase: 'preparing',
  samples: 0,
  maxSamples: 1024,
  backend: '',
  adapter: '',
  generating: false,
  paperCount: 0,
  triangleCount: 0
}));
