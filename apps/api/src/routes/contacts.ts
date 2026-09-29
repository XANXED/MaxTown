import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import type {
  HouseContact,
  HouseContactImportStatus,
  HouseContactInput,
  HouseContactsResponse,
} from '@maxtown/shared';
import { canManageHouse, findHouseAccess, type HouseAccess } from '../auth/house-access.ts';
import { requireAuthentication } from '../auth/sessions.ts';
import type { ContactImportResult, HouseContactSource } from '../contacts/data-mos.ts';

type HouseParams = { houseId: string };
type ContactParams = HouseParams & { contactId: string };
type ContactRow = {
  id: string;
  kind: HouseContact['kind'];
  title: string;
  description: string | null;
  phone: string | null;
  link: string | null;
  source: HouseContact['source'];
  source_checked_at: Date | null;
  overridden_at: Date | null;
  updated_at: Date;
};
type SyncRow = { status: HouseContactImportStatus; checked_at: Date };

const contactKinds = [
  'management', 'dispatch', 'house-emergency', 'plumber', 'electrician',
  'elevator', 'intercom', 'security', 'district-police', 'other',
] as const;
const houseParamsSchema = {
  type: 'object', required: ['houseId'], properties: { houseId: { type: 'string', format: 'uuid' } },
} as const;
const contactParamsSchema = {
  type: 'object', required: ['houseId', 'contactId'],
  properties: { ...houseParamsSchema.properties, contactId: { type: 'string', format: 'uuid' } },
} as const;
const nullableString = (maxLength: number) => ({
  anyOf: [{ type: 'string', maxLength }, { type: 'null' }],
}) as const;
const contactBodySchema = {
  type: 'object',
  required: ['kind', 'title', 'description', 'phone', 'link'],
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: contactKinds },
    title: { type: 'string', minLength: 1, maxLength: 160 },
    description: nullableString(1000),
    phone: nullableString(80),
    link: nullableString(500),
  },
} as const;

function normalizeInput(input: HouseContactInput): HouseContactInput | null {
  const title = input.title.trim();
  const description = input.description?.trim() || null;
  const phone = input.phone?.trim() || null;
  const link = input.link?.trim() || null;
  if (!title || (!phone && !link)) return null;
  if (phone && !/\d/u.test(phone)) return null;
  if (link) {
    try {
      const parsed = new URL(link);
      if (parsed.protocol !== 'https:') return null;
    } catch {
      return null;
    }
  }
  return { ...input, title, description, phone, link };
}

function toContact(row: ContactRow): HouseContact {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    ...(row.description ? { description: row.description } : {}),
    ...(row.phone ? { phone: row.phone } : {}),
    ...(row.link ? { link: row.link } : {}),
    source: row.source,
    sourceCheckedAt: row.source_checked_at?.toISOString() ?? null,
    overridden: row.overridden_at !== null,
    updatedAt: row.updated_at.toISOString(),
  };
}

async function readContacts(db: Pool | PoolClient, houseId: string): Promise<HouseContact[]> {
  const result = await db.query<ContactRow>(
    `SELECT id, kind, title, description, phone, link, source, source_checked_at, overridden_at, updated_at
       FROM house_contacts
      WHERE house_id = $1 AND deleted_at IS NULL
      ORDER BY CASE kind
        WHEN 'management' THEN 1 WHEN 'dispatch' THEN 2 WHEN 'house-emergency' THEN 3
        WHEN 'plumber' THEN 4 WHEN 'electrician' THEN 5 WHEN 'elevator' THEN 6
        WHEN 'intercom' THEN 7 WHEN 'security' THEN 8 WHEN 'district-police' THEN 9 ELSE 10 END,
        title, id`,
    [houseId],
  );
  return result.rows.map(toContact);
}

async function readResponse(db: Pool | PoolClient, houseId: string): Promise<HouseContactsResponse> {
  const sync = await db.query<SyncRow>(
    "SELECT status, checked_at FROM house_contact_syncs WHERE house_id = $1 AND source = 'data-mos'",
    [houseId],
  );
  const row = sync.rows[0];
  return {
    contacts: await readContacts(db, houseId),
    importState: row
      ? { status: row.status, checkedAt: row.checked_at.toISOString() }
      : { status: 'not-configured', checkedAt: null },
  };
}

async function inTransaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function isMoscow(access: HouseAccess): boolean {
  return access.locality.trim().toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').includes('москва');
}

async function saveSyncState(
  db: Pool | PoolClient,
  houseId: string,
  status: HouseContactImportStatus,
  successful: boolean,
): Promise<void> {
  await db.query(
    `INSERT INTO house_contact_syncs (house_id, source, status, checked_at, last_success_at)
     VALUES ($1, 'data-mos', $2, now(), CASE WHEN $3 THEN now() ELSE NULL END)
     ON CONFLICT (house_id, source) DO UPDATE SET
       status = EXCLUDED.status,
       checked_at = now(),
       last_success_at = CASE WHEN $3 THEN now() ELSE house_contact_syncs.last_success_at END`,
    [houseId, status, successful],
  );
}

async function applyImport(pool: Pool, houseId: string, result: ContactImportResult): Promise<void> {
  await inTransaction(pool, async (client) => {
    const keys: string[] = [];
    const checkedAt = new Date();
    for (const contact of result.contacts) {
      keys.push(contact.externalKey);
      await client.query(
        `INSERT INTO house_contacts
          (house_id, kind, title, description, phone, source, source_key, source_checked_at)
         VALUES ($1, 'management', $2, $3, $4, 'data-mos', $5, $6)
         ON CONFLICT (house_id, source, source_key) WHERE source_key IS NOT NULL DO UPDATE SET
           kind = 'management', title = EXCLUDED.title, description = EXCLUDED.description,
           phone = EXCLUDED.phone, source_checked_at = EXCLUDED.source_checked_at, updated_at = now()
         WHERE house_contacts.deleted_at IS NULL AND house_contacts.overridden_at IS NULL`,
        [houseId, contact.title, contact.description, contact.phone, contact.externalKey, checkedAt],
      );
    }
    if (result.status === 'ready') {
      await client.query(
        `UPDATE house_contacts SET deleted_at = now(), updated_at = now()
          WHERE house_id = $1 AND source = 'data-mos' AND deleted_at IS NULL AND overridden_at IS NULL
            AND NOT (source_key = ANY($2::text[]))`,
        [houseId, keys],
      );
    }
    await saveSyncState(client, houseId, result.status, true);
  });
}

async function runImport(pool: Pool, source: HouseContactSource, access: HouseAccess): Promise<boolean> {
  try {
    const result = await source.importForHouse({ address: access.address, locality: access.locality });
    await applyImport(pool, access.houseId, result);
    return true;
  } catch {
    await saveSyncState(pool, access.houseId, 'failed', false);
    return false;
  }
}

async function prepareImportState(pool: Pool, source: HouseContactSource | null, access: HouseAccess): Promise<void> {
  const current = await pool.query<{ status: HouseContactImportStatus }>(
    "SELECT status FROM house_contact_syncs WHERE house_id = $1 AND source = 'data-mos'",
    [access.houseId],
  );
  if (current.rowCount && !(current.rows[0]?.status === 'not-configured' && source)) return;
  if (!isMoscow(access)) {
    await saveSyncState(pool, access.houseId, 'not-applicable', true);
    return;
  }
  if (!source) {
    await saveSyncState(pool, access.houseId, 'not-configured', false);
    return;
  }
  await runImport(pool, source, access);
}

async function requireHeadman(pool: Pool, residentId: string, houseId: string): Promise<HouseAccess | null> {
  const access = await findHouseAccess(pool, residentId, houseId);
  return canManageHouse(access) ? access : null;
}

async function writeAudit(
  client: PoolClient,
  access: HouseAccess,
  eventType: string,
  details: unknown,
): Promise<void> {
  await client.query(
    'INSERT INTO audit_events (house_id, actor_membership_id, event_type, details) VALUES ($1, $2, $3, $4::jsonb)',
    [access.houseId, access.id, eventType, JSON.stringify(details)],
  );
}

export function registerContactRoutes(
  app: FastifyInstance,
  pool: Pool,
  { source }: { source: HouseContactSource | null },
): void {
  const authenticated = requireAuthentication(pool);

  app.get<{ Params: HouseParams }>('/api/houses/:houseId/contacts', {
    preHandler: authenticated, schema: { params: houseParamsSchema },
  }, async (request, reply) => {
    const access = await findHouseAccess(pool, request.authSession!.resident.id, request.params.houseId);
    if (!access) return reply.code(403).send({ error: 'forbidden' });
    await prepareImportState(pool, source, access);
    return readResponse(pool, access.houseId);
  });

  app.post<{ Params: HouseParams; Body: HouseContactInput }>('/api/houses/:houseId/contacts', {
    preHandler: authenticated, schema: { params: houseParamsSchema, body: contactBodySchema },
  }, async (request, reply) => {
    const access = await requireHeadman(pool, request.authSession!.resident.id, request.params.houseId);
    if (!access) return reply.code(403).send({ error: 'contact_edit_forbidden' });
    const input = normalizeInput(request.body);
    if (!input) return reply.code(400).send({ error: 'invalid_contact' });
    const id = await inTransaction(pool, async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO house_contacts (house_id, kind, title, description, phone, link)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [access.houseId, input.kind, input.title, input.description, input.phone, input.link],
      );
      const contactId = inserted.rows[0]!.id;
      await writeAudit(client, access, 'house_contact.created', { contactId, after: input });
      return contactId;
    });
    const contact = (await readContacts(pool, access.houseId)).find((item) => item.id === id)!;
    return reply.code(201).send({ contact });
  });

  app.put<{ Params: ContactParams; Body: HouseContactInput }>('/api/houses/:houseId/contacts/:contactId', {
    preHandler: authenticated, schema: { params: contactParamsSchema, body: contactBodySchema },
  }, async (request, reply) => {
    const access = await requireHeadman(pool, request.authSession!.resident.id, request.params.houseId);
    if (!access) return reply.code(403).send({ error: 'contact_edit_forbidden' });
    const input = normalizeInput(request.body);
    if (!input) return reply.code(400).send({ error: 'invalid_contact' });
    const found = await inTransaction(pool, async (client) => {
      const before = await client.query<ContactRow>(
        `SELECT id, kind, title, description, phone, link, source, source_checked_at, overridden_at, updated_at
           FROM house_contacts WHERE id = $1 AND house_id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [request.params.contactId, access.houseId],
      );
      if (!before.rowCount) return false;
      await client.query(
        `UPDATE house_contacts SET kind=$3, title=$4, description=$5, phone=$6, link=$7,
           overridden_at=CASE WHEN source='data-mos' THEN COALESCE(overridden_at, now()) ELSE overridden_at END,
           updated_at=now() WHERE id=$1 AND house_id=$2`,
        [request.params.contactId, access.houseId, input.kind, input.title, input.description, input.phone, input.link],
      );
      await writeAudit(client, access, 'house_contact.updated', {
        contactId: request.params.contactId, before: toContact(before.rows[0]!), after: input,
      });
      return true;
    });
    if (!found) return reply.code(404).send({ error: 'contact_not_found' });
    const contact = (await readContacts(pool, access.houseId)).find((item) => item.id === request.params.contactId)!;
    return { contact };
  });

  app.delete<{ Params: ContactParams }>('/api/houses/:houseId/contacts/:contactId', {
    preHandler: authenticated, schema: { params: contactParamsSchema },
  }, async (request, reply) => {
    const access = await requireHeadman(pool, request.authSession!.resident.id, request.params.houseId);
    if (!access) return reply.code(403).send({ error: 'contact_edit_forbidden' });
    const deleted = await inTransaction(pool, async (client) => {
      const result = await client.query<{ id: string }>(
        `UPDATE house_contacts SET deleted_at=now(), updated_at=now()
          WHERE id=$1 AND house_id=$2 AND deleted_at IS NULL RETURNING id`,
        [request.params.contactId, access.houseId],
      );
      if (!result.rowCount) return false;
      await writeAudit(client, access, 'house_contact.deleted', { contactId: request.params.contactId });
      return true;
    });
    if (!deleted) return reply.code(404).send({ error: 'contact_not_found' });
    return reply.code(204).send();
  });

  app.post<{ Params: HouseParams }>('/api/houses/:houseId/contacts/import', {
    preHandler: authenticated, schema: { params: houseParamsSchema },
  }, async (request, reply) => {
    const access = await requireHeadman(pool, request.authSession!.resident.id, request.params.houseId);
    if (!access) return reply.code(403).send({ error: 'contact_import_forbidden' });
    if (!isMoscow(access)) {
      await saveSyncState(pool, access.houseId, 'not-applicable', true);
      return readResponse(pool, access.houseId);
    }
    if (!source) {
      await saveSyncState(pool, access.houseId, 'not-configured', false);
      return reply.code(503).send({ error: 'contact_source_not_configured' });
    }
    if (!await runImport(pool, source, access)) return reply.code(502).send({ error: 'contact_source_unavailable' });
    return readResponse(pool, access.houseId);
  });
}
