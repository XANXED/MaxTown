import { createHmac } from 'node:crypto';
import { expect, it } from 'vitest';

const validatorModule = await import('./max-init-data.ts').catch(() => null);
const validateMaxInitData = validatorModule?.validateMaxInitData;
const BOT_TOKEN = 'max-test-token';
const AUTH_DATE = 1_771_409_719;
const NOW = new Date((AUTH_DATE + 30) * 1000);
const officialShapeInitData = 'query_id=4c0ab423-342b-4e45-aea4-2747dbc500cd&user=%7B%22id%22%3A67890%2C%22first_name%22%3A%22Max%22%2C%22last_name%22%3A%22User%22%2C%22username%22%3A%22max_user%22%2C%22language_code%22%3A%22ru%22%2C%22photo_url%22%3A%22https%3A%2F%2Fexample.test%2Fmax.png%22%7D&auth_date=1771409719&hash=2cceb7ae5c49c01cf257234b3fed46cb17c684cd9c33cbf29506ead4339259c4';

function signInitData(entries: Array<[string, string]>, botToken = BOT_TOKEN): string {
  const canonical = [...entries]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(canonical).digest('hex');
  const params = new URLSearchParams(entries);
  params.set('hash', hash);
  return params.toString();
}

function signedUser(userJson: string, authDate = AUTH_DATE): string {
  return signInitData([
    ['auth_date', String(authDate)],
    ['user', userJson],
  ]);
}

it('accepts MAX-signed initData and returns a normalized identity', () => {
  expect(validateMaxInitData?.(officialShapeInitData, BOT_TOKEN, NOW)).toEqual({
    maxUserId: '67890',
    firstName: 'Max',
    lastName: 'User',
    username: 'max_user',
  });
});

it('rejects duplicate, missing, or malformed initData parameters', () => {
  expect(() => validateMaxInitData?.(`${officialShapeInitData}&auth_date=${AUTH_DATE}`, BOT_TOKEN, NOW)).toThrow();
  expect(() => validateMaxInitData?.('auth_date=1771409719&user=%7B%7D', BOT_TOKEN, NOW)).toThrow();
  expect(() => validateMaxInitData?.(signInitData([['auth_date', String(AUTH_DATE)]]), BOT_TOKEN, NOW)).toThrow();
  expect(() => validateMaxInitData?.(signedUser('{broken-json'), BOT_TOKEN, NOW)).toThrow();
  expect(() => validateMaxInitData?.(signInitData([['auth_date', 'not-a-number'], ['user', '{}']]), BOT_TOKEN, NOW)).toThrow();
});

it('rejects tampering and an invalid hash format', () => {
  const tampered = new URLSearchParams(officialShapeInitData);
  tampered.set('user', JSON.stringify({ id: 67890, first_name: 'Forged' }));
  expect(() => validateMaxInitData?.(tampered.toString(), BOT_TOKEN, NOW)).toThrow();

  const malformedHash = new URLSearchParams(officialShapeInitData);
  malformedHash.set('hash', 'not-a-sha256-hex-digest');
  expect(() => validateMaxInitData?.(malformedHash.toString(), BOT_TOKEN, NOW)).toThrow();
});

it('rejects initData older than one hour and future-dated initData', () => {
  expect(() => validateMaxInitData?.(signedUser('{"id":67890,"first_name":"Max"}', AUTH_DATE), BOT_TOKEN, new Date((AUTH_DATE + 3601) * 1000))).toThrow();
  expect(() => validateMaxInitData?.(signedUser('{"id":67890,"first_name":"Max"}', Math.floor(NOW.getTime() / 1000) + 1), BOT_TOKEN, NOW)).toThrow();
});

it('rejects an absent bot token and malformed MAX user identity', () => {
  expect(() => validateMaxInitData?.(officialShapeInitData, '', NOW)).toThrow();
  expect(() => validateMaxInitData?.(signedUser('{"id":0,"first_name":"Max"}'), BOT_TOKEN, NOW)).toThrow();
  expect(() => validateMaxInitData?.(signedUser('{"id":67890,"first_name":" "}'), BOT_TOKEN, NOW)).toThrow();
});
