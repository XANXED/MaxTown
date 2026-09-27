import Fastify from 'fastify';
import bcrypt from 'bcryptjs';
import { afterEach, describe, expect, it } from 'vitest';
import { registerModeratorBasicAuth } from './moderator-basic-auth.ts';

const password = 'correct horse battery staple';

async function createApp() {
  const app = Fastify();
  const passwordHash = await bcrypt.hash(password, 4);
  registerModeratorBasicAuth(app, {
    NODE_ENV: 'test',
    MODERATOR_USERNAME: 'moderator@example.org',
    MODERATOR_PASSWORD_HASH: passwordHash,
  });
  app.get('/admin/', async (request) => ({ principal: request.moderatorPrincipal }));
  app.get('/api/moderator/registrations', async (request) => ({ principal: request.moderatorPrincipal }));
  app.get('/api/health', async (request) => ({ principal: request.moderatorPrincipal }));
  return app;
}

function basic(username: string, value: string): string {
  return `Basic ${Buffer.from(`${username}:${value}`).toString('base64')}`;
}

describe('Moderator Basic Authentication', () => {
  let app: Awaited<ReturnType<typeof createApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('sets the server-verified principal for valid credentials', async () => {
    app = await createApp();
    const response = await app.inject({ url: '/admin/', headers: { authorization: basic('moderator@example.org', password) } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ principal: 'moderator@example.org' });
  });

  it.each([
    ['missing credentials', undefined],
    ['invalid base64', 'Basic !!!'],
    ['missing username/password separator', `Basic ${Buffer.from('moderator@example.org').toString('base64')}`],
    ['wrong username', basic('someone@example.org', password)],
    ['wrong password', basic('moderator@example.org', 'incorrect password')],
    ['oversized credentials', `Basic ${Buffer.from(`moderator@example.org:${'x'.repeat(5000)}`).toString('base64')}`],
  ])('rejects %s with an HTTP Basic challenge', async (_label, authorization) => {
    app = await createApp();
    const response = await app.inject({
      url: '/api/moderator/registrations',
      headers: {
        ...(authorization === undefined ? {} : { authorization }),
        'x-maxtown-moderator': 'moderator@example.org',
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Basic realm="MaxTown Moderator", charset="UTF-8"');
    expect(response.json()).toEqual({ error: 'moderator_authentication_required' });
  });

  it('decodes UTF-8 credentials and permits colons in the password', async () => {
    app = Fastify();
    const unicodePassword = 'слово:пароль';
    const passwordHash = await bcrypt.hash(unicodePassword, 4);
    registerModeratorBasicAuth(app, {
      NODE_ENV: 'test',
      MODERATOR_USERNAME: 'moderator@example.org',
      MODERATOR_PASSWORD_HASH: passwordHash,
    });
    app.get('/admin/', async (request) => ({ principal: request.moderatorPrincipal }));

    const response = await app.inject({
      url: '/admin/',
      headers: { authorization: basic('moderator@example.org', unicodePassword) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ principal: 'moderator@example.org' });
  });

  it('protects only Moderator routes and leaves health routes public', async () => {
    app = await createApp();
    const publicResponse = await app.inject({ url: '/api/health' });
    const adminResponse = await app.inject({ url: '/admin/' });
    const moderatorResponse = await app.inject({ url: '/api/moderator/registrations' });
    const similarlyNamedResponse = await app.inject({ url: '/administer' });

    expect(publicResponse.statusCode).toBe(200);
    expect(publicResponse.json()).toEqual({ principal: null });
    expect(adminResponse.statusCode).toBe(401);
    expect(moderatorResponse.statusCode).toBe(401);
    expect(similarlyNamedResponse.statusCode).toBe(404);
  });

  it('fails production app construction when the Moderator credentials are not configured', () => {
    const app = Fastify();

    expect(() => registerModeratorBasicAuth(app, { NODE_ENV: 'production' })).toThrow(/MODERATOR_USERNAME.*MODERATOR_PASSWORD_HASH/);
  });
});
