import { createHmac, timingSafeEqual } from 'node:crypto';

const VK_LAUNCH_PARAMS_LENGTH = 16_384;

export type VkVerifiedIdentity = { vkUserId: string };

function canonicalSignaturePayload(values: Map<string, string>): string {
  return [...values]
    .filter(([key]) => key.startsWith('vk_'))
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
}

/** Signature VK puts into `sign`: base64url HMAC-SHA256 of the sorted `vk_*` parameters. */
export function signVkLaunchParams(params: Record<string, string>, appSecret: string): string {
  return createHmac('sha256', appSecret)
    .update(canonicalSignaturePayload(new Map(Object.entries(params))))
    .digest('base64url');
}

/** Verifies VK's signed launch parameters. Launch params do not carry a documented expiry timestamp. */
export function validateVkLaunchParams(
  launchParams: string,
  appSecret: string,
  expectedAppId: string,
): VkVerifiedIdentity {
  if (!launchParams || launchParams.length > VK_LAUNCH_PARAMS_LENGTH) throw new Error('Invalid VK launch parameters');
  if (!appSecret.trim() || !expectedAppId.trim()) throw new Error('VK Mini App credentials are not configured');

  const values = new Map<string, string>();
  for (const [key, value] of new URLSearchParams(launchParams)) {
    if (!key || values.has(key)) throw new Error('Duplicate VK launch parameter');
    values.set(key, value);
  }

  const signature = values.get('sign');
  const appId = values.get('vk_app_id');
  const userId = values.get('vk_user_id');
  if (!signature || !/^[A-Za-z0-9_-]{43}$/.test(signature)) throw new Error('Invalid VK launch signature');
  if (appId !== expectedAppId) throw new Error('VK launch parameters belong to another application');
  if (!userId || !/^\d+$/.test(userId) || !Number.isSafeInteger(Number(userId)) || Number(userId) < 1) {
    throw new Error('Invalid VK user id');
  }

  const expected = createHmac('sha256', appSecret)
    .update(canonicalSignaturePayload(values))
    .digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error('Invalid VK launch signature');
  }

  return { vkUserId: userId };
}
