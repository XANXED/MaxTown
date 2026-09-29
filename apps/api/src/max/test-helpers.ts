import { signMaxInitData } from '../auth/max-init-data.ts';

export const BOT_TOKEN = 'test-bot-token';
export const NOW = 1_800_000_000;

/** initData, подписанный как клиентом MAX. По умолчанию — Анна, MAX ID 67890. */
export function signedInitData(
  overrides: Record<string, string> = {},
  botToken = BOT_TOKEN,
): string {
  return signMaxInitData({
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
  }, botToken);
}
