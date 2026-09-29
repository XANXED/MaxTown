import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentMaxInitData, launchPoll, launchStartParam, waitForMaxInitData } from './maxLaunch.ts';
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

  it('открывает Опрос из кнопки бота: Дом и Опрос в параметре запуска', () => {
    const houseId = '3ce05158-0792-429c-9129-99c12e1e5366';
    const pollId = 'a1b2c3d4-0000-4000-8000-000000000001';
    vi.stubGlobal('window', { WebApp: { initDataUnsafe: { start_param: `poll_${houseId}_${pollId}` } }, location: { hash: '', search: '' } });
    expect(launchStartParam()).toBe(`poll_${houseId}_${pollId}`);
    expect(launchPoll()).toEqual({ houseId, pollId });
  });

  it('не принимает за Опрос чужой параметр запуска', () => {
    vi.stubGlobal('window', { WebApp: { initDataUnsafe: { start_param: 'inv_abc123' } }, location: { hash: '', search: '' } });
    expect(launchPoll()).toBeNull();
  });
});
