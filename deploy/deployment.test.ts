import { access, readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const projectRoot = new URL('../', import.meta.url);
const readProjectFile = (path: string) => readFile(new URL(path, projectRoot), 'utf8');

describe('production deployment contract', () => {
  it('uses a private database and one web service for the Mini App, Admin, and API', async () => {
    const compose = parse(await readProjectFile('compose.yml')) as {
      services: Record<string, {
        image?: string;
        build?: { dockerfile?: string };
        depends_on?: Record<string, { condition?: string }>;
        environment?: Record<string, string>;
        ports?: unknown[];
      }>;
      networks?: Record<string, { internal?: boolean }>;
    };

    expect(Object.keys(compose.services).sort()).toEqual(['postgres', 'web']);
    expect(compose.services.web?.image).toBe('${WEB_IMAGE:-maxtown-api:local}');
    expect(compose.services.web?.build?.dockerfile).toMatch(/apps\/api\/Dockerfile$/);
    expect(compose.services.web?.depends_on?.postgres?.condition).toBe('service_healthy');
    expect(compose.services.web?.environment?.PORT).toBe('3000');
    expect(compose.services.web?.environment?.DATABASE_URL).toBe('${COMPOSE_DATABASE_URL:-postgres://maxtown:change-me@postgres:5432/maxtown}');
    for (const key of ['VK_APP_ID', 'VK_APP_SECRET', 'VK_GROUP_ID', 'VK_GROUP_TOKEN', 'VK_CALLBACK_SECRET', 'VK_CALLBACK_CONFIRMATION_CODE', 'POLL_VOTER_NULLIFIER_SECRET']) {
      expect(compose.services.web?.environment?.[key]).toBeTruthy();
    }
    expect(compose.services.web?.ports).toEqual(['${WEB_PUBLISH:-127.0.0.1:3000:3000}']);
    expect(compose.services.postgres?.ports).toBeUndefined();
    expect(compose.services.postgres?.networks).toEqual(['database']);
    expect(compose.networks?.database?.internal).toBe(true);
    expect(compose.services.postgres?.environment).toMatchObject({ POSTGRES_DB: '${POSTGRES_DB:?set POSTGRES_DB}', POSTGRES_USER: '${POSTGRES_USER:?set POSTGRES_USER}', POSTGRES_PASSWORD: '${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD}' });
    expect(await readProjectFile('deploy/compose-smoke.sh')).toContain('COMPOSE_DATABASE_URL=postgres://maxtown:maxtown-smoke-database-secret@postgres:5432/maxtown');
  });

  it('uses only CI as the release gate and runs required Render checks', async () => {
    const ci = await readProjectFile('.github/workflows/ci.yml');
    const parsed = parse(ci) as { jobs?: Record<string, { steps?: Array<{ run?: string }> }> };
    const workflowNames = (await readdir(new URL('../.github/workflows/', import.meta.url))).sort();
    const actionRefs = [...ci.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?\s*$/gm)].map((match) => match[1]!);

    expect(workflowNames).toEqual(['ci.yml']);
    expect(parsed.jobs?.checks?.steps?.length).toBeGreaterThan(0);
    expect(actionRefs.length).toBeGreaterThan(0);
    expect(actionRefs.every((ref) => /@[0-9a-f]{40}$/.test(ref))).toBe(true);
    expect(ci).toContain('npm run typecheck');
    expect(ci).toContain('npm run db:migrate --workspace=@maxtown/api');
    expect(ci).toContain('npm test');
    expect(ci).toContain('npm run build');
    expect(ci).toContain('docker build --file apps/api/Dockerfile --tag maxtown-api:ci .');
    expect(ci).toContain('npm run smoke:mcp');
    expect(ci).not.toContain('apps/bot');
    await expect(access(new URL('../apps/bot', import.meta.url))).rejects.toThrow();
    expect(ci).toContain('./deploy/compose-smoke.sh maxtown-api:ci');
    expect(ci).not.toContain('packages: write');
    expect(ci).not.toMatch(/VPS_|GHCR|ssh-keyscan|workflow_run/);
    expect(ci).toMatch(/Run tests, including Render Blueprint contract/);
  });
});
