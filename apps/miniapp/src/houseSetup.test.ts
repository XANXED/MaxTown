import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmSetupAddress, launchSetupChatId, suggestSetupAddresses } from './houseSetup.ts';

const setup = { chatId: -42, chatTitle: 'Лесная, 12' };
const suggestion = {
  value: 'г Москва, ул Лесная, д 12',
  locality: 'г Москва',
  garHouseGuid: 'guid-12',
};

describe('настройка адреса Домового чата', () => {
  afterEach(() => vi.unstubAllGlobals());

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

  it('ищет адрес только с подписанным initData и идентификатором чата', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ suggestions: [suggestion] }));

    await expect(suggestSetupAddresses(setup, 'Лесная 12', fetcher, 'signed')).resolves.toEqual([suggestion]);
    expect(fetcher).toHaveBeenCalledWith('/api/house-setup/suggestions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initData: 'signed', chatId: -42, query: 'Лесная 12' }),
      signal: expect.any(AbortSignal),
    });
  });

  it('подтверждает GUID выбранного дома, а не произвольную подпись', async () => {
    const access = {
      houseId: 'max-chat:-42', houseLabel: suggestion.value, maxChatRole: 'administrator',
      canManageHouse: true, apartment: null, roles: ['admin'],
    };
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ house: { houseId: 'max-chat:-42', houseLabel: suggestion.value }, access }),
    );

    await expect(confirmSetupAddress(setup, suggestion, fetcher, 'signed')).resolves.toEqual(access);
    expect(fetcher).toHaveBeenCalledWith('/api/house-setup/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initData: 'signed', chatId: -42, garHouseGuid: 'guid-12' }),
      signal: expect.any(AbortSignal),
    });
  });
});
