import { describe, expect, it, vi } from 'vitest';
import { handleRequest, type BotEnv, type HouseChatStore } from './index.ts';

const NOW = Math.floor(Date.now() / 1000);

class MemoryHouseChatStore implements HouseChatStore {
  readonly values = new Map<string, { value: string; metadata?: unknown }>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key)?.value ?? null;
  }

  async put(key: string, value: string, options?: { metadata?: unknown }): Promise<void> {
    this.values.set(key, { value, ...(options ? { metadata: options.metadata } : {}) });
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  async list(options?: { prefix?: string; cursor?: string }) {
    const keys = [...this.values.entries()]
      .filter(([key]) => key.startsWith(options?.prefix ?? ''))
      .map(([name, stored]) => ({ name, metadata: stored.metadata }));
    return { keys, list_complete: true };
  }
}

function createEnv(store = new MemoryHouseChatStore(), overrides: Partial<BotEnv> = {}): BotEnv {
  return {
    BOT_TOKEN: 'bot-token',
    MAX_WEBHOOK_SECRET: 'webhook-secret',
    MAX_INIT_DATA_TTL_SECONDS: '900',
    HOUSE_CHATS: store,
    ...overrides,
  };
}

function maxResponse(body: unknown = { success: true }, status = 200): Response {
  return Response.json(body, { status });
}

function webhookRequest(body: unknown, env: BotEnv, secret = env.MAX_WEBHOOK_SECRET): Request {
  return new Request('https://maxtown.example/api/max/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-max-bot-api-secret': secret,
    },
    body: JSON.stringify(body),
  });
}

async function hmacSha256(key: string | Uint8Array<ArrayBuffer>, value: string): Promise<Uint8Array<ArrayBuffer>> {
  const encoder = new TextEncoder();
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    typeof key === 'string' ? encoder.encode(key) : key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(value)));
}

async function signedInitData(botToken: string, overrides: Record<string, string> = {}): Promise<string> {
  const pairs = new Map<string, string>([
    ['auth_date', String(NOW)],
    ['query_id', 'query-1'],
    [
      'user',
      JSON.stringify({
        id: 67890,
        first_name: 'Анна',
        last_name: 'Иванова',
        username: 'anna',
        photo_url: 'https://example.com/anna.jpg',
      }),
    ],
  ]);
  Object.entries(overrides).forEach(([key, value]) => pairs.set(key, value));

  const launchParams = [...pairs.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = await hmacSha256('WebAppData', botToken);
  const signature = await hmacSha256(secretKey, launchParams);
  const hash = [...signature].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return [...pairs.entries(), ['hash', hash] as [string, string]]
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
}

function storedHouse(
  chatId: number,
  houseLabel = 'Домовой чат',
  extra: Record<string, unknown> = {},
) {
  return { houseId: `max-chat:${chatId}`, houseLabel, chatId, ...extra };
}

function dadataHouse(value = 'г Казань, ул Лесная, д 12', guid = 'house-guid-12') {
  return {
    value,
    data: {
      fias_level: '8',
      house_fias_id: guid,
      region_with_type: 'Респ Татарстан',
      city_with_type: 'г Казань',
    },
  };
}

async function seedHouse(
  store: MemoryHouseChatStore,
  chatId: number,
  houseLabel?: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const binding = storedHouse(chatId, houseLabel, extra);
  await store.put(`house-chat:${chatId}`, JSON.stringify(binding), { metadata: binding });
}

async function seedOnboarding(
  store: MemoryHouseChatStore,
  chatId: number,
  chatTitle = 'Домовой чат на Лесной',
): Promise<void> {
  const onboarding = { chatId, chatTitle, status: 'address-required' };
  await store.put(`house-onboarding:${chatId}`, JSON.stringify(onboarding), { metadata: onboarding });
}

describe('Cloudflare Worker бота MAX', () => {
  it('отдаёт health-check без секретов', async () => {
    const response = await handleRequest(
      new Request('https://maxtown.example/api/health'),
      { BOT_TOKEN: '', MAX_WEBHOOK_SECRET: '' },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });

  it('отклоняет webhook с неверным секретом', async () => {
    const env = createEnv();
    const fetcher = vi.fn<typeof fetch>();
    const response = await handleRequest(
      webhookRequest({ update_type: 'bot_started', chat_id: 42 }, env, 'wrong'),
      env,
      fetcher,
    );

    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('отвечает на bot_started кнопкой мини-приложения', async () => {
    const env = createEnv();
    const fetcher = vi.fn<typeof fetch>(async () => maxResponse({ message: {} }));
    const response = await handleRequest(
      webhookRequest({ update_type: 'bot_started', chat_id: 42 }, env),
      env,
      fetcher,
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledWith(
      'https://platform-api2.max.ru/messages?chat_id=42',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          text: 'Привет! Это MaxTown, помощник жильцов дома. Войти смогут участники Домового чата, в котором я администратор.',
          attachments: [
            {
              type: 'inline_keyboard',
              payload: {
                buttons: [
                  [{ type: 'open_app', text: 'Открыть MaxTown', web_app: 't25_hakaton_max_bot' }],
                ],
              },
            },
          ],
        }),
      }),
    );
  });

  it('подтверждает неизвестное событие без вызова MAX API', async () => {
    const env = createEnv();
    const fetcher = vi.fn<typeof fetch>();
    const response = await handleRequest(webhookRequest({ update_type: 'message_created' }, env), env, fetcher);

    expect(response.status).toBe(200);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('подключает Дом по резервной команде /connect в групповом чате', async () => {
    const store = new MemoryHouseChatStore();
    const env = createEnv(store, { DADATA_API_KEY: 'dadata-key' });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ is_admin: true }))
      .mockResolvedValueOnce(Response.json({ type: 'chat', status: 'active', title: 'Казань, Лесная, 12' }))
      .mockResolvedValueOnce(Response.json({ suggestions: [dadataHouse()] }))
      .mockResolvedValueOnce(maxResponse({ message: {} }));

    const response = await handleRequest(
      webhookRequest(
        {
          update_type: 'message_created',
          message: {
            sender: { user_id: 67890, username: 'anna', is_bot: false },
            recipient: { chat_id: -42, chat_type: 'chat' },
            body: { text: '/connect' },
          },
        },
        env,
      ),
      env,
      fetcher,
    );

    expect(response.status).toBe(200);
    expect(store.values.get('house-chat:-42')?.metadata).toEqual(
      expect.objectContaining({
        houseId: 'max-chat:-42',
        houseLabel: 'г Казань, ул Лесная, д 12',
      }),
    );
    expect(store.values.get('house-chat:-42')?.metadata).not.toEqual(
      expect.objectContaining({ createdByUserId: 67890 }),
    );
  });

  it('не назначает отправителя /connect создателем уже существующего Дома', async () => {
    const store = new MemoryHouseChatStore();
    await seedHouse(store, -42, 'Дом на Лесной, 12');
    const env = createEnv(store);
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ is_admin: true }));

    const response = await handleRequest(
      webhookRequest(
        {
          update_type: 'message_created',
          message: {
            sender: { user_id: 67890, username: 'anna', is_bot: false },
            recipient: { chat_id: -42, chat_type: 'chat' },
            body: { text: '/connect' },
          },
        },
        env,
      ),
      env,
      fetcher,
    );

    expect(response.status).toBe(200);
    expect(store.values.get('house-chat:-42')?.metadata).not.toEqual(
      expect.objectContaining({ createdByUserId: 67890 }),
    );
    expect(store.values.has('house-creator:-42')).toBe(false);
  });

  it('регистрирует только нужные события webhook', async () => {
    const env = createEnv();
    const fetcher = vi.fn<typeof fetch>(async () => maxResponse());
    const request = new Request('https://maxtown.example/api/max/register', {
      method: 'POST',
      headers: { 'x-max-bot-api-secret': env.MAX_WEBHOOK_SECRET },
    });

    const response = await handleRequest(request, env, fetcher);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      webhookUrl: 'https://maxtown.example/api/max/webhook',
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://platform-api2.max.ru/subscriptions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          url: 'https://maxtown.example/api/max/webhook',
          update_types: [
            'bot_started',
            'bot_added',
            'bot_removed',
            'bot_admin_permissions_changed',
            'message_created',
          ],
          secret: env.MAX_WEBHOOK_SECRET,
        }),
      }),
    );
  });

  it('повторяет запрос через совместимый домен при TLS 526', async () => {
    const env = createEnv();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(maxResponse({ error: 'invalid SSL certificate' }, 526))
      .mockResolvedValueOnce(maxResponse());
    const request = new Request('https://maxtown.example/api/max/register', {
      method: 'POST',
      headers: { 'x-max-bot-api-secret': env.MAX_WEBHOOK_SECRET },
    });

    const response = await handleRequest(request, env, fetcher);

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenNthCalledWith(1, 'https://platform-api2.max.ru/subscriptions', expect.any(Object));
    expect(fetcher).toHaveBeenNthCalledWith(2, 'https://platform-api.max.ru/subscriptions', expect.any(Object));
  });

  it('определяет точный адрес из названия, создаёт Дом по chat_id и публикует приглашение', async () => {
    const store = new MemoryHouseChatStore();
    const env = createEnv(store, { DADATA_API_KEY: 'dadata-key' });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ is_admin: true }))
      .mockResolvedValueOnce(Response.json({ type: 'chat', status: 'active', title: 'Казань, Лесная, 12' }))
      .mockResolvedValueOnce(Response.json({ suggestions: [dadataHouse()] }))
      .mockResolvedValueOnce(maxResponse({ message: {} }));

    const response = await handleRequest(
      webhookRequest({ update_type: 'bot_added', chat_id: -42, user: { user_id: 67890 } }, env),
      env,
      fetcher,
    );

    expect(response.status).toBe(200);
    expect(store.values.get('house-chat:-42')?.metadata).toEqual({
      houseId: 'max-chat:-42',
      houseLabel: 'г Казань, ул Лесная, д 12',
      chatId: -42,
      garHouseGuid: 'house-guid-12',
      locality: 'Респ Татарстан, г Казань',
      createdByUserId: 67890,
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      4,
      'https://platform-api2.max.ru/messages?chat_id=-42',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('Администраторы чата получают роль Администратора Дома'),
      }),
    );
  });

  it('изолирует два чата с одинаковым адресом как разные Дома', async () => {
    const store = new MemoryHouseChatStore();
    const env = createEnv(store, { DADATA_API_KEY: 'dadata-key' });
    const connect = async (chatId: number) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json({ is_admin: true }))
        .mockResolvedValueOnce(Response.json({ type: 'chat', status: 'active', title: 'Казань, Лесная, 12' }))
        .mockResolvedValueOnce(Response.json({ suggestions: [dadataHouse()] }))
        .mockResolvedValueOnce(maxResponse({ message: {} }));
      return handleRequest(
        webhookRequest({ update_type: 'bot_admin_permissions_changed', chat_id: chatId }, env),
        env,
        fetcher,
      );
    };

    expect((await connect(-42)).status).toBe(200);
    expect((await connect(-77)).status).toBe(200);
    expect(store.values.get('house-chat:-42')?.metadata).toEqual(
      expect.objectContaining({ houseId: 'max-chat:-42', houseLabel: 'г Казань, ул Лесная, д 12' }),
    );
    expect(store.values.get('house-chat:-77')?.metadata).toEqual(
      expect.objectContaining({ houseId: 'max-chat:-77', houseLabel: 'г Казань, ул Лесная, д 12' }),
    );
  });

  it('при неоднозначном названии просит администратора выбрать адрес', async () => {
    const store = new MemoryHouseChatStore();
    const env = createEnv(store, { DADATA_API_KEY: 'dadata-key' });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ is_admin: true }))
      .mockResolvedValueOnce(Response.json({ type: 'chat', status: 'active', title: 'Дом на Лесной' }))
      .mockResolvedValueOnce(
        Response.json({
          suggestions: [dadataHouse('г Казань, ул Лесная, д 12'), dadataHouse('г Казань, ул Лесная, д 14', 'house-guid-14')],
        }),
      )
      .mockResolvedValueOnce(maxResponse({ message: {} }));

    const response = await handleRequest(
      webhookRequest({ update_type: 'bot_admin_permissions_changed', chat_id: -42 }, env),
      env,
      fetcher,
    );

    expect(response.status).toBe(200);
    expect(store.values.has('house-chat:-42')).toBe(false);
    expect(store.values.get('house-onboarding:-42')?.metadata).toEqual({
      chatId: -42,
      chatTitle: 'Дом на Лесной',
      status: 'address-required',
    });
    const messageBody = String(fetcher.mock.calls[3]?.[1]?.body);
    expect(messageBody).toContain('выберите адрес Дома');
    expect(messageBody).toContain('setup_-42');
  });

  it('показывает незавершённое подключение только администратору чата', async () => {
    const store = new MemoryHouseChatStore();
    await seedOnboarding(store, -42, 'Дом на Лесной');
    const env = createEnv(store);
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ members: [{ user_id: 67890, is_admin: true, is_owner: false, is_bot: false }] }),
    );

    const response = await handleRequest(
      new Request('https://maxtown.example/api/auth/max', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ initData: await signedInitData(env.BOT_TOKEN) }),
      }),
      env,
      fetcher,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        houses: [],
        pendingHouseSetups: [{ chatId: -42, chatTitle: 'Дом на Лесной' }],
      }),
    );
  });

  it('возвращает подсказки адреса администратору незавершённого чата', async () => {
    const store = new MemoryHouseChatStore();
    await seedOnboarding(store, -42);
    const env = createEnv(store, { DADATA_API_KEY: 'dadata-key' });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ members: [{ user_id: 67890, is_admin: true, is_owner: false, is_bot: false }] }),
      )
      .mockResolvedValueOnce(Response.json({ is_admin: true }))
      .mockResolvedValueOnce(Response.json({ suggestions: [dadataHouse()] }));

    const response = await handleRequest(
      new Request('https://maxtown.example/api/house-setup/suggestions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          initData: await signedInitData(env.BOT_TOKEN),
          chatId: -42,
          query: 'Казань, Лесная, 12',
        }),
      }),
      env,
      fetcher,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      suggestions: [
        {
          value: 'г Казань, ул Лесная, д 12',
          locality: 'Респ Татарстан, г Казань',
          garHouseGuid: 'house-guid-12',
        },
      ],
    });
  });

  it('после выбора адреса автоматически создаёт Дом для чата', async () => {
    const store = new MemoryHouseChatStore();
    await seedOnboarding(store, -42);
    const env = createEnv(store, { DADATA_API_KEY: 'dadata-key' });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ members: [{ user_id: 67890, is_admin: true, is_owner: false, is_bot: false }] }),
      )
      .mockResolvedValueOnce(Response.json({ is_admin: true }))
      .mockResolvedValueOnce(Response.json({ suggestions: [dadataHouse()] }))
      .mockResolvedValueOnce(maxResponse({ message: {} }));

    const response = await handleRequest(
      new Request('https://maxtown.example/api/house-setup/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          initData: await signedInitData(env.BOT_TOKEN),
          chatId: -42,
          garHouseGuid: 'house-guid-12',
        }),
      }),
      env,
      fetcher,
    );

    expect(response.status).toBe(200);
    expect(store.values.has('house-onboarding:-42')).toBe(false);
    expect(store.values.get('house-chat:-42')?.metadata).toEqual(
      expect.objectContaining({
        houseId: 'max-chat:-42',
        houseLabel: 'г Казань, ул Лесная, д 12',
        garHouseGuid: 'house-guid-12',
      }),
    );
  });

  it('не подключает чат, пока бот не администратор', async () => {
    const store = new MemoryHouseChatStore();
    const env = createEnv(store);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ is_admin: false }))
      .mockResolvedValueOnce(maxResponse({ message: {} }));

    const response = await handleRequest(
      webhookRequest({ update_type: 'bot_added', chat_id: -42 }, env),
      env,
      fetcher,
    );

    expect(response.status).toBe(200);
    expect(store.values.has('house-chat:-42')).toBe(false);
    const [, messageInit] = fetcher.mock.calls[1] ?? [];
    expect(messageInit?.body).toContain('выдайте боту права администратора');
  });

  it('удаляет чат из реестра, если права администратора сняли', async () => {
    const store = new MemoryHouseChatStore();
    await seedHouse(store, -42, 'Домовой чат', { createdByUserId: 67890 });
    const env = createEnv(store);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ is_admin: false }))
      .mockResolvedValueOnce(maxResponse({ message: {} }));

    const response = await handleRequest(
      webhookRequest({ update_type: 'bot_admin_permissions_changed', chat_id: -42 }, env),
      env,
      fetcher,
    );

    expect(response.status).toBe(200);
    expect(store.values.has('house-chat:-42')).toBe(false);
    expect(store.values.get('house-creator:-42')?.metadata).toEqual({ chatId: -42, userId: 67890 });
  });

  it('удаляет чат из реестра при удалении бота', async () => {
    const store = new MemoryHouseChatStore();
    await seedHouse(store, -42);
    const env = createEnv(store);
    const response = await handleRequest(
      webhookRequest({ update_type: 'bot_removed', chat_id: -42 }, env),
      env,
    );

    expect(response.status).toBe(200);
    expect(store.values.has('house-chat:-42')).toBe(false);
  });

  it('даёт доступ участнику зарегистрированного Домового чата', async () => {
    const store = new MemoryHouseChatStore();
    await seedHouse(store, -42, 'Дом на Лесной, 12');
    const env = createEnv(store);
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ members: [{ user_id: 67890, is_admin: true, is_owner: false, is_bot: false }] }),
    );
    const response = await handleRequest(
      new Request('https://maxtown.example/api/auth/max', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ initData: await signedInitData(env.BOT_TOKEN) }),
      }),
      env,
      fetcher,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      user: {
        id: 67890,
        firstName: 'Анна',
        lastName: 'Иванова',
        username: 'anna',
        photoUrl: 'https://example.com/anna.jpg',
      },
      houses: [
        {
          houseId: 'max-chat:-42',
          houseLabel: 'Дом на Лесной, 12',
          maxChatRole: 'administrator',
          canManageHouse: true,
          apartment: null,
          roles: ['admin'],
        },
      ],
      pendingHouseSetups: [],
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://platform-api2.max.ru/chats/-42/members?user_ids=67890',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('назначает роли Жильца, Администратора Дома и УК из данных Домового чата', async () => {
    const scenarios = [
      {
        extra: {},
        member: { user_id: 67890, is_admin: false, is_owner: false, is_bot: false },
        roles: ['resident'],
        canManageHouse: false,
      },
      {
        extra: { createdByUserId: 67890 },
        member: { user_id: 67890, is_admin: false, is_owner: false, is_bot: false },
        roles: ['admin'],
        canManageHouse: true,
      },
      {
        extra: { managementCompanyUserId: 67890 },
        member: { user_id: 67890, is_admin: false, is_owner: false, is_bot: false },
        roles: ['management-company'],
        canManageHouse: false,
      },
      {
        extra: { managementCompanyUserId: 67890 },
        member: { user_id: 67890, is_admin: true, is_owner: false, is_bot: false },
        roles: ['admin', 'management-company'],
        canManageHouse: true,
      },
    ] as const;

    for (const scenario of scenarios) {
      const store = new MemoryHouseChatStore();
      await seedHouse(store, -42, 'Дом на Лесной, 12', scenario.extra);
      const env = createEnv(store);
      const fetcher = vi.fn<typeof fetch>(async () => Response.json({ members: [scenario.member] }));
      const response = await handleRequest(
        new Request('https://maxtown.example/api/auth/max', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ initData: await signedInitData(env.BOT_TOKEN) }),
        }),
        env,
        fetcher,
      );

      expect(response.status).toBe(200);
      const body = await response.json() as { houses: Array<{ roles: string[]; canManageHouse: boolean }> };
      expect(body.houses[0]).toEqual(
        expect.objectContaining({ roles: [...scenario.roles], canManageHouse: scenario.canManageHouse }),
      );
    }
  });

  it('позволяет Администратору Дома назначить аккаунт УК командой /set_uk', async () => {
    const store = new MemoryHouseChatStore();
    await seedHouse(store, -42, 'Дом на Лесной, 12');
    const env = createEnv(store);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ members: [{ user_id: 67890, is_admin: true, is_owner: false, is_bot: false }] }),
      )
      .mockResolvedValueOnce(
        Response.json({
          members: [
            { user_id: 67890, username: 'anna', is_admin: true, is_owner: false, is_bot: false },
            { user_id: 777, username: 'service_uk', first_name: 'УК Сервис', is_bot: false },
          ],
        }),
      )
      .mockResolvedValueOnce(maxResponse({ message: {} }));

    const response = await handleRequest(
      webhookRequest(
        {
          update_type: 'message_created',
          message: {
            sender: { user_id: 67890, username: 'anna', is_bot: false },
            recipient: { chat_id: -42, chat_type: 'chat' },
            body: { text: '/set_uk @service_uk' },
          },
        },
        env,
      ),
      env,
      fetcher,
    );

    expect(response.status).toBe(200);
    expect(store.values.get('house-chat:-42')?.metadata).toEqual(
      expect.objectContaining({ managementCompanyUserId: 777, managementCompanyUsername: 'service_uk' }),
    );
    expect(String(fetcher.mock.calls[2]?.[1]?.body)).toContain('@service_uk назначен аккаунтом УК');
  });

  it('не позволяет Жильцу назначить аккаунт УК', async () => {
    const store = new MemoryHouseChatStore();
    await seedHouse(store, -42, 'Дом на Лесной, 12');
    const env = createEnv(store);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ members: [{ user_id: 67890, is_admin: false, is_owner: false, is_bot: false }] }),
      )
      .mockResolvedValueOnce(maxResponse({ message: {} }));

    const response = await handleRequest(
      webhookRequest(
        {
          update_type: 'message_created',
          message: {
            sender: { user_id: 67890, username: 'anna', is_bot: false },
            recipient: { chat_id: -42, chat_type: 'chat' },
            body: { text: '/set_uk @service_uk' },
          },
        },
        env,
      ),
      env,
      fetcher,
    );

    expect(response.status).toBe(200);
    expect(store.values.get('house-chat:-42')?.metadata).not.toEqual(
      expect.objectContaining({ managementCompanyUserId: expect.any(Number) }),
    );
    expect(String(fetcher.mock.calls[1]?.[1]?.body)).toContain('только Администратор Дома');
  });

  it('закрывает доступ человеку вне зарегистрированных чатов', async () => {
    const store = new MemoryHouseChatStore();
    await seedHouse(store, -42);
    const env = createEnv(store);
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ members: [] }));
    const response = await handleRequest(
      new Request('https://maxtown.example/api/auth/max', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ initData: await signedInitData(env.BOT_TOKEN) }),
      }),
      env,
      fetcher,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'Доступ закрыт: добавьте бота MaxTown в домовой чат или попросите администратора сделать это',
    });
  });

  it('отклоняет изменённые initData до обращения к MAX API', async () => {
    const env = createEnv();
    const fetcher = vi.fn<typeof fetch>();
    const initData = (await signedInitData(env.BOT_TOKEN)).replace('query-1', 'query-2');
    const response = await handleRequest(
      new Request('https://maxtown.example/api/auth/max', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ initData }),
      }),
      env,
      fetcher,
    );

    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('возвращает 502, когда MAX API недоступен', async () => {
    const env = createEnv();
    const fetcher = vi.fn<typeof fetch>(async () => maxResponse({ message: 'failed' }, 500));
    const response = await handleRequest(
      webhookRequest({ update_type: 'bot_started', chat_id: 42 }, env),
      env,
      fetcher,
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: 'Не удалось обработать событие MAX' });
  });
});
