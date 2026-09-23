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
    port: 5174,
  },
});
