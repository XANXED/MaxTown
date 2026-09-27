import bcrypt from 'bcryptjs';
import { isIP } from 'node:net';
import type { FastifyInstance } from 'fastify';

const challenge = 'Basic realm="MaxTown Moderator", charset="UTF-8"';
const principalPattern = /^[A-Za-z0-9_.@-]{1,100}$/;
const bcryptHashPattern = /^\$2[aby]\$(\d{2})\$[./A-Za-z0-9]{53}$/;
const maxEncodedCredentialsLength = 4 * 1024;
const maxFailedAttempts = 5;
const failureWindowMs = 15 * 60 * 1000;
const maxTrackedClients = 10_000;
const maxConcurrentChecksPerClient = 5;

type FailedAuthWindow = { count: number; inFlight: number; generation: number; resetAt: number };

type ModeratorCredentials = {
  username: string;
  passwordHash: string;
};

function readCredentials(env: NodeJS.ProcessEnv): ModeratorCredentials | null {
  const username = env.MODERATOR_USERNAME;
  const passwordHash = env.MODERATOR_PASSWORD_HASH;
  if (!username || !passwordHash) return null;

  const hashMatch = bcryptHashPattern.exec(passwordHash);
  if (!principalPattern.test(username) || !hashMatch) return null;
  const cost = Number(hashMatch[1]);
  if (cost < 4 || cost > 16) return null;

  return { username, passwordHash };
}

export function hasValidModeratorBasicAuthConfiguration(env: NodeJS.ProcessEnv): boolean {
  return readCredentials(env) !== null;
}

function isModeratorPath(path: string): boolean {
  return path === '/admin' || path.startsWith('/admin/') || path.startsWith('/api/moderator/');
}

function decodeBasicCredentials(header: string | undefined): { username: string; password: string } | null {
  if (!header) return null;
  const match = /^Basic ([A-Za-z0-9+/]*={0,2})$/i.exec(header);
  const encoded = match?.[1];
  if (!encoded || encoded.length > maxEncodedCredentialsLength) return null;

  try {
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) return null;
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const separator = decoded.indexOf(':');
    if (separator < 1) return null;
    return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

export function registerModeratorBasicAuth(app: FastifyInstance, env: NodeJS.ProcessEnv): void {
  const credentials = readCredentials(env);
  if (env.NODE_ENV === 'production' && !credentials) {
    throw new Error('MODERATOR_USERNAME and MODERATOR_PASSWORD_HASH must contain valid Moderator credentials');
  }

  app.decorateRequest('moderatorPrincipal', null);
  const failedAttempts = new Map<string, FailedAuthWindow>();
  app.addHook('onRequest', async (request, reply) => {
    const path = request.raw.url?.split(/[?#]/, 1)[0] ?? '/';
    if (!isModeratorPath(path)) return;

    if (!credentials) {
      return reply.code(503).send({ error: 'moderator_authentication_unavailable' });
    }

    const supplied = decodeBasicCredentials(request.headers.authorization);
    if (!supplied) {
      reply.header('WWW-Authenticate', challenge);
      return reply.code(401).send({ error: 'moderator_authentication_required' });
    }

    const cloudflareClientIp = env.RENDER === 'true' ? request.headers['cf-connecting-ip'] : undefined;
    const clientKey = typeof cloudflareClientIp === 'string' && isIP(cloudflareClientIp)
      ? cloudflareClientIp
      : request.ip;
    const now = Date.now();
    let authWindow = failedAttempts.get(clientKey);
    if (authWindow && authWindow.resetAt <= now) {
      authWindow.count = 0;
      authWindow.resetAt = now + failureWindowMs;
      authWindow.generation += 1;
    }
    if (authWindow && authWindow.count + authWindow.inFlight >= maxFailedAttempts) {
      reply.header('Retry-After', String(Math.max(1, Math.ceil((authWindow.resetAt - now) / 1000))));
      return reply.code(429).send({ error: 'moderator_rate_limited' });
    }
    if (authWindow && authWindow.inFlight >= maxConcurrentChecksPerClient) {
      reply.header('Retry-After', '1');
      return reply.code(429).send({ error: 'moderator_rate_limited' });
    }
    if (!authWindow) {
      if (failedAttempts.size >= maxTrackedClients) {
        const oldestClient = failedAttempts.keys().next().value;
        if (oldestClient) failedAttempts.delete(oldestClient);
      }
      authWindow = { count: 0, inFlight: 0, generation: 0, resetAt: now + failureWindowMs };
    }
    authWindow.inFlight += 1;
    const generation = authWindow.generation;
    failedAttempts.delete(clientKey);
    failedAttempts.set(clientKey, authWindow);

    let passwordMatches = false;
    try {
      passwordMatches = await bcrypt.compare(supplied.password, credentials.passwordHash);
    } catch {
      passwordMatches = false;
    }

    authWindow.inFlight -= 1;
    if (supplied.username !== credentials.username || !passwordMatches) {
      if (authWindow.generation === generation) {
        authWindow.count += 1;
      }
      if (authWindow.count === 0 && authWindow.inFlight === 0 && failedAttempts.get(clientKey) === authWindow) {
        failedAttempts.delete(clientKey);
      }
      reply.header('WWW-Authenticate', challenge);
      return reply.code(401).send({ error: 'moderator_authentication_required' });
    }

    if (failedAttempts.get(clientKey) === authWindow) {
      authWindow.count = 0;
      authWindow.resetAt = Date.now() + failureWindowMs;
      authWindow.generation += 1;
      if (authWindow.inFlight === 0) failedAttempts.delete(clientKey);
    }
    request.moderatorPrincipal = credentials.username;
  });
}
