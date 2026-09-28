import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentMaxInitData, waitForMaxInitData } from './maxLaunch.ts';
import { launchSetupChatId } from './houseSetup.ts';

describe('запуск внутри MAX', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('сохраняет initData и стартовый чат при смене хеша роутером без готового MAX Bridge', () => {
    const location = { hash: '#WebAppData=signed&WebAppStartParam=setup_-42', search: '' };
    vi.stubGlobal('window', { location });
    expect(currentMaxInitData()).toBe('signed');
    location.hash = '#/';
    expect(currentMaxInitData()).toBe('signed');
    expect(launchSetupChatId()).toBe(-42);
  });

  it('дожидается initData, если MAX Bridge инициализируется после React', async () => {
    const webApp = { initData: '' };
    vi.stubGlobal('window', {
      WebApp: webApp,
      location: { hash: '', search: '' },
    });
    const wait = vi.fn(async () => {
      webApp.initData = 'delayed-signed-init-data';
    });

    await expect(waitForMaxInitData(wait, 2)).resolves.toBe('delayed-signed-init-data');
    expect(wait).toHaveBeenCalledOnce();
  });
});
