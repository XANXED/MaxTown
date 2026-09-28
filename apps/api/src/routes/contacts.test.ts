import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContactImportResult, HouseContactSource } from '../contacts/data-mos.ts';
import { createSession } from '../auth/sessions.ts';
import { buildApp } from '../app.ts';
import { runMigrations } from '../db/migrate.ts';
import { createPool } from '../db/pool.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('House Contacts API', () => {
  let pool: Pool;
  let app: FastifyInstance;
  let houseId: string;
  let otherHouseId: string;
  let residentToken: string;
  let headmanToken: string;
  let foreignToken: string;
  let apartmentNumber = 0;

  async function person(key: string): Promise<{ id: string; token: string }> {
    const result = await pool.query<{ id: string }>('INSERT INTO residents (vk_user_id, display_name) VALUES ($1, $1) RETURNING id', [key]);
    const session = await createSession(pool, result.rows[0]!.id);
    return { id: result.rows[0]!.id, token: session.token };
  }

  async function addMember(targetHouseId: string, key: string, role: 'resident' | 'headman'): Promise<string> {
    const member = await person(key);
    apartmentNumber += 1;
    const apartment = await pool.query<{ id: string }>('INSERT INTO apartments (house_id, number) VALUES ($1, $2) RETURNING id', [targetHouseId, String(apartmentNumber)]);
    await pool.query('INSERT INTO memberships (house_id, apartment_id, resident_id, role) VALUES ($1, $2, $3, $4)', [targetHouseId, apartment.rows[0]!.id, member.id, role]);
    return member.token;
  }

  async function start(contactSource: HouseContactSource | null = null): Promise<void> {
    app = await buildApp({ pool, env: { NODE_ENV: 'test' }, contactSource });
  }

  beforeEach(async () => {
    apartmentNumber = 0;
    pool = createPool(databaseUrl!);
    await runMigrations(pool);
    await pool.query('TRUNCATE TABLE houses CASCADE');
    await pool.query('TRUNCATE TABLE residents CASCADE');
    const houses = await pool.query<{ id: string }>("INSERT INTO houses (address, locality) VALUES ('ул. Лесная, 12', 'Москва'), ('ул. Другая, 2', 'Казань') RETURNING id");
    houseId = houses.rows[0]!.id;
    otherHouseId = houses.rows[1]!.id;
    residentToken = await addMember(houseId, 'contacts-resident', 'resident');
    headmanToken = await addMember(houseId, 'contacts-headman', 'headman');
    foreignToken = await addMember(otherHouseId, 'contacts-foreign', 'resident');
  });

  afterEach(async () => {
    await app?.close();
    if (!app) await pool?.end();
  });

  it('lets members read and lets only the Староста create, edit and delete Contacts', async () => {
    await start();
    const headman = { authorization: `Bearer ${headmanToken}` };
    const payload = {
      kind: 'plumber', title: 'Сантехник', description: 'Ежедневно с 8:00 до 20:00',
      phone: '+7 495 123-45-67', link: null,
    };
    const created = await app.inject({ method: 'POST', url: `/api/houses/${houseId}/contacts`, headers: headman, payload });
    expect(created.statusCode).toBe(201);
    const contactId = created.json<{ contact: { id: string } }>().contact.id;

    const member = await app.inject({ method: 'GET', url: `/api/houses/${houseId}/contacts`, headers: { authorization: `Bearer ${residentToken}` } });
    expect(member.statusCode).toBe(200);
    expect(member.json()).toMatchObject({ contacts: [{ id: contactId, kind: 'plumber', title: 'Сантехник', source: 'manual' }] });
    expect(member.json()).toMatchObject({ importState: { status: 'not-configured' } });
    expect((await app.inject({ method: 'GET', url: `/api/houses/${houseId}/contacts`, headers: { authorization: `Bearer ${foreignToken}` } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/houses/${houseId}/contacts`, headers: { authorization: `Bearer ${residentToken}` }, payload })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/houses/${houseId}/contacts/import`, headers: { authorization: `Bearer ${residentToken}` } })).statusCode).toBe(403);

    const updated = await app.inject({ method: 'PUT', url: `/api/houses/${houseId}/contacts/${contactId}`, headers: headman, payload: { ...payload, title: 'Дежурный сантехник' } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ contact: { title: 'Дежурный сантехник' } });
    expect((await app.inject({ method: 'DELETE', url: `/api/houses/${houseId}/contacts/${contactId}`, headers: headman })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/api/houses/${houseId}/contacts`, headers: headman })).json()).toMatchObject({ contacts: [] });

    const audit = await pool.query<{ event_type: string }>('SELECT event_type FROM audit_events WHERE house_id = $1 ORDER BY occurred_at, id', [houseId]);
    expect(audit.rows.map(({ event_type }) => event_type)).toEqual(['house_contact.created', 'house_contact.updated', 'house_contact.deleted']);
  });

  it('validates a usable phone or HTTPS link', async () => {
    await start();
    const headers = { authorization: `Bearer ${headmanToken}` };
    const base = { kind: 'other', title: 'Полезная служба', description: null };
    expect((await app.inject({ method: 'POST', url: `/api/houses/${houseId}/contacts`, headers, payload: { ...base, phone: null, link: null } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/api/houses/${houseId}/contacts`, headers, payload: { ...base, phone: null, link: 'http://example.org' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/api/houses/${houseId}/contacts`, headers, payload: { ...base, phone: null, link: 'https://example.org' } })).statusCode).toBe(201);
  });

  it('imports once automatically and preserves overrides and tombstones on refresh', async () => {
    let imported: ContactImportResult = {
      status: 'ready',
      contacts: [{ externalKey: '1:+74950000000', title: 'Управляющая организация', description: 'ООО «Первый дом»', phone: '+7 495 000-00-00' }],
    };
    const contactSource: HouseContactSource = { importForHouse: async () => imported };
    await start(contactSource);
    const resident = { authorization: `Bearer ${residentToken}` };
    const headman = { authorization: `Bearer ${headmanToken}` };

    const first = await app.inject({ method: 'GET', url: `/api/houses/${houseId}/contacts`, headers: resident });
    expect(first.statusCode).toBe(200);
    const importedContact = first.json<{ contacts: Array<{ id: string; source: string; overridden: boolean }> }>().contacts[0]!;
    expect(importedContact).toMatchObject({ source: 'data-mos', overridden: false });

    const payload = { kind: 'management', title: 'Наша управляющая организация', description: 'Проверено Старостой', phone: '+7 495 111-11-11', link: null };
    expect((await app.inject({ method: 'PUT', url: `/api/houses/${houseId}/contacts/${importedContact.id}`, headers: headman, payload })).statusCode).toBe(200);
    imported = {
      status: 'ready',
      contacts: [{ externalKey: '1:+74950000000', title: 'Управляющая организация', description: 'Новое название из источника', phone: '+7 495 000-00-00' }],
    };
    await app.inject({ method: 'POST', url: `/api/houses/${houseId}/contacts/import`, headers: headman });
    const afterOverride = (await app.inject({ method: 'GET', url: `/api/houses/${houseId}/contacts`, headers: resident })).json<{ contacts: Array<{ id: string; title: string }> }>();
    expect(afterOverride.contacts).toEqual([{ id: importedContact.id, kind: 'management', title: 'Наша управляющая организация', description: 'Проверено Старостой', phone: '+7 495 111-11-11', source: 'data-mos', sourceCheckedAt: expect.any(String), overridden: true, updatedAt: expect.any(String) }]);

    expect((await app.inject({ method: 'DELETE', url: `/api/houses/${houseId}/contacts/${importedContact.id}`, headers: headman })).statusCode).toBe(204);
    await app.inject({ method: 'POST', url: `/api/houses/${houseId}/contacts/import`, headers: headman });
    const afterDelete = (await app.inject({ method: 'GET', url: `/api/houses/${houseId}/contacts`, headers: resident })).json<{ contacts: unknown[] }>();
    expect(afterDelete.contacts).toEqual([]);
  });

  it('keeps a non-Moscow House in manual mode without calling the Moscow source', async () => {
    const importForHouse = vi.fn(async (): Promise<ContactImportResult> => ({ status: 'not-found', contacts: [] }));
    await start({ importForHouse });

    const response = await app.inject({
      method: 'GET',
      url: `/api/houses/${otherHouseId}/contacts`,
      headers: { authorization: `Bearer ${foreignToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ contacts: [], importState: { status: 'not-applicable' } });
    expect(importForHouse).not.toHaveBeenCalled();
  });
});
