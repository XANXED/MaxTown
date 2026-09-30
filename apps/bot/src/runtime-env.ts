import type { HouseChatStore } from './index.ts';
import type { BotEnv } from './index.ts';

function requiredEnvironmentValue(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} не настроен`);
  return value;
}

export function createRuntimeBotEnv(
  environment: NodeJS.ProcessEnv,
  store: HouseChatStore,
): BotEnv {
  const ttl = Number(environment.MAX_INIT_DATA_TTL_SECONDS ?? '900');
  if (!Number.isSafeInteger(ttl) || ttl <= 0) {
    throw new Error('MAX_INIT_DATA_TTL_SECONDS должен быть положительным целым числом');
  }

  return {
    BOT_TOKEN: requiredEnvironmentValue(environment, 'BOT_TOKEN'),
    MAX_WEBHOOK_SECRET: requiredEnvironmentValue(environment, 'MAX_WEBHOOK_SECRET'),
    ...(environment.DADATA_API_KEY?.trim() ? { DADATA_API_KEY: environment.DADATA_API_KEY.trim() } : {}),
    MAX_INIT_DATA_TTL_SECONDS: String(ttl),
    MAX_BOT_USERNAME: environment.MAX_BOT_USERNAME?.trim() || 't25_hakaton_max_bot',
    HOUSE_CHATS: store,
  };
}
