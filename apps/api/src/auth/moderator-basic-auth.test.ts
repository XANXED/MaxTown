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

  it('accepts a Render-generated Moderator password without storing a bcrypt hash in Blueprint', async () => {
    app = Fastify();
    const generatedPassword = 'render-generated-secret-256-bit-value';
    registerModeratorBasicAuth(app, {
      NODE_ENV: 'production',
      MODERATOR_USERNAME: 'moderator',
      MODERATOR_PASSWORD: generatedPassword,
    });
    app.get('/admin/', async (request) => ({ principal: request.moderatorPrincipal }));

    const response = await app.inject({
      url: '/admin/',
      headers: { authorization: basic('moderator', generatedPassword) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ principal: 'moderator' });
  });

  it('rejects a generated Moderator password that is too short', () => {
    const app = Fastify();

    expect(() => registerModeratorBasicAuth(app, {
      NODE_ENV: 'production',
      MODERATOR_USERNAME: 'moderator',
      MODERATOR_PASSWORD: 'short-password',
    })).toThrow(/MODERATOR_PASSWORD/);
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

  it('limits failed Moderator attempts per client IP without trusting X-Forwarded-For', async () => {
    app = await createApp();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.inject({
        url: '/admin/',
        remoteAddress: '203.0.113.10',
        headers: {
          authorization: basic('moderator@example.org', 'incorrect password'),
          'x-forwarded-for': `198.51.100.${attempt + 1}`,
        },
      });
      expect(response.statusCode).toBe(401);
    }

    const blocked = await app.inject({
      url: '/admin/',
      remoteAddress: '203.0.113.10',
      headers: {
        authorization: basic('moderator@example.org', password),
        'x-forwarded-for': '198.51.100.99',
      },
    });
    const otherClient = await app.inject({
      url: '/admin/',
      remoteAddress: '203.0.113.11',
      headers: { authorization: basic('moderator@example.org', password) },
    });

    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.json()).toEqual({ error: 'moderator_rate_limited' });
    expect(otherClient.statusCode).toBe(200);
  });

  it('uses only a valid Cloudflare client IP when explicitly enabled for Render', async () => {
    app = Fastify();
    const passwordHash = await bcrypt.hash(password, 4);
    registerModeratorBasicAuth(app, {
      NODE_ENV: 'production',
      MODERATOR_USERNAME: 'moderator@example.org',
      MODERATOR_PASSWORD_HASH: passwordHash,
      RENDER: 'true',
    });
    app.get('/admin/', async () => ({ ok: true }));

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await app.inject({
        url: '/admin/',
        remoteAddress: '10.0.0.1',
        headers: {
          authorization: basic('moderator@example.org', 'incorrect password'),
          'cf-connecting-ip': '203.0.113.10',
          'x-forwarded-for': `198.51.100.${attempt + 1}`,
        },
      });
    }

    const blocked = await app.inject({
      url: '/admin/',
      remoteAddress: '10.0.0.1',
      headers: {
        authorization: basic('moderator@example.org', password),
        'cf-connecting-ip': '203.0.113.10',
        'x-forwarded-for': '198.51.100.99',
      },
    });
    const otherClient = await app.inject({
      url: '/admin/',
      remoteAddress: '10.0.0.1',
      headers: {
        authorization: basic('moderator@example.org', password),
        'cf-connecting-ip': '203.0.113.11',
      },
    });

    expect(blocked.statusCode).toBe(429);
    expect(otherClient.statusCode).toBe(200);
  });

  it('bounds concurrent bcrypt checks from one client IP', async () => {
    app = await createApp();
    const responses = await Promise.all(
      Array.from({ length: 12 }, () => app!.inject({
        url: '/api/moderator/registrations',
        remoteAddress: '203.0.113.12',
        headers: { authorization: basic('moderator@example.org', 'incorrect password') },
      })),
    );

    expect(responses.filter((response) => response.statusCode === 401)).toHaveLength(5);
    expect(responses.filter((response) => response.statusCode === 429)).toHaveLength(7);
  });

  it('reserves the remaining failure budget before concurrent password checks', async () => {
    app = await createApp();
    const remoteAddress = '203.0.113.14';
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await app.inject({
        url: '/admin/',
        remoteAddress,
        headers: { authorization: basic('moderator@example.org', 'incorrect password') },
      });
      expect(response.statusCode).toBe(401);
    }

    const burst = await Promise.all(
      Array.from({ length: 12 }, () => app!.inject({
        url: '/admin/',
        remoteAddress,
        headers: { authorization: basic('moderator@example.org', 'incorrect password') },
      })),
    );

    expect(burst.filter((response) => response.statusCode === 401)).toHaveLength(1);
    expect(burst.filter((response) => response.statusCode === 429)).toHaveLength(11);
  });

  it('clears the failed-attempt count for the same IP after a successful login', async () => {
    app = await createApp();
    const remoteAddress = '203.0.113.13';
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await app.inject({
        url: '/admin/',
        remoteAddress,
        headers: { authorization: basic('moderator@example.org', 'incorrect password') },
      });
      expect(response.statusCode).toBe(401);
    }

    const login = await app.inject({
      url: '/admin/',
      remoteAddress,
      headers: { authorization: basic('moderator@example.org', password) },
    });
    const attemptsAfterLogin = await Promise.all(
      Array.from({ length: 5 }, () => app!.inject({
        url: '/admin/',
        remoteAddress,
        headers: { authorization: basic('moderator@example.org', 'incorrect password') },
      })),
    );
    const blocked = await app.inject({
      url: '/admin/',
      remoteAddress,
      headers: { authorization: basic('moderator@example.org', 'incorrect password') },
    });

    expect(login.statusCode).toBe(200);
    expect(attemptsAfterLogin.every((response) => response.statusCode === 401)).toBe(true);
    expect(blocked.statusCode).toBe(429);
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
