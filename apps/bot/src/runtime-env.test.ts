import { describe, expect, it } from 'vitest';
import type { HouseChatStore } from './index.ts';
import { createRuntimeBotEnv } from './runtime-env.ts';

const store: HouseChatStore = {
  get: async () => null,
  put: async () => undefined,
  delete: async () => undefined,
  list: async () => ({ keys: [], list_complete: true }),
};

describe('Render runtime environment', () => {
  it('requires bot token and webhook secret before accepting requests', () => {
    expect(() => createRuntimeBotEnv({}, store)).toThrow('BOT_TOKEN');
    expect(() => createRuntimeBotEnv({ BOT_TOKEN: 'configured' }, store)).toThrow('MAX_WEBHOOK_SECRET');
  });

  it('uses safe defaults and validates the initData lifetime', () => {
    expect(createRuntimeBotEnv(
      { BOT_TOKEN: 'bot-token', MAX_WEBHOOK_SECRET: 'webhook-secret' },
      store,
    )).toEqual({
      BOT_TOKEN: 'bot-token',
      MAX_WEBHOOK_SECRET: 'webhook-secret',
      MAX_INIT_DATA_TTL_SECONDS: '900',
      MAX_BOT_USERNAME: 't25_hakaton_max_bot',
      HOUSE_CHATS: store,
    });

    expect(() => createRuntimeBotEnv(
      { BOT_TOKEN: 'bot-token', MAX_WEBHOOK_SECRET: 'secret', MAX_INIT_DATA_TTL_SECONDS: '0' },
      store,
    )).toThrow('MAX_INIT_DATA_TTL_SECONDS');
  });
});
