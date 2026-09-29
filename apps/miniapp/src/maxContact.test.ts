import { expect, it } from 'vitest';
import { MaxContactRequestError, requestMaxPhoneContact } from './maxContact.ts';

it('returns contact data received from the MAX bridge', async () => {
  const contact = { phone: '+79991234567', authDate: '1800000000', hash: 'a'.repeat(64) };

  await expect(requestMaxPhoneContact({ requestContact: async () => contact })).resolves.toEqual(contact);
});

it('distinguishes a user refusal from an unavailable bridge', async () => {
  await expect(requestMaxPhoneContact({
    requestContact: async () => ({ error: { code: 'client.request_phone.user_refused_provide_phone_number' } }),
  })).rejects.toMatchObject({ reason: 'refused' });
  await expect(requestMaxPhoneContact({
    requestContact: async () => Promise.reject({ error: { code: 'client.request_phone.user_refused_provide_phone_number' } }),
  })).rejects.toMatchObject({ reason: 'refused' });
  await expect(requestMaxPhoneContact(undefined)).rejects.toEqual(new MaxContactRequestError('unsupported'));
});
