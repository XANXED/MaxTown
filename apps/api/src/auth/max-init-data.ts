import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_INIT_DATA_LENGTH = 16_384;
const MAX_AUTH_AGE_SECONDS = 60 * 60;

export type MaxIdentity = {
  maxUserId: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
};

function optionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error('Invalid MAX identity');
  return value.trim() || null;
}

export function validateMaxInitData(initData: string, botToken: string, now = new Date()): MaxIdentity {
  if (!initData || initData.length > MAX_INIT_DATA_LENGTH) throw new Error('Invalid MAX initData');
  if (!botToken.trim()) throw new Error('MAX bot token is not configured');

  const params = new URLSearchParams(initData);
  const values = new Map<string, string>();
  for (const [key, value] of params) {
    if (!key || values.has(key)) throw new Error('Invalid MAX initData parameters');
    values.set(key, value);
  }

  const receivedHash = values.get('hash');
  if (!receivedHash || !/^[a-f\d]{64}$/i.test(receivedHash)) throw new Error('Invalid MAX initData hash');

  const authDateValue = values.get('auth_date');
  if (!authDateValue || !/^\d+$/.test(authDateValue)) throw new Error('Invalid MAX auth_date');
  const authDate = Number(authDateValue);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (!Number.isSafeInteger(authDate) || authDate > nowSeconds || nowSeconds - authDate > MAX_AUTH_AGE_SECONDS) {
    throw new Error('Expired MAX initData');
  }

  const userValue = values.get('user');
  if (!userValue) throw new Error('Missing MAX user');

  values.delete('hash');
  const checkString = [...values]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expectedHash = createHmac('sha256', secretKey).update(checkString).digest();
  const actualHash = Buffer.from(receivedHash, 'hex');
  if (!timingSafeEqual(actualHash, expectedHash)) throw new Error('Invalid MAX initData signature');

  let user: unknown;
  try {
    user = JSON.parse(userValue);
  } catch {
    throw new Error('Invalid MAX user');
  }
  if (!user || typeof user !== 'object' || Array.isArray(user)) throw new Error('Invalid MAX user');

  const record = user as Record<string, unknown>;
  if (typeof record.id !== 'number' || !Number.isSafeInteger(record.id) || record.id < 1) {
    throw new Error('Invalid MAX user id');
  }
  if (typeof record.first_name !== 'string' || !record.first_name.trim()) {
    throw new Error('Invalid MAX user name');
  }

  return {
    maxUserId: String(record.id),
    firstName: record.first_name.trim(),
    lastName: optionalText(record.last_name),
    username: optionalText(record.username),
  };
}
