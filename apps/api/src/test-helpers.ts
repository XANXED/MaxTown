import { createHmac } from 'node:crypto';

export const BOT_TOKEN = 'test-bot-token';
export const NOW = 1_800_000_000;

export function signedInitData(
  overrides: Record<string, string> = {},
  botToken = BOT_TOKEN,
): string {
  const values: Record<string, string> = {
    auth_date: String(NOW),
    query_id: 'query-1',
    user: JSON.stringify({
      id: 67890,
      first_name: 'Анна',
      last_name: 'Иванова',
      username: 'anna',
      photo_url: 'https://example.com/anna.jpg',
    }),
    ...overrides,
  };
  const launchParams = Object.entries(values)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secretKey).update(launchParams).digest('hex');
  return new URLSearchParams({ ...values, hash }).toString();
}
