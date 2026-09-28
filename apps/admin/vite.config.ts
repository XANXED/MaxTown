import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  resolve: {
    alias: {
      '@design': fileURLToPath(new URL('../../design', import.meta.url)),
    },
  },
  server: {
    port: 5174,
    // /api → локальный API (npm run dev:api). Вход Модератора — Basic Auth, браузер спросит пароль сам.
    proxy: {
      '/api': `http://localhost:${process.env.API_PORT ?? 3000}`,
    },
  },
});
