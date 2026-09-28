import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { hasValidModeratorBasicAuthConfiguration } from './auth/moderator-basic-auth.ts';
import { isValidPollNullifierSecret } from './auth/poll-nullifier.ts';
import { buildApp, type BuildAppOptions } from './app.ts';
import { ensureBootstrapModerator } from './db/moderators.ts';
import { runMigrations } from './db/migrate.ts';
import { createPool } from './db/pool.ts';

export type ServerAddress = { host: '0.0.0.0'; port: number };

export type StartupDependencies = {
  createPool: (databaseUrl: string) => Pool;
  runMigrations: (pool: Pool) => Promise<void>;
  ensureBootstrapModerator: (pool: Pool, principal: string) => Promise<void>;
  buildApp: (options: BuildAppOptions) => Promise<FastifyInstance>;
  listen: (app: FastifyInstance, address: ServerAddress) => Promise<void>;
};

export type StartServerOptions = {
  env: NodeJS.ProcessEnv;
  dependencies?: StartupDependencies;
};

const defaultDependencies: StartupDependencies = {
  createPool,
  runMigrations,
  ensureBootstrapModerator,
  buildApp,
  listen: async (app, address) => { await app.listen(address); },
};

function serverPort(env: NodeJS.ProcessEnv): number {
  const value = env.PORT ?? env.API_PORT ?? '3000';
  if (!/^\d+$/.test(value)) throw new Error('PORT must be an integer from 1 to 65535');
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer from 1 to 65535');
  }
  return port;
}

function validateEnvironment(env: NodeJS.ProcessEnv): { databaseUrl: string; port: number } {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const port = serverPort(env);
  if (env.POLL_VOTER_NULLIFIER_SECRET && !isValidPollNullifierSecret(env.POLL_VOTER_NULLIFIER_SECRET)) {
    throw new Error('POLL_VOTER_NULLIFIER_SECRET must contain at least 32 bytes');
  }
  const hasModeratorSetting = Boolean(env.MODERATOR_USERNAME || env.MODERATOR_PASSWORD_HASH);
  if (env.NODE_ENV === 'production') {
    if (!env.VK_APP_ID?.trim()) throw new Error('VK_APP_ID is required in production');
    if (!env.VK_APP_SECRET?.trim()) throw new Error('VK_APP_SECRET is required in production');
    if (!isValidPollNullifierSecret(env.POLL_VOTER_NULLIFIER_SECRET)) {
      throw new Error('POLL_VOTER_NULLIFIER_SECRET must contain at least 32 bytes in production');
    }
    if (!hasValidModeratorBasicAuthConfiguration(env)) {
      throw new Error('MODERATOR_USERNAME and MODERATOR_PASSWORD_HASH must contain valid Moderator credentials');
    }
  } else if (hasModeratorSetting && !hasValidModeratorBasicAuthConfiguration(env)) {
    throw new Error('MODERATOR_USERNAME and MODERATOR_PASSWORD_HASH must be configured together with a valid bcrypt hash');
  }
  return { databaseUrl, port };
}

export async function startServer({ env, dependencies: overrides }: StartServerOptions): Promise<FastifyInstance> {
  const { databaseUrl, port } = validateEnvironment(env);
  const dependencies = overrides ?? defaultDependencies;
  const pool = dependencies.createPool(databaseUrl);
  let app: FastifyInstance | undefined;

  try {
    await dependencies.runMigrations(pool);
    if (hasValidModeratorBasicAuthConfiguration(env)) {
      await dependencies.ensureBootstrapModerator(pool, env.MODERATOR_USERNAME!);
    }
    app = await dependencies.buildApp({ pool, env });
    await dependencies.listen(app, { host: '0.0.0.0', port });
    return app;
  } catch (error) {
    if (app) await app.close();
    else await pool.end();
    throw error;
  }
}

export type ShutdownSignalSource = {
  once: (signal: 'SIGINT' | 'SIGTERM', listener: () => void) => unknown;
};

export function registerShutdownHandlers(
  app: FastifyInstance,
  signals: ShutdownSignalSource = process,
): void {
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    void app.close().catch((error: unknown) => app.log.error({ err: error }, 'API shutdown failed'));
  };
  signals.once('SIGINT', close);
  signals.once('SIGTERM', close);
}
