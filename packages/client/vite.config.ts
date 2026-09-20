import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Build the shared package from its TypeScript source rather than its
      // compiled dist/. The client bundle then does not depend on a separate
      // build step having run — a stale or missing dist/ used to fail here
      // with an unresolvable import — and edits to the rules engine show up
      // in the dev server without a rebuild.
      '@hexhaven/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // The dev client talks to the game server on 8080.
      '/ws': { target: 'ws://localhost:8080', ws: true },
      '/healthz': 'http://localhost:8080',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // three is large and changes rarely; keep it in its own cached chunk.
        // three and react are large and change rarely, so they get their own
        // long-lived cache entries. The post-processing chain is deliberately
        // NOT listed: naming it here pulled shared dependencies into its
        // chunk, which made the initial page depend on it and defeated the
        // lazy import. Left alone, Rollup splits it at the dynamic import.
        manualChunks: {
          three: ['three'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
