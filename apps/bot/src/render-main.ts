import { connectPostgresHouseChatStore } from './postgres-store.ts';
import { createNodeServer } from './server.ts';
import { createRuntimeBotEnv } from './runtime-env.ts';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_URL не настроен; подключите базу PostgreSQL в Render');

const port = Number(process.env.PORT ?? '10000');
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error('PORT должен быть целым числом от 1 до 65535');
}

const store = connectPostgresHouseChatStore(databaseUrl);
const env = createRuntimeBotEnv(process.env, store);
try {
  await store.initialize();
} catch (error) {
  await store.close();
  throw new Error('Не удалось подключиться к PostgreSQL Render или создать таблицу MaxTown', { cause: error });
}

const server = createNodeServer({ env });

server.listen(port, '0.0.0.0', () => {
  console.log(`MaxTown слушает порт ${port}`);
});

let closing = false;
const close = (): void => {
  if (closing) return;
  closing = true;
  server.close((error) => {
    void store.close().finally(() => {
      if (error) {
        console.error('Не удалось закрыть сервер MaxTown', error);
        process.exitCode = 1;
      }
    });
  });
};

process.once('SIGTERM', close);
process.once('SIGINT', close);
