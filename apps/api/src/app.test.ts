import { describe, expect, it, vi } from 'vitest';
import { buildApp, type ApiConfig } from './app.ts';
import { parseHouseChatBindings } from './house-chat.ts';
import { MemoryHouseChatRegistry } from './house-chat-registry.ts';
import { BOT_TOKEN, NOW, signedInitData } from './test-helpers.ts';

const linkedChat = { houseId: 'max-chat:-42', houseLabel: 'Дом на Лесной, 12', chatId: -42 };

function apiConfig(chats = [linkedChat]): ApiConfig {
  return {
    botToken: BOT_TOKEN,
    houseChatRegistry: new MemoryHouseChatRegistry(chats),
    internalApiSecret: 'internal-secret',
    maxInitDataTtlSeconds: 900,
  };
}

describe('авторизация MAX', () => {
  it('даёт Доступ к Дому и роль Администратора владельцу прав в чате', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        members: [{ user_id: 67890, first_name: 'Анна', is_admin: true, is_owner: false, is_bot: false }],
      }),
    );
    const app = buildApp(apiConfig(), { fetcher, nowSeconds: () => NOW });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/max',
      payload: { initData: signedInitData() },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
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
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://platform-api2.max.ru/chats/-42/members?user_ids=67890');
    expect(init).toEqual({ headers: { authorization: BOT_TOKEN } });
    await app.close();
  });

  it('запрещает вход человеку, которого нет ни в одном Домовом чате', async () => {
    const app = buildApp(apiConfig(), {
      fetcher: vi.fn<typeof fetch>(async () => Response.json({ members: [] })),
      nowSeconds: () => NOW,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/max',
      payload: { initData: signedInitData() },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: 'Доступ закрыт: добавьте бота MaxTown в домовой чат или попросите администратора сделать это',
    });
    await app.close();
  });

  it('отклоняет неподписанные данные до обращения к MAX API', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const app = buildApp(apiConfig(), { fetcher, nowSeconds: () => NOW });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/max',
      payload: { initData: 'user=%7B%7D&hash=bad' },
    });

    expect(response.statusCode).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
    await app.close();
  });

  it('закрывает доступ при ошибке проверки членства в MAX', async () => {
    const app = buildApp(apiConfig(), {
      fetcher: vi.fn<typeof fetch>(async () => Response.json({ message: 'forbidden' }, { status: 403 })),
      nowSeconds: () => NOW,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/max',
      payload: { initData: signedInitData() },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: 'Не удалось проверить участие в Домовом чате' });
    await app.close();
  });

  it('сообщает, что авторизация не настроена, если нет BOT_TOKEN', async () => {
    const app = buildApp({ ...apiConfig(), botToken: '' }, { nowSeconds: () => NOW });
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/max',
      payload: { initData: signedInitData() },
    });

    expect(response.statusCode).toBe(503);
    await app.close();
  });
});

describe('настройка Домовых чатов', () => {
  it('читает начальные связи из переменной окружения', () => {
    expect(
      parseHouseChatBindings(
        JSON.stringify([{ houseId: 'house-1', houseLabel: ' Дом на Лесной, 12 ', chatId: -42 }]),
      ),
    ).toEqual([{ houseId: 'house-1', houseLabel: 'Дом на Лесной, 12', chatId: -42 }]);
  });

  it('не допускает один чат сразу у двух Домов', () => {
    expect(() =>
      parseHouseChatBindings(
        JSON.stringify([
          { houseId: 'house-1', houseLabel: 'Дом 1', chatId: -42 },
          { houseId: 'house-2', houseLabel: 'Дом 2', chatId: -42 },
        ]),
      ),
    ).toThrow('повторяющийся chatId');
  });

  it('бот регистрирует новый чат, после чего его участник получает вход', async () => {
    const registry = new MemoryHouseChatRegistry();
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ members: [{ user_id: 67890, first_name: 'Анна', is_bot: false }] }),
    );
    const app = buildApp(
      { ...apiConfig([]), houseChatRegistry: registry },
      { fetcher, nowSeconds: () => NOW },
    );

    const registration = await app.inject({
      method: 'POST',
      url: '/api/internal/max/chats',
      headers: { 'x-maxtown-internal-secret': 'internal-secret' },
      payload: { chatId: -77, chatTitle: 'Дом на Садовой, 8' },
    });
    expect(registration.statusCode).toBe(201);

    const authorization = await app.inject({
      method: 'POST',
      url: '/api/auth/max',
      payload: { initData: signedInitData() },
    });
    expect(authorization.statusCode).toBe(200);
    expect(authorization.json().houses).toEqual([
      {
        houseId: 'max-chat:-77',
        houseLabel: 'Дом на Садовой, 8',
        maxChatRole: 'member',
        canManageHouse: false,
        apartment: null,
        roles: ['resident'],
      },
    ]);
    await app.close();
  });

  it('не позволяет регистрировать чат без внутреннего секрета', async () => {
    const app = buildApp(apiConfig([]));
    const response = await app.inject({
      method: 'POST',
      url: '/api/internal/max/chats',
      headers: { 'x-maxtown-internal-secret': 'wrong' },
      payload: { chatId: -77, chatTitle: 'Дом на Садовой, 8' },
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });
});
