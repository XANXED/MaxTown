import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  // Все файлы ходят в одну тестовую схему Postgres и чистят её перед тестом.
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4175', viewport: { width: 420, height: 800 } },
  webServer: {
    command: 'npm run build -w @maxtown/miniapp && npm run preview -w @maxtown/miniapp -- --host 127.0.0.1 --port 4175 --strictPort',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
  },
});
