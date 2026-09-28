import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
  resolve: {
    alias: {
      '@design': fileURLToPath(new URL('../../design', import.meta.url)),
    },
  },
});
