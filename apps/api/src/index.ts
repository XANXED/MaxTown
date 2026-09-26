import { buildApp } from './app.ts';
import { createPool } from './db/pool.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const pool = createPool(databaseUrl);
const app = await buildApp({ pool, env: process.env });
const port = Number(process.env.API_PORT ?? 3000);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close();
  });
}

try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
