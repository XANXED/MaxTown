import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSession, setSession } from './auth/session.ts';
import { confirmSetupAddress, launchSetupChatId, suggestSetupAddresses } from './houseSetup.ts';

const setup = { chatId: -42, chatTitle: 'Лесная, 12' };
const suggestion = {
  value: 'г Москва, ул Лесная, д 12',
  locality: 'г Москва',
  garHouseGuid: 'guid-12',
};

describe('настройка адреса Домового чата', () => {
  // Вне dev-демо: запросы уходят на сервер, а не отдают примеры.
  beforeEach(() => { setSession('Q'.repeat(43)); });
  afterEach(() => {
    clearSession();
    vi.unstubAllGlobals();
  });

  it('открывает панель настройки по WebAppStartParam из URL MAX', () => {
    vi.stubGlobal('window', {
      WebApp: { initDataUnsafe: {} },
      location: { search: '?WebAppStartParam=setup_-79477452194309' },
    });

    expect(launchSetupChatId()).toBe(-79477452194309);
  });

  it('выбирает текущий чат, а не start_param предыдущего запуска в SDK', () => {
    vi.stubGlobal('window', {
      WebApp: { initData: 'start_param=setup_-99', initDataUnsafe: { start_param: 'setup_-99' } },
      location: { hash: '#/welcome?WebAppStartParam=setup_-42#WebAppData=start_param%3Dsetup_-42', search: '' },
    });
    expect(launchSetupChatId()).toBe(-42);
  });

  it('не использует старый чат из SDK, когда текущий запуск не содержит чата', () => {
    vi.stubGlobal('window', {
      WebApp: { initData: 'start_param=setup_-99', initDataUnsafe: { start_param: 'setup_-99' } },
      location: { hash: '#/welcome#WebAppData=hash%3Dcurrent-signature', search: '' },
    });
    expect(launchSetupChatId()).toBeNull();
  });

  it('ищет адрес по сессии: в запросе только чат и строка поиска', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ suggestions: [suggestion] }));

    await expect(suggestSetupAddresses(setup, 'Лесная 12', fetcher)).resolves.toEqual([suggestion]);
    expect(fetcher).toHaveBeenCalledWith('/api/house-setup/suggestions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId: -42, query: 'Лесная 12' }),
      signal: expect.any(AbortSignal),
    });
  });

  it('подтверждает GUID выбранного дома, а не произвольную подпись', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ houseId: 'house-1' }));

    await expect(confirmSetupAddress(setup, suggestion, fetcher)).resolves.toBe('house-1');
    expect(fetcher).toHaveBeenCalledWith('/api/house-setup/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId: -42, garHouseGuid: 'guid-12' }),
      signal: expect.any(AbortSignal),
    });
  });

  it('объясняет отказ сервера по-русски', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ error: 'house_setup_forbidden' }, { status: 403 }));

    await expect(suggestSetupAddresses(setup, 'Лесная 12', fetcher)).rejects.toThrow('Выбрать адрес может только администратор этого чата');
  });
});
