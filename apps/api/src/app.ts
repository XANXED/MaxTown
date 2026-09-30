import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import type { HealthResponse } from '@maxtown/shared';
import { registerModeratorBasicAuth } from './auth/moderator-basic-auth.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerHouseRoutes } from './routes/houses.ts';
import { registerModeratorRoutes } from './routes/moderator.ts';
import { registerCommunityRoutes } from './routes/community.ts';
import { registerRepairModeRoutes } from './routes/repair-mode.ts';
import { registerApartmentRepairRoutes } from './routes/apartment-repairs.ts';
import { registerNotificationRoutes } from './routes/notifications.ts';
import { registerMaxWebhookRoutes } from './routes/max-webhook.ts';
import { registerHouseSetupRoutes } from './routes/house-setup.ts';
import { createPgOutboxStore, startNotificationOutboxWorker } from './notifications/outbox.ts';
import { createPgDirectMessageOutboxStore, startDirectMessageOutboxWorker } from './notifications/direct-outbox.ts';
import { createMaxApi, type MaxApi } from './max/api.ts';
import type { HouseChatDeps } from './max/house-chats.ts';
import { registerServicesDirectoryRoutes } from './routes/services-directory.ts';
import { registerInternetProviderRoutes } from './routes/internet-providers.ts';
import { registerContactRoutes } from './routes/contacts.ts';
import { registerPlaceRoutes } from './routes/places.ts';
import { registerRequestRoutes } from './routes/requests.ts';
import { registerHouseEventRoutes } from './routes/house-events.ts';
import { registerManagementQuestionRoutes } from './routes/management-questions.ts';
import { startRequestMaintenance } from './requests/maintenance.ts';
import { registerUtilityPaymentRoutes } from './routes/utility-payments.ts';
import { registerMeterReadingRoutes } from './routes/meter-readings.ts';
import { registerApartmentAccessRoutes } from './routes/apartment-access.ts';
import { registerApartmentInfoAccessRoutes } from './routes/apartment-info-access.ts';
import { startUtilityPaymentMaintenance } from './utility-payments/maintenance.ts';
import { createDgisClient, type DgisClient } from './places/dgis.ts';
import { createDataMosContactSource, type HouseContactSource } from './contacts/data-mos.ts';

export type BuildAppOptions = {
  pool: Pool;
  env: NodeJS.ProcessEnv;
  staticAssets?: { miniAppRoot: string; adminRoot: string };
  contactSource?: HouseContactSource | null;
  /** Клиент 2ГИС для Ближайших мест; без него берётся DGIS_API_KEY, без ключа — выключено. */
  dgis?: DgisClient | null;
  /** Клиент MAX Bot API; без него берётся BOT_TOKEN. Тесты подставляют поддельный. */
  max?: MaxApi | null;
  /** fetch для DaData — тестам. */
  dadataFetch?: typeof fetch;
};

const DEFAULT_MAX_BOT_USERNAME = 't25_hakaton_max_bot';
const DEFAULT_INIT_DATA_TTL_SECONDS = 900;

/**
 * От каких адресов доверять X-Forwarded-*: список адресов, подсетей или имён
 * proxy-addr через запятую («uniquelocal» — частные сети контейнеров Docker,
 * там Caddy на Timeweb) либо «true». Пусто — не доверяем: иначе любой клиент
 * подделал бы свой адрес и обошёл лимит входа Модератора. Число звеньев
 * Fastify не принимает — оно не проверяет, кто перед ним.
 */
export function trustProxySetting(value: string | undefined): boolean | string[] {
  const text = value?.trim();
  if (!text || text === 'false') return false;
  if (text === 'true') return true;
  return text.split(',').map((item) => item.trim()).filter(Boolean);
}

function isHtmlNavigation(request: { method: string; headers: { accept?: string } }, path: string): boolean {
  return request.method === 'GET'
    && request.headers.accept?.includes('text/html') === true
    && !path.split('/').some((segment) => segment.includes('.'));
}

export async function buildApp({ pool, env, staticAssets, contactSource, dgis, max, dadataFetch }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: env.NODE_ENV === 'production', trustProxy: trustProxySetting(env.TRUST_PROXY) });
  const botToken = env.BOT_TOKEN?.trim() || null;
  const maxApi = max !== undefined
    ? max
    : botToken ? createMaxApi({ token: botToken, botUsername: env.MAX_BOT_USERNAME?.trim().replace(/^@/, '') || DEFAULT_MAX_BOT_USERNAME }) : null;
  const houseChats: HouseChatDeps | null = maxApi ? {
    pool,
    max: maxApi,
    dadataKey: env.DADATA_API_KEY?.trim() || null,
    ...(dadataFetch ? { dadataFetch } : {}),
    log: (message, error) => app.log.warn({ err: error }, message),
  } : null;
  const ttl = Number(env.MAX_INIT_DATA_TTL_SECONDS ?? DEFAULT_INIT_DATA_TTL_SECONDS);
  const worker = maxApi && env.MAX_CHAT_NOTIFICATIONS !== 'off'
    ? startNotificationOutboxWorker(
      createPgOutboxStore(pool),
      maxApi,
      { intervalMs: 15_000, setInterval: (callback, delay) => setInterval(callback, delay), clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>) },
    )
    : null;
  const directMessageWorker = maxApi && env.MAX_CHAT_NOTIFICATIONS !== 'off'
    ? startDirectMessageOutboxWorker(
      createPgDirectMessageOutboxStore(pool),
      maxApi,
      { intervalMs: 15_000, setInterval: (callback, delay) => setInterval(callback, delay), clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>) },
    )
    : null;
  // Напоминания и автозакрытие Выполненных Заявок (docs/adr/0012). В тестах
  // выключено: там время подставляют в runRequestMaintenance напрямую.
  const requestMaintenance = env.NODE_ENV === 'test'
    ? null
    : startRequestMaintenance(
      pool,
      { intervalMs: 15 * 60_000, setInterval: (callback, delay) => setInterval(callback, delay), clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>) },
      (error) => app.log.error({ err: error }, 'Request maintenance failed'),
    );
  const utilityPaymentMaintenance = env.NODE_ENV === 'test'
    ? null
    : startUtilityPaymentMaintenance(
      pool,
      { intervalMs: 15 * 60_000, setInterval: (callback, delay) => setInterval(callback, delay), clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>) },
      (error) => app.log.error({ err: error }, 'Utility payment maintenance failed'),
    );
  app.addHook('onClose', async () => {
    await worker?.stop();
    await directMessageWorker?.stop();
    await requestMaintenance?.stop();
    await utilityPaymentMaintenance?.stop();
    await pool.end();
  });

  registerModeratorBasicAuth(app, env);

  app.setErrorHandler((error, _request, reply) => {
    if (typeof error === 'object' && error !== null && 'validation' in error) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    // Отказы самого Fastify: слишком большое тело, неизвестный Content-Type,
    // битый JSON. Это ошибка запроса, а не сервера.
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error ? Number(error.statusCode) : 0;
    if (statusCode === 413) return reply.code(413).send({ error: 'payload_too_large' });
    if (statusCode === 415) return reply.code(415).send({ error: 'unsupported_media_type' });
    if (statusCode >= 400 && statusCode < 500) return reply.code(statusCode).send({ error: 'invalid_request' });
    app.log.error({ err: error }, 'Unhandled API error');
    return reply.code(500).send({ error: 'internal_server_error' });
  });

  app.get('/health', async (): Promise<HealthResponse> => ({ status: 'ok' }));
  app.get('/api/health', async (): Promise<HealthResponse> => ({ status: 'ok' }));
  app.get('/ready', async (_request, reply) => {
    try {
      await pool.query('SELECT 1');
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'error' });
    }
  });
  app.get('/api/ready', async (_request, reply) => {
    try {
      await pool.query('SELECT 1');
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'error' });
    }
  });

  registerAuthRoutes(app, pool, {
    botToken,
    initDataTtlSeconds: Number.isSafeInteger(ttl) && ttl > 0 ? ttl : DEFAULT_INIT_DATA_TTL_SECONDS,
    houseChats,
  });
  if (houseChats) registerHouseSetupRoutes(app, houseChats);
  if (houseChats && env.MAX_WEBHOOK_SECRET?.trim()) {
    registerMaxWebhookRoutes(app, houseChats, {
      webhookSecret: env.MAX_WEBHOOK_SECRET.trim(),
      internalSecret: env.MAXTOWN_INTERNAL_SECRET?.trim() || null,
      publicOrigin: env.MAXTOWN_PUBLIC_URL?.trim() || null,
    });
  }
  registerHouseRoutes(app, pool);
  registerApartmentAccessRoutes(app, pool);
  registerApartmentInfoAccessRoutes(app, pool);
  registerModeratorRoutes(app, pool);
  registerCommunityRoutes(app, pool, env.POLL_VOTER_NULLIFIER_SECRET ?? 'development-only-poll-voter-nullifier-secret');
  registerRepairModeRoutes(app, pool);
  registerApartmentRepairRoutes(app, pool);
  registerServicesDirectoryRoutes(app, pool);
  registerInternetProviderRoutes(app, pool);
  registerContactRoutes(app, pool, {
    source: contactSource === undefined
      ? (env.DATA_MOS_API_KEY ? createDataMosContactSource({ apiKey: env.DATA_MOS_API_KEY }) : null)
      : contactSource,
  });
  registerPlaceRoutes(app, pool, {
    dgis: dgis === undefined ? (env.DGIS_API_KEY?.trim() ? createDgisClient({ key: env.DGIS_API_KEY.trim() }) : null) : dgis,
  });
  registerNotificationRoutes(app, pool);
  registerRequestRoutes(app, pool);
  registerUtilityPaymentRoutes(app, pool);
  registerMeterReadingRoutes(app, pool);
  registerManagementQuestionRoutes(app, pool);
  registerHouseEventRoutes(app, pool);

  const assets = staticAssets ?? (env.NODE_ENV === 'production' ? {
    miniAppRoot: fileURLToPath(new URL('../../miniapp/dist', import.meta.url)),
    adminRoot: fileURLToPath(new URL('../../admin/dist', import.meta.url)),
  } : undefined);
  if (assets) {
    await app.register(fastifyStatic, {
      root: assets.miniAppRoot,
      prefix: '/',
      wildcard: false,
      dotfiles: 'deny',
    });
    await app.register(fastifyStatic, {
      root: assets.adminRoot,
      prefix: '/admin/',
      wildcard: false,
      decorateReply: false,
      dotfiles: 'deny',
    });

    app.get('/admin', async (_request, reply) => reply.redirect('/admin/', 308));
    app.get('/admin/*', async (request, reply) => {
      const path = request.raw.url?.split(/[?#]/, 1)[0] ?? '/admin/';
      if (!isHtmlNavigation(request, path)) return reply.code(404).send({ error: 'not_found' });
      return reply.type('text/html').sendFile('index.html', assets.adminRoot);
    });
    app.get('/*', async (request, reply) => {
      const path = request.raw.url?.split(/[?#]/, 1)[0] ?? '/';
      if (path === '/api' || path.startsWith('/api/')) return reply.code(404).send({ error: 'not_found' });
      if (!isHtmlNavigation(request, path)) return reply.code(404).send({ error: 'not_found' });
      return reply.type('text/html').sendFile('index.html', assets.miniAppRoot);
    });
  }

  return app;
}
