import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';
import { parseHouseChatBindings } from './house-chat.ts';
import { JsonHouseChatRegistry } from './house-chat-registry.ts';

const ttl = Number(process.env.MAX_INIT_DATA_TTL_SECONDS ?? 900);
if (!Number.isSafeInteger(ttl) || ttl <= 0) {
  throw new Error('MAX_INIT_DATA_TTL_SECONDS должен быть положительным целым числом');
}

const app = buildApp(
  {
    botToken: process.env.BOT_TOKEN ?? '',
    houseChatRegistry: new JsonHouseChatRegistry(
      process.env.MAX_CHAT_REGISTRY_PATH ??
        fileURLToPath(new URL('../../../.data/house-chats.json', import.meta.url)),
      parseHouseChatBindings(process.env.MAX_HOUSE_CHATS),
    ),
    internalApiSecret: process.env.MAXTOWN_INTERNAL_SECRET ?? '',
    maxInitDataTtlSeconds: ttl,
  },
  { logger: true },
);

const port = Number(process.env.API_PORT ?? 3000);

try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
