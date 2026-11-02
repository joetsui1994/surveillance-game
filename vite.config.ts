import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative base so the built app works from any static host path.
  base: './',
  plugins: [react()],
  // One ~510 kB bundle (~150 kB gzipped, mostly React and supabase-js) is fine for a one-page app.
  build: { chunkSizeWarningLimit: 600 },
  test: { environment: 'node' },
});
