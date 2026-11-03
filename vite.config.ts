import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { layoutSavePlugin } from './scripts/layout-save.ts';

export default defineConfig({
  // Relative base so the built app works from any static host path.
  base: './',
  // The layout editor (#/layout, dev only) saves through this dev-server endpoint.
  plugins: [react(), layoutSavePlugin(resolve(import.meta.dirname, 'offline/layouts'))],
  // One ~510 kB bundle (~150 kB gzipped, mostly React and supabase-js) is fine for a one-page app.
  build: { chunkSizeWarningLimit: 600 },
  test: { environment: 'node' },
});
