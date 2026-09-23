import Fastify from 'fastify';
import type { HealthResponse } from '@maxtown/shared';

// Проверку initData мини-аппа делаем только здесь, на сервере:
// https://dev.max.ru/docs/webapps/validation

const app = Fastify({ logger: true });

app.get('/health', async (): Promise<HealthResponse> => ({ status: 'ok' }));

const port = Number(process.env.API_PORT ?? 3000);

try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
