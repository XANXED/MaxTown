import Fastify, { type FastifyInstance } from 'fastify';
import type { HealthResponse, MaxAuthResponse } from '@maxtown/shared';
import { getHouseAccesses, MaxApiError } from './house-chat.ts';
import type { HouseChatRegistry } from './house-chat-registry.ts';
import { validateMaxInitData } from './max-init-data.ts';

export type ApiConfig = {
  botToken: string;
  houseChatRegistry: HouseChatRegistry;
  internalApiSecret: string;
  maxInitDataTtlSeconds: number;
};

type BuildAppOptions = {
  fetcher?: typeof fetch;
  logger?: boolean;
  nowSeconds?: () => number;
};

function hasInitData(body: unknown): body is { initData: string } {
  return (
    typeof body === 'object' &&
    body !== null &&
    !Array.isArray(body) &&
    typeof (body as Record<string, unknown>).initData === 'string'
  );
}

function hasHouseChat(body: unknown): body is { chatId: number; chatTitle: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false;
  const value = body as Record<string, unknown>;
  return (
    Number.isSafeInteger(value.chatId) &&
    value.chatId !== 0 &&
    typeof value.chatTitle === 'string' &&
    Boolean(value.chatTitle.trim())
  );
}

function secretsEqual(actual: string, expected: string): boolean {
  const encoder = new TextEncoder();
  const actualBytes = encoder.encode(actual);
  const expectedBytes = encoder.encode(expected);
  const length = Math.max(actualBytes.length, expectedBytes.length);
  let different = actualBytes.length ^ expectedBytes.length;

  for (let index = 0; index < length; index += 1) {
    different |= (actualBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
  }
  return different === 0;
}

export function buildApp(config: ApiConfig, options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  const fetcher = options.fetcher ?? globalThis.fetch;

  app.get('/health', async (): Promise<HealthResponse> => ({ status: 'ok' }));

  app.post('/api/internal/max/chats', async (request, reply) => {
    if (!config.internalApiSecret) {
      return reply.code(503).send({ error: 'Регистрация Домовых чатов не настроена' });
    }
    const suppliedSecret = request.headers['x-maxtown-internal-secret'];
    if (typeof suppliedSecret !== 'string' || !secretsEqual(suppliedSecret, config.internalApiSecret)) {
      return reply.code(401).send({ error: 'Неверный внутренний секрет' });
    }
    if (!hasHouseChat(request.body)) {
      return reply.code(400).send({ error: 'Передайте chatId и chatTitle' });
    }

    const house = await config.houseChatRegistry.register(request.body);
    return reply.code(201).send({ house });
  });

  app.post('/api/auth/max', async (request, reply) => {
    if (!config.botToken) {
      return reply.code(503).send({ error: 'Авторизация MAX не настроена' });
    }
    if (!hasInitData(request.body) || !request.body.initData) {
      return reply.code(400).send({ error: 'Передайте initData' });
    }

    const validation = validateMaxInitData(request.body.initData, config.botToken, {
      maxAgeSeconds: config.maxInitDataTtlSeconds,
      nowSeconds: options.nowSeconds?.(),
    });
    if (!validation.ok) {
      return reply.code(401).send({ error: 'Данные запуска MAX недействительны или устарели' });
    }

    try {
      const registeredChats = await config.houseChatRegistry.list();
      const houses = await getHouseAccesses(registeredChats, validation.data.user.id, config.botToken, fetcher);
      if (houses.length === 0) {
        return reply.code(403).send({
          error: 'Доступ закрыт: добавьте бота MaxTown в домовой чат или попросите администратора сделать это',
        });
      }
      const response: MaxAuthResponse = { user: validation.data.user, houses, pendingHouseSetups: [] };
      return reply.send(response);
    } catch (error) {
      if (error instanceof MaxApiError) {
        request.log.error(error);
        return reply.code(502).send({ error: 'Не удалось проверить участие в Домовом чате' });
      }
      throw error;
    }
  });

  return app;
}
