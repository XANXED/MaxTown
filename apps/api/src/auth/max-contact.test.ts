import { describe, expect, it } from 'vitest';
import { signMaxContact, validateMaxContact } from './max-contact.ts';

const BOT_TOKEN = 'test-bot-token';
const USER_ID = '67890';
const NOW = 1_800_000_000;

describe('проверка номера телефона из MAX Bridge', () => {
  it('принимает подписанный номер и нормализует плюс', () => {
    const contact = signMaxContact({ phone: '+79991234567', authDate: String(NOW) }, USER_ID, BOT_TOKEN);

    expect(contact.hash).toBe('36df2546d38a5a621e09b84cd0b231710472c8f305e527189c29aeedc9a67fcb');
    expect(validateMaxContact(contact, USER_ID, BOT_TOKEN, { nowSeconds: NOW })).toEqual({
      ok: true,
      phone: '+79991234567',
    });
  });

  it('принимает timestamp в миллисекундах, не меняя подписываемую строку', () => {
    const contact = signMaxContact({ phone: '79991234567', authDate: String(NOW * 1000) }, USER_ID, BOT_TOKEN);

    expect(validateMaxContact(contact, USER_ID, BOT_TOKEN, { nowSeconds: NOW })).toEqual({
      ok: true,
      phone: '+79991234567',
    });
  });

  it('отклоняет чужого пользователя, подменённый номер и старый ответ', () => {
    const contact = signMaxContact({ phone: '+79991234567', authDate: String(NOW) }, USER_ID, BOT_TOKEN);

    expect(validateMaxContact(contact, '42', BOT_TOKEN, { nowSeconds: NOW })).toMatchObject({ ok: false, reason: 'invalid-signature' });
    expect(validateMaxContact({ ...contact, phone: '+79990000000' }, USER_ID, BOT_TOKEN, { nowSeconds: NOW })).toMatchObject({ ok: false, reason: 'invalid-signature' });
    expect(validateMaxContact(contact, USER_ID, BOT_TOKEN, { nowSeconds: NOW + 901, maxAgeSeconds: 900 })).toEqual({ ok: false, reason: 'expired' });
  });
});
