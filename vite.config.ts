import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  // Keep MuTracer out of dependency prebundling so its OIDN weights and
  // TinyBVH wasm resolve from the package.
  optimizeDeps: { exclude: ['@meimu/mutracer'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 4096 }
});
