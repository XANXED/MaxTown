import { Pool } from 'pg';
import type { HouseChatStore } from './index.ts';

export type PostgresClient = Pick<Pool, 'query' | 'end'>;

type StoredKeyRow = {
  name: string;
  metadata: unknown;
};

type StoredValueRow = {
  value: string;
};

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS maxtown_kv (
    key text PRIMARY KEY,
    value text NOT NULL,
    metadata jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
  )
`;

function encodeCursor(key: string, prefix: string | null): string {
  return Buffer.from(JSON.stringify({ key, prefix }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | undefined, prefix: string | null): string | null {
  if (cursor === undefined) return null;

  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  if (Buffer.from(decoded, 'utf8').toString('base64url') !== cursor) {
    throw new Error('Некорректный курсор PostgreSQL KV');
  }
  try {
    const parsed: unknown = JSON.parse(decoded);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      typeof (parsed as Record<string, unknown>).key === 'string' &&
      ((parsed as Record<string, unknown>).prefix === null || typeof (parsed as Record<string, unknown>).prefix === 'string') &&
      (parsed as Record<string, unknown>).prefix === prefix
    ) {
      return (parsed as Record<string, unknown>).key as string;
    }
  } catch {
    // A cursor must be valid JSON for this store and prefix.
  }
  throw new Error('Некорректный курсор PostgreSQL KV');
}

export function createPostgresHouseChatStore(
  client: PostgresClient,
  options: { pageSize?: number } = {},
): HouseChatStore & { initialize(): Promise<void>; close(): Promise<void> } {
  const pageSize = options.pageSize ?? 1000;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw new Error('pageSize должен быть целым числом от 1 до 1000');
  }

  let initialization: Promise<void> | null = null;
  const initialize = (): Promise<void> => {
    if (!initialization) initialization = client.query(CREATE_TABLE, []).then(() => undefined);
    return initialization;
  };

  return {
    initialize,
    async get(key) {
      await initialize();
      const result = await client.query<StoredValueRow>(
        'SELECT value FROM maxtown_kv WHERE key = $1',
        [key],
      );
      return result.rows[0]?.value ?? null;
    },
    async put(key, value, options) {
      await initialize();
      const metadata = options?.metadata === undefined ? null : JSON.stringify(options.metadata);
      await client.query(
        `INSERT INTO maxtown_kv (key, value, metadata, updated_at)
         VALUES ($1, $2, $3::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET
           value = EXCLUDED.value,
           metadata = EXCLUDED.metadata,
           updated_at = now()`,
        [key, value, metadata],
      );
    },
    async delete(key) {
      await initialize();
      await client.query('DELETE FROM maxtown_kv WHERE key = $1', [key]);
    },
    async list(options) {
      await initialize();
      const prefix = options?.prefix ?? null;
      const cursor = decodeCursor(options?.cursor, prefix);
      const result = await client.query<StoredKeyRow>(
        `SELECT key AS name, metadata FROM maxtown_kv
         WHERE ($1::text IS NULL OR left(key, char_length($1)) = $1)
           AND ($2::text IS NULL OR key COLLATE "C" > $2 COLLATE "C")
         ORDER BY key COLLATE "C"
         LIMIT $3`,
        [prefix, cursor, pageSize],
      );
      const keys = result.rows;
      const complete = keys.length < pageSize;
      const lastKey = keys.at(-1)?.name;
      return {
        keys,
        list_complete: complete,
        ...(complete || lastKey === undefined ? {} : { cursor: encodeCursor(lastKey, prefix) }),
      };
    },
    async close() {
      await client.end();
    },
  };
}

export function connectPostgresHouseChatStore(
  connectionString: string,
): HouseChatStore & { initialize(): Promise<void>; close(): Promise<void> } {
  if (!connectionString) throw new Error('DATABASE_URL не настроен');
  const client = new Pool({ connectionString });
  return createPostgresHouseChatStore(client);
}
