import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

describe('Render Blueprint', () => {
  it('defines one free Docker web service and one free PostgreSQL database', async () => {
    const blueprint = parse(await readFile(new URL('../render.yaml', import.meta.url), 'utf8')) as {
      services: Array<Record<string, unknown>>;
      databases: Array<Record<string, unknown>>;
    };

    expect(blueprint.services).toHaveLength(1);
    expect(blueprint.databases).toHaveLength(1);

    const [service] = blueprint.services;
    const [database] = blueprint.databases;
    expect(service).toMatchObject({
      type: 'web',
      runtime: 'docker',
      plan: 'free',
      dockerfilePath: './apps/api/Dockerfile',
      healthCheckPath: '/api/ready',
      autoDeployTrigger: 'checksPass',
    });
    expect(database).toMatchObject({
      name: 'maxtown-db',
      databaseName: 'maxtown',
      user: 'maxtown',
      plan: 'free',
    });
    expect(service.region).toBe(database.region);
  });

  it('uses Render database wiring and asks for deployment secrets', async () => {
    const blueprint = parse(await readFile(new URL('../render.yaml', import.meta.url), 'utf8')) as {
      services: Array<{ envVars: Array<Record<string, unknown>> }>;
      databases: Array<{ name: string }>;
    };
    const [service] = blueprint.services;
    const variables = new Map(service.envVars.map((variable) => [variable.key, variable]));

    expect(variables.get('DATABASE_URL')).toEqual({
      key: 'DATABASE_URL',
      fromDatabase: { name: blueprint.databases[0].name, property: 'connectionString' },
    });
    expect(variables.get('BOT_TOKEN')).toEqual({ key: 'BOT_TOKEN', sync: false });
    expect(variables.get('MODERATOR_PASSWORD_HASH')).toEqual({
      key: 'MODERATOR_PASSWORD_HASH',
      sync: false,
    });
    expect(variables.get('MODERATOR_USERNAME')).toMatchObject({ key: 'MODERATOR_USERNAME' });
  });
});
