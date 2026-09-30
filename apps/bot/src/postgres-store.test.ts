import { describe, expect, it, vi } from 'vitest';
import { createPostgresHouseChatStore, type PostgresClient } from './postgres-store.ts';

function clientWithResults(results: Array<{ rows: unknown[] }> = []) {
  let index = 0;
  return {
    query: vi.fn(async () => results[index++] ?? { rows: [] }),
    end: vi.fn(async () => undefined),
  } as unknown as PostgresClient;
}

describe('PostgreSQL house-chat store', () => {
  it('persists string values and JSON metadata with parameterized queries', async () => {
    const client = clientWithResults([
      { rows: [] },
      { rows: [] },
      { rows: [{ value: '{"houseId":"one"}' }] },
      { rows: [] },
    ]);
    const store = createPostgresHouseChatStore(client);
    await store.initialize();
    await store.put('house-chat:1', '{"houseId":"one"}', { metadata: { houseId: 'one' } });

    await expect(store.get('house-chat:1')).resolves.toBe('{"houseId":"one"}');
    await store.delete('house-chat:1');

    expect(client.query).toHaveBeenNthCalledWith(1, expect.stringContaining('CREATE TABLE IF NOT EXISTS'), []);
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO maxtown_kv'),
      ['house-chat:1', '{"houseId":"one"}', JSON.stringify({ houseId: 'one' })],
    );
    expect(client.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('SELECT value FROM maxtown_kv'),
      ['house-chat:1'],
    );
    expect(client.query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('DELETE FROM maxtown_kv'),
      ['house-chat:1'],
    );
  });

  it('returns an ordered page and an opaque continuation cursor', async () => {
    const client = clientWithResults([
      { rows: [] },
      { rows: [{ name: 'resident-notification:5:a', metadata: { id: 'a' } }] },
      { rows: [] },
    ]);
    const store = createPostgresHouseChatStore(client, { pageSize: 1 });
    await store.initialize();

    const firstPage = await store.list({ prefix: 'resident-notification:5:' });
    expect(firstPage).toEqual({
      keys: [{ name: 'resident-notification:5:a', metadata: { id: 'a' } }],
      list_complete: false,
      cursor: expect.any(String),
    });
    expect(firstPage.cursor).not.toBe('resident-notification:5:a');
    await expect(
      store.list({ prefix: 'resident-notification:5:', cursor: firstPage.cursor }),
    ).resolves.toEqual({ keys: [], list_complete: true });

    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('SELECT key AS name, metadata FROM maxtown_kv'),
      ['resident-notification:5:', null, 1],
    );
    expect(client.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('SELECT key AS name, metadata FROM maxtown_kv'),
      ['resident-notification:5:', 'resident-notification:5:a', 1],
    );
  });
});
