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

  it('ищет адрес только с подписанным initData и идентификатором чата', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ suggestions: [suggestion] }));

    await expect(suggestSetupAddresses(setup, 'Лесная 12', fetcher, 'signed')).resolves.toEqual([suggestion]);
    expect(fetcher).toHaveBeenCalledWith('/api/house-setup/suggestions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initData: 'signed', chatId: -42, query: 'Лесная 12' }),
    });
  });

  it('подтверждает GUID выбранного дома, а не произвольную подпись', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ house: { houseId: 'max-chat:-42', houseLabel: suggestion.value } }),
    );

    await confirmSetupAddress(setup, suggestion, fetcher, 'signed');
    expect(fetcher).toHaveBeenCalledWith('/api/house-setup/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initData: 'signed', chatId: -42, garHouseGuid: 'guid-12' }),
    });
  });
});
