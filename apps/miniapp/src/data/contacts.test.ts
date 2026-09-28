import { describe, expect, it, vi } from 'vitest';
import type { HouseContact, HouseContactInput } from '@maxtown/shared';
import { createContactsClient, groupHouseContacts, phoneHref } from './contacts.ts';

const input: HouseContactInput = {
  kind: 'plumber',
  title: 'Сантехник',
  description: null,
  phone: '+7 (495) 123-45-67',
  link: null,
};

describe('contacts client', () => {
  it('loads, creates, updates, deletes and imports through house-scoped routes', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ contacts: [], importState: { status: 'ready', checkedAt: null } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    const client = createContactsClient(fetcher);

    await client.load('house 1');
    await client.save('house 1', input);
    await client.save('house 1', input, 'contact/2');
    await client.remove('house 1', 'contact/2');
    await client.refresh('house 1');

    expect(fetcher.mock.calls.map(([url, init]) => [url, init?.method ?? 'GET'])).toEqual([
      ['/api/houses/house%201/contacts', 'GET'],
      ['/api/houses/house%201/contacts', 'POST'],
      ['/api/houses/house%201/contacts/contact%2F2', 'PUT'],
      ['/api/houses/house%201/contacts/contact%2F2', 'DELETE'],
      ['/api/houses/house%201/contacts/import', 'POST'],
    ]);
    expect(fetcher.mock.calls[1]?.[1]?.body).toBe(JSON.stringify(input));
  });

  it('rejects unsuccessful responses and builds safe phone links', async () => {
    const client = createContactsClient(async () => new Response(null, { status: 403 }));
    await expect(client.load('house')).rejects.toThrow('contacts_request_failed');
    expect(phoneHref('+7 (495) 123-45-67')).toBe('tel:+74951234567');
  });

  it('keeps contacts together by category in their original order', () => {
    const contacts: HouseContact[] = [
      { id: 'a', kind: 'dispatch', title: 'Первая диспетчерская', source: 'manual', sourceCheckedAt: null, overridden: false, updatedAt: '2026-09-28T00:00:00.000Z' },
      { id: 'b', kind: 'plumber', title: 'Сантехник', source: 'manual', sourceCheckedAt: null, overridden: false, updatedAt: '2026-09-28T00:00:00.000Z' },
      { id: 'c', kind: 'dispatch', title: 'Вторая диспетчерская', source: 'manual', sourceCheckedAt: null, overridden: false, updatedAt: '2026-09-28T00:00:00.000Z' },
    ];

    expect(groupHouseContacts(contacts)).toMatchObject([
      { kind: 'dispatch', label: 'Диспетчерская', contacts: [{ id: 'a' }, { id: 'c' }] },
      { kind: 'plumber', label: 'Сантехник', contacts: [{ id: 'b' }] },
    ]);
  });
});
