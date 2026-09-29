import { createHmac, timingSafeEqual } from 'node:crypto';
import type { MaxPhoneContact } from '@maxtown/shared';

export type MaxContactValidation =
  | { ok: true; phone: string }
  | { ok: false; reason: 'malformed' | 'invalid-signature' | 'expired' };

type ValidateOptions = {
  nowSeconds?: number;
  maxAgeSeconds?: number;
  futureToleranceSeconds?: number;
};

function normalizedPhone(value: string): string | null {
  const digits = value.startsWith('+') ? value.slice(1) : value;
  return /^[1-9][0-9]{7,14}$/.test(digits) ? `+${digits}` : null;
}

function signatureFor(contact: Pick<MaxPhoneContact, 'phone' | 'authDate'>, userId: string, botToken: string): Buffer {
  const phone = contact.phone.startsWith('+') ? contact.phone.slice(1) : contact.phone;
  const dataCheckString = [
    `authDate=${contact.authDate}`,
    `phone=${phone}`,
    `userId=${userId}`,
  ].join('\n');
  return createHmac('sha256', botToken).update(dataCheckString).digest();
}

/** Подписывает контакт для локального запуска и тестов по алгоритму MAX Bridge. */
export function signMaxContact(
  values: Pick<MaxPhoneContact, 'phone' | 'authDate'>,
  userId: string,
  botToken: string,
): MaxPhoneContact {
  return { ...values, hash: signatureFor(values, userId, botToken).toString('hex') };
}

/** Проверяет, что номер из requestContact принадлежит текущему аккаунту MAX. */
export function validateMaxContact(
  contact: MaxPhoneContact,
  userId: string,
  botToken: string,
  options: ValidateOptions = {},
): MaxContactValidation {
  const phone = normalizedPhone(contact.phone);
  if (!phone || !/^\d{1,13}$/.test(contact.authDate) || !/^[a-f\d]{64}$/i.test(contact.hash) || !/^\d+$/.test(userId)) {
    return { ok: false, reason: 'malformed' };
  }

  const expected = signatureFor(contact, userId, botToken);
  const received = Buffer.from(contact.hash, 'hex');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return { ok: false, reason: 'invalid-signature' };
  }

  const rawAuthDate = Number(contact.authDate);
  const authDateSeconds = rawAuthDate > 10_000_000_000 ? Math.floor(rawAuthDate / 1000) : rawAuthDate;
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const maxAgeSeconds = options.maxAgeSeconds ?? 900;
  const futureToleranceSeconds = options.futureToleranceSeconds ?? 60;
  if (
    !Number.isSafeInteger(rawAuthDate)
    || authDateSeconds > nowSeconds + futureToleranceSeconds
    || nowSeconds - authDateSeconds > maxAgeSeconds
  ) {
    return { ok: false, reason: 'expired' };
  }

  return { ok: true, phone };
}
