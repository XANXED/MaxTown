import { afterEach, describe, expect, it, vi } from 'vitest';
import { authorizeCurrentMaxUser, MaxAuthRequestError } from './auth.ts';

describe('клиент авторизации MAX', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('не обращается к API в браузерном демо без initData', async () => {
    const fetcher = vi.fn<typeof fetch>();

    await expect(authorizeCurrentMaxUser(fetcher, '')).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('передаёт серверу только подписанный initData', async () => {
    const auth = {
      user: { id: 7, firstName: 'Анна' },
      houses: [
        {
          houseId: 'house-1',
          houseLabel: 'Дом на Лесной, 12',
          maxChatRole: 'member',
          canManageHouse: false,
          apartment: null,
          roles: ['resident'],
        },
      ],
      pendingHouseSetups: [],
    };
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(auth));

    await expect(authorizeCurrentMaxUser(fetcher, 'signed-init-data')).resolves.toEqual(auth);
    expect(fetcher).toHaveBeenCalledWith('/api/auth/max', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initData: 'signed-init-data' }),
      signal: expect.any(AbortSignal),
    });
  });

  it('авторизуется по WebAppData из URL, если мост MAX ещё не инициализирован', async () => {
    const auth = {
      user: { id: 7, firstName: 'Анна' },
      houses: [],
      pendingHouseSetups: [{ chatId: -42, chatTitle: 'Домовой чат' }],
    };
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(auth));
    vi.stubGlobal('window', {
      WebApp: undefined,
      location: { hash: '#WebAppData=signed-init-data&WebAppPlatform=web' },
    });

    await expect(authorizeCurrentMaxUser(fetcher)).resolves.toEqual(auth);
    expect(fetcher).toHaveBeenCalledWith('/api/auth/max', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initData: 'signed-init-data' }),
      signal: expect.any(AbortSignal),
    });
  });

  it('сохраняет статус и сообщение серверной ошибки', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ error: 'Данные запуска MAX недействительны или устарели' }, { status: 401 }),
    );

    const promise = authorizeCurrentMaxUser(fetcher, 'bad-init-data');
    await expect(promise).rejects.toEqual(
      new MaxAuthRequestError('Данные запуска MAX недействительны или устарели', 401),
    );
  });
});
