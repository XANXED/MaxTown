import Fastify from 'fastify';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerVkCallbackRoutes } from './vk-callback.ts';

const pool = {
  query: vi.fn(async () => ({ rows: [], rowCount: 1 })),
  connect: vi.fn(async () => ({
    query: vi.fn(async () => ({ rows: [], rowCount: 1 })),
    release: vi.fn(),
  })),
} as unknown as Pool;

describe('VK Callback API', () => {
  let app = Fastify();
  beforeEach(() => { app = Fastify(); });
  afterEach(async () => {
    await app.close();
  });

  it('returns the confirmation code for a valid VK confirmation event', async () => {
    registerVkCallbackRoutes(app, pool, { groupId: 123, secret: 'callback-secret', confirmationCode: 'verify-me' });
    const response = await app.inject({ method: 'POST', url: '/api/vk/callback', payload: { type: 'confirmation', group_id: 123, event_id: 'confirm-1', v: '5.199', secret: 'callback-secret' } });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('verify-me');
  });

  it('keeps the callback available before the VK-issued confirmation code is configured', async () => {
    registerVkCallbackRoutes(app, pool, { groupId: 123, secret: 'callback-secret' });
    const response = await app.inject({ method: 'POST', url: '/api/vk/callback', payload: { type: 'confirmation', group_id: 123, event_id: 'confirm-before-config', v: '5.199', secret: 'callback-secret' } });
    expect(response.statusCode).toBe(503);
  });

  it('rejects wrong secret and group without touching persistence', async () => {
    const query = vi.mocked(pool.query);
    const connect = vi.mocked(pool.connect);
    query.mockClear(); connect.mockClear();
    registerVkCallbackRoutes(app, pool, { groupId: 123, secret: 'callback-secret', confirmationCode: 'verify-me' });
    const wrongSecret = await app.inject({ method: 'POST', url: '/api/vk/callback', payload: { type: 'message_allow', group_id: 123, event_id: 'bad-1', v: '5.199', secret: 'bad', object: { user_id: 777 } } });
    const wrongGroup = await app.inject({ method: 'POST', url: '/api/vk/callback', payload: { type: 'message_allow', group_id: 999, event_id: 'bad-2', v: '5.199', secret: 'callback-secret', object: { user_id: 777 } } });
    expect(wrongSecret.statusCode).toBe(403);
    expect(wrongGroup.statusCode).toBe(403);
    expect(query).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it('acks duplicate valid events without applying their side effects twice', async () => {
    const client = {
      query: vi.fn(async (sql: string) => sql.includes('INSERT INTO vk_callback_events')
        ? { rows: [], rowCount: 0 }
        : { rows: [], rowCount: 1 }),
      release: vi.fn(),
    };
    vi.mocked(pool.connect).mockResolvedValue(client as never);
    registerVkCallbackRoutes(app, pool, { groupId: 123, secret: 'callback-secret', confirmationCode: 'verify-me' });
    const response = await app.inject({ method: 'POST', url: '/api/vk/callback', payload: { type: 'message_deny', group_id: 123, event_id: 'duplicate-1', v: '5.199', secret: 'callback-secret', object: { user_id: 777 } } });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('ok');
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(expect.arrayContaining([expect.stringContaining('INSERT INTO vk_callback_events')]));
    expect(client.query).toHaveBeenCalledTimes(3);
  });

  it('records permission only for the VK user named by a valid allow event', async () => {
    const client = { query: vi.fn(async () => ({ rows: [], rowCount: 1 })), release: vi.fn() };
    vi.mocked(pool.connect).mockResolvedValue(client as never);
    registerVkCallbackRoutes(app, pool, { groupId: 123, secret: 'callback-secret', confirmationCode: 'verify-me' });
    const response = await app.inject({ method: 'POST', url: '/api/vk/callback', payload: { type: 'message_allow', group_id: 123, event_id: 'allow-1', v: '5.199', secret: 'callback-secret', object: { user_id: 777 } } });
    expect(response.statusCode).toBe(200);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("resident_message_permissions.status = 'opted_out'"), ['777', 'allowed']);
  });

  it('stores revoked permission and permanently denies outstanding deliveries', async () => {
    const client = { query: vi.fn(async () => ({ rows: [], rowCount: 1 })), release: vi.fn() };
    vi.mocked(pool.connect).mockResolvedValue(client as never);
    registerVkCallbackRoutes(app, pool, { groupId: 123, secret: 'callback-secret', confirmationCode: 'verify-me' });
    const response = await app.inject({ method: 'POST', url: '/api/vk/callback', payload: { type: 'message_deny', group_id: 123, event_id: 'deny-1', v: '5.199', secret: 'callback-secret', object: { user_id: 777 } } });
    expect(response.body).toBe('ok');
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO resident_message_permissions'), ['777', 'denied']);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("last_error_code = 'permission_revoked'"), ['777']);
  });

  it('rejects malformed events and acknowledges unsupported valid events without mutation', async () => {
    const client = vi.mocked(pool.connect);
    client.mockClear();
    registerVkCallbackRoutes(app, pool, { groupId: 123, secret: 'callback-secret', confirmationCode: 'verify-me' });
    const malformed = await app.inject({ method: 'POST', url: '/api/vk/callback', payload: { type: 'message_allow', group_id: 123, event_id: 'bad', v: '5.199', secret: 'callback-secret', object: {} } });
    expect(malformed.statusCode).toBe(400);
    expect(client).not.toHaveBeenCalled();
    const unsupported = await app.inject({ method: 'POST', url: '/api/vk/callback', payload: { type: 'wall_post_new', group_id: 123, event_id: 'unsupported-1', v: '5.199', secret: 'callback-secret', object: {} } });
    expect(unsupported.statusCode).toBe(200);
    expect(unsupported.body).toBe('ok');
    expect(client).not.toHaveBeenCalled();
  });
});
