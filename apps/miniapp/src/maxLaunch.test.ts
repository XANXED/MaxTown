import { afterEach, describe, expect, it, vi } from 'vitest';
import { launchInviteCode } from './data/join.ts';
import {
  currentMaxInitData,
  isMaxRuntime,
  launchPoll,
  launchStartParam,
  maxNavigationHash,
  waitForMaxInitData,
} from './maxLaunch.ts';
import { launchSetupChatId } from './houseSetup.ts';

describe('запуск внутри MAX', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('считает production-сборку средой MAX до появления initData', () => {
    vi.stubEnv('PROD', true);
    vi.stubGlobal('window', { location: { hash: '', search: '' } });

    expect(isMaxRuntime()).toBe(true);
  });

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

  it('открывает Опрос из кнопки бота: Дом и Опрос в параметре запуска', () => {
    const houseId = '3ce05158-0792-429c-9129-99c12e1e5366';
    const pollId = 'a1b2c3d4-0000-4000-8000-000000000001';
    vi.stubGlobal('window', { WebApp: { initDataUnsafe: { start_param: `poll_${houseId}_${pollId}` } }, location: { hash: '', search: '' } });
    expect(launchStartParam()).toBe(`poll_${houseId}_${pollId}`);
    expect(launchPoll()).toEqual({ houseId, pollId });
  });

  it('выбирает текущие Опрос и Приглашение вместо start_param предыдущего запуска', () => {
    const previousHouseId = '11111111-1111-4111-8111-111111111111';
    const previousPollId = '22222222-2222-4222-8222-222222222222';
    const houseId = '3ce05158-0792-429c-9129-99c12e1e5366';
    const pollId = 'a1b2c3d4-0000-4000-8000-000000000001';
    const poll = `poll_${houseId}_${pollId}`;
    vi.stubGlobal('window', {
      WebApp: {
        initData: `start_param=poll_${previousHouseId}_${previousPollId}`,
        initDataUnsafe: { start_param: `poll_${previousHouseId}_${previousPollId}` },
      },
      location: {
        hash: `#/community?WebAppStartParam=${poll}#WebAppData=${encodeURIComponent(`start_param=${poll}&hash=current`)}`,
        search: '',
      },
    });
    expect(launchPoll()).toEqual({ houseId, pollId });

    vi.stubGlobal('window', {
      WebApp: { initData: 'start_param=inv_previous', initDataUnsafe: { start_param: 'inv_previous' } },
      location: {
        hash: '#/join?WebAppStartParam=inv_current#WebAppData=start_param%3Dinv_current%26hash%3Dcurrent',
        search: '',
      },
    });
    expect(launchInviteCode()).toBe('current');
  });

  it('не использует устаревший start_param Bridge, если текущий запуск его не содержит', () => {
    vi.stubGlobal('window', {
      WebApp: { initData: 'start_param=inv_previous', initDataUnsafe: { start_param: 'inv_previous' } },
      location: { hash: '#/join#WebAppData=hash%3Dcurrent', search: '' },
    });
    expect(launchStartParam()).toBeUndefined();
    expect(launchInviteCode()).toBeNull();
  });

  it('не принимает за Опрос чужой параметр запуска', () => {
    vi.stubGlobal('window', { WebApp: { initDataUnsafe: { start_param: 'inv_abc123' } }, location: { hash: '', search: '' } });
    expect(launchPoll()).toBeNull();
  });
});
