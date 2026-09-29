import { describe, expect, it } from 'vitest';
import { validateMaxInitData } from './max-init-data.ts';
import { BOT_TOKEN, NOW, signedInitData } from '../max/test-helpers.ts';

describe('проверка initData MAX', () => {
  it('возвращает подтверждённого пользователя для корректной подписи', () => {
    const result = validateMaxInitData(signedInitData(), BOT_TOKEN, { nowSeconds: NOW });

    expect(result).toEqual({
      ok: true,
      data: {
        authDate: NOW,
        user: {
          id: 67890,
          firstName: 'Анна',
          lastName: 'Иванова',
          username: 'anna',
          photoUrl: 'https://example.com/anna.jpg',
        },
      },
    });
  });

  it('отклоняет изменённые после подписи данные', () => {
    const initData = signedInitData().replace('%D0%90%D0%BD%D0%BD%D0%B0', '%D0%95%D0%B2%D0%B0');

    expect(validateMaxInitData(initData, BOT_TOKEN, { nowSeconds: NOW })).toEqual({
      ok: false,
      reason: 'invalid-signature',
    });
  });

  it('отклоняет повторяющийся параметр', () => {
    const initData = `${signedInitData()}&hash=${'0'.repeat(64)}`;

    expect(validateMaxInitData(initData, BOT_TOKEN, { nowSeconds: NOW })).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('отклоняет initData старше допустимого времени', () => {
    const result = validateMaxInitData(signedInitData({ auth_date: String(NOW - 901) }), BOT_TOKEN, {
      nowSeconds: NOW,
      maxAgeSeconds: 900,
    });

    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('не принимает небезопасный числовой идентификатор пользователя', () => {
    const result = validateMaxInitData(
      signedInitData({ user: JSON.stringify({ id: 9_007_199_254_740_992, first_name: 'Анна' }) }),
      BOT_TOKEN,
      { nowSeconds: NOW },
    );

    expect(result).toEqual({ ok: false, reason: 'invalid-user' });
  });
});
