import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { DGIS_MAP_HOSTS } from './src/platform/dgisMap.ts';

// /dgis/<имя>/… → хост карты 2ГИС, как Caddy в продакшне (VITE_DGIS_MAP_PROXY=/dgis).
const dgisMapProxy = Object.fromEntries(
  Object.entries(DGIS_MAP_HOSTS).map(([name, host]) => [
    `/dgis/${name}/`,
    { target: `https://${host}`, changeOrigin: true, rewrite: (path: string) => path.slice(`/dgis/${name}`.length) },
  ]),
);

export default defineConfig({
  plugins: [react()],
  // Общий .env в корне репозитория. В клиент попадают только VITE_* — сейчас
  // это ключ карты 2ГИС (VITE_DGIS_API_KEY), он и так виден в коде страницы.
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  resolve: {
    alias: {
      '@design': fileURLToPath(new URL('../../design', import.meta.url)),
    },
  },
  server: {
    // /api → локальный API (npm run dev:api): один origin, как в продакшне.
    proxy: {
      '/api': `http://localhost:${process.env.API_PORT ?? 3000}`,
      ...dgisMapProxy,
    },
  },
});
