import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';

const challenge = 'Basic realm="MaxTown Moderator", charset="UTF-8"';
const principalPattern = /^[A-Za-z0-9_.@-]{1,100}$/;
const bcryptHashPattern = /^\$2[aby]\$(\d{2})\$[./A-Za-z0-9]{53}$/;
const maxEncodedCredentialsLength = 4 * 1024;

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

    let passwordMatches = false;
    try {
      passwordMatches = await bcrypt.compare(supplied.password, credentials.passwordHash);
    } catch {
      passwordMatches = false;
    }

    if (supplied.username !== credentials.username || !passwordMatches) {
      reply.header('WWW-Authenticate', challenge);
      return reply.code(401).send({ error: 'moderator_authentication_required' });
    }

    request.moderatorPrincipal = credentials.username;
  });
}
