import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForMaxInitData } from './maxLaunch.ts';

describe('запуск внутри MAX', () => {
  afterEach(() => vi.unstubAllGlobals());

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
