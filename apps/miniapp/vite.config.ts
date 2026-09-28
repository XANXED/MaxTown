import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@design': fileURLToPath(new URL('../../design', import.meta.url)),
    },
  },
  server: {
    // /api → локальный API (npm run dev:api): один origin, как в продакшне.
    proxy: {
      '/api': `http://localhost:${process.env.API_PORT ?? 3000}`,
    },
  },
});
