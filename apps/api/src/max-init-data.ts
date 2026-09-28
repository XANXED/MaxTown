import { createHmac, timingSafeEqual } from 'node:crypto';
import type { MaxAuthUser } from '@maxtown/shared';

export type MaxInitData = {
  authDate: number;
  user: MaxAuthUser;
};

export type MaxInitDataValidation =
  | { ok: true; data: MaxInitData }
  | { ok: false; reason: 'malformed' | 'invalid-signature' | 'expired' | 'invalid-user' };

type ValidateOptions = {
  nowSeconds?: number;
  maxAgeSeconds?: number;
  futureToleranceSeconds?: number;
};

function parsePairs(initData: string): Map<string, string> | null {
  if (!initData || initData.length > 16_384) return null;

  const pairs = new Map<string, string>();
  for (const part of initData.split('&')) {
    const separator = part.indexOf('=');
    if (separator <= 0) return null;

    const key = part.slice(0, separator);
    if (!/^[a-z_]+$/.test(key) || pairs.has(key)) return null;

    try {
      pairs.set(key, decodeURIComponent(part.slice(separator + 1).replace(/\+/g, ' ')));
    } catch {
      return null;
    }
  }

  return pairs;
}

function signatureFor(pairs: Map<string, string>, botToken: string): Buffer {
  const launchParams = [...pairs.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  return createHmac('sha256', secretKey).update(launchParams).digest();
}

function toUser(value: string | undefined): MaxAuthUser | null {
  if (!value) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const user = parsed as Record<string, unknown>;
  if (!Number.isSafeInteger(user.id) || (user.id as number) <= 0 || typeof user.first_name !== 'string') return null;

  const firstName = user.first_name.trim();
  if (!firstName) return null;

  return {
    id: user.id as number,
    firstName,
    ...(typeof user.last_name === 'string' && user.last_name.trim() ? { lastName: user.last_name.trim() } : {}),
    ...(typeof user.username === 'string' && user.username.trim() ? { username: user.username.trim() } : {}),
    ...(typeof user.photo_url === 'string' && user.photo_url.trim() ? { photoUrl: user.photo_url.trim() } : {}),
  };
}

/** Проверяет initData только на сервере по алгоритму MAX и ограничивает срок повторного использования. */
export function validateMaxInitData(
  initData: string,
  botToken: string,
  options: ValidateOptions = {},
): MaxInitDataValidation {
  const pairs = parsePairs(initData);
  const receivedHash = pairs?.get('hash');
  if (!pairs || !receivedHash || !/^[a-f\d]{64}$/i.test(receivedHash) || !botToken) {
    return { ok: false, reason: 'malformed' };
  }

  const expectedHash = signatureFor(pairs, botToken);
  const receivedHashBytes = Buffer.from(receivedHash, 'hex');
  if (receivedHashBytes.length !== expectedHash.length || !timingSafeEqual(receivedHashBytes, expectedHash)) {
    return { ok: false, reason: 'invalid-signature' };
  }

  const authDateText = pairs.get('auth_date');
  if (!authDateText || !/^\d+$/.test(authDateText)) return { ok: false, reason: 'malformed' };

  const authDate = Number(authDateText);
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const maxAgeSeconds = options.maxAgeSeconds ?? 900;
  const futureToleranceSeconds = options.futureToleranceSeconds ?? 60;
  if (
    !Number.isSafeInteger(authDate) ||
    authDate > nowSeconds + futureToleranceSeconds ||
    nowSeconds - authDate > maxAgeSeconds
  ) {
    return { ok: false, reason: 'expired' };
  }

  const user = toUser(pairs.get('user'));
  if (!user) return { ok: false, reason: 'invalid-user' };

  return { ok: true, data: { authDate, user } };
}
