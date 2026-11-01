import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative base so the built app works from any static host path.
  base: './',
  plugins: [react()],
  test: { environment: 'node' },
});
