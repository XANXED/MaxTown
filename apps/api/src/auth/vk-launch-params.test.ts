import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signVkLaunchParams, validateVkLaunchParams } from './vk-launch-params.ts';

const APP_ID = '12345678';
const APP_SECRET = 'test-vk-client-secret';

function sign(values: Record<string, string>, secret = APP_SECRET): string {
  const canonical = Object.entries(values)
    .filter(([key]) => key.startsWith('vk_'))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  const signature = createHmac('sha256', secret).update(canonical).digest('base64url');
  return new URLSearchParams({ ...values, sign: signature }).toString();
}

const validLaunchParams = {
  vk_app_id: APP_ID,
  vk_user_id: '494075',
  vk_is_app_user: '1',
  vk_language: 'ru',
  vk_platform: 'android',
  vk_ref: 'poll & services',
};

describe('VK Mini App launch parameter validation', () => {
  it('accepts official VK-signed vk_* launch parameters and returns only the verified identity', () => {
    expect(validateVkLaunchParams(sign(validLaunchParams), APP_SECRET, APP_ID)).toEqual({ vkUserId: '494075' });
  });

  it('rejects modified launch fields, wrong secret, wrong application, and malformed launch data', () => {
    const tampered = new URLSearchParams(sign(validLaunchParams));
    tampered.set('vk_user_id', '494076');
    expect(() => validateVkLaunchParams(tampered.toString(), APP_SECRET, APP_ID)).toThrow();
    expect(() => validateVkLaunchParams(sign(validLaunchParams), 'other-secret', APP_ID)).toThrow();
    expect(() => validateVkLaunchParams(sign({ ...validLaunchParams, vk_app_id: '999' }), APP_SECRET, APP_ID)).toThrow();
    expect(() => validateVkLaunchParams('vk_user_id=494075', APP_SECRET, APP_ID)).toThrow();
  });

  it('rejects duplicate keys, duplicate signatures, empty identities, and overlong payloads', () => {
    const signed = sign(validLaunchParams);
    expect(() => validateVkLaunchParams(`${signed}&vk_user_id=494075`, APP_SECRET, APP_ID)).toThrow();
    expect(() => validateVkLaunchParams(`${signed}&sign=duplicate`, APP_SECRET, APP_ID)).toThrow();
    expect(() => validateVkLaunchParams(sign({ ...validLaunchParams, vk_user_id: '' }), APP_SECRET, APP_ID)).toThrow();
    expect(() => validateVkLaunchParams('x'.repeat(16_385), APP_SECRET, APP_ID)).toThrow();
  });

  it('accepts a link signed by signVkLaunchParams (npm run dev:link)', () => {
    const params = { vk_app_id: APP_ID, vk_user_id: '2', vk_platform: 'desktop_web' };
    const link = new URLSearchParams({ ...params, sign: signVkLaunchParams(params, APP_SECRET), house_id: 'h1' }).toString();
    expect(validateVkLaunchParams(link, APP_SECRET, APP_ID)).toEqual({ vkUserId: '2' });
    expect(() => validateVkLaunchParams(link, 'other-secret', APP_ID)).toThrow();
  });
});
