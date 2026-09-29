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
    for (const key of ['BOT_TOKEN', 'MAX_WEBHOOK_SECRET', 'DADATA_API_KEY', 'POLL_VOTER_NULLIFIER_SECRET']) {
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

  it('runs production on a Timeweb server: Caddy terminates HTTPS for DOMAIN, the API stays private', async () => {
    const production = parse(await readProjectFile('compose.prod.yml')) as {
      services: Record<string, {
        image?: string;
        build?: { args?: Record<string, string> };
        environment?: Record<string, string>;
        ports?: string[];
        volumes?: string[];
        depends_on?: Record<string, { condition?: string }>;
        networks?: string[];
      }>;
    };
    const { caddy, web } = production.services;

    expect(caddy?.image).toMatch(/^caddy:2/);
    expect(caddy?.ports).toEqual(expect.arrayContaining(['80:80', '443:443']));
    expect(caddy?.volumes).toContain('./Caddyfile:/etc/caddy/Caddyfile:ro');
    expect(caddy?.depends_on?.web?.condition).toBe('service_healthy');
    expect(caddy?.networks).toEqual(['public']);
    // Наружу публикуется только Caddy; порт API из compose.yml остаётся на 127.0.0.1.
    expect(web?.ports).toBeUndefined();
    expect(web?.environment?.MAXTOWN_PUBLIC_URL).toBe('https://${DOMAIN:?set DOMAIN}');
    expect(web?.environment?.TRUST_PROXY).toBe('uniquelocal');
    expect(web?.build?.args?.VITE_DGIS_API_KEY).toBe('${DGIS_API_KEY:-}');

    const caddyfile = await readProjectFile('Caddyfile');
    expect(caddyfile).toContain('{$DOMAIN} {');
    expect(caddyfile).toContain('reverse_proxy web:3000');
    expect(caddyfile).toMatch(/www\.\{\$DOMAIN\} \{\s*redir https:\/\/\{\$DOMAIN\}\{uri\} 308/);

    const productionEnv = await readProjectFile('.env.production.example');
    expect(productionEnv).toMatch(/^DOMAIN=maxtown\.ru$/m);
    for (const key of ['BOT_TOKEN', 'MAX_WEBHOOK_SECRET', 'MAXTOWN_INTERNAL_SECRET', 'DADATA_API_KEY', 'COMPOSE_DATABASE_URL', 'POLL_VOTER_NULLIFIER_SECRET']) {
      expect(productionEnv).toMatch(new RegExp(`^${key}=`, 'm'));
    }

    const deploy = await readProjectFile('deploy/deploy.sh');
    expect(deploy).toContain('--file compose.yml --file compose.prod.yml');
    expect(deploy).toContain('pg_dump');
    expect(await readProjectFile('.github/workflows/ci.yml')).toContain('docker compose --file compose.yml --file compose.prod.yml config --quiet');
  });
});
