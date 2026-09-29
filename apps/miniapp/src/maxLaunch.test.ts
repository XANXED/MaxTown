import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentMaxInitData, maxNavigationHash, waitForMaxInitData } from './maxLaunch.ts';
import { launchSetupChatId } from './houseSetup.ts';

describe('запуск внутри MAX', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(['#', '?', '&'])('читает данные MAX после маршрута и разделителя %s', (separator) => {
    const signed = new URLSearchParams({
      user: JSON.stringify({ id: 42, first_name: 'Анна + #?&%' }),
      hash: 'test-signature',
    }).toString();
    const location = {
      hash: `#/welcome?WebAppStartParam=setup_-42${separator}WebAppData=${encodeURIComponent(signed)}&WebAppPlatform=web`,
      search: '',
    };
    vi.stubGlobal('window', { WebApp: { initData: '' }, location });

    expect(currentMaxInitData()).toBe(signed);
    expect(launchSetupChatId()).toBe(-42);

    // После перехода и перезагрузки остаётся обычный hash, читаемый и SDK MAX.
    const nextHash = maxNavigationHash('#/');
    vi.stubGlobal('window', { location: { hash: nextHash, search: '' } });
    expect(currentMaxInitData()).toBe(signed);
    expect(launchSetupChatId()).toBe(-42);
  });

  it('не подменяет текущий запуск устаревшими данными из хранилища MAX Bridge', () => {
    vi.stubGlobal('window', {
      WebApp: { initData: 'previous-launch' },
      location: { hash: '#/welcome#WebAppData=current-launch', search: '' },
    });
    expect(currentMaxInitData()).toBe('current-launch');
  });

  it('не принимает вложенный параметр внутри закодированного значения за данные запуска', () => {
    vi.stubGlobal('window', {
      location: { hash: '#/welcome?WebAppStartParam=' + encodeURIComponent('setup_-42#WebAppData=not-launch-data'), search: '' },
    });
    expect(currentMaxInitData()).toBeUndefined();
    expect(launchSetupChatId()).toBeNull();
  });

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
