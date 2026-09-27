import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = new URL('../', import.meta.url);
const readProjectFile = (path: string) => readFile(new URL(path, projectRoot), 'utf8');

describe('production deployment contract', () => {
  it('uses a private database and one web service for the Mini App, Admin, and API', () => {
    const output = execFileSync('docker', ['compose', '--file', 'compose.yml', 'config', '--format', 'json'], {
      cwd: fileURLToPath(projectRoot),
      env: {
        ...process.env,
        WEB_IMAGE: 'maxtown-api:contract-test',
        API_IMAGE: 'maxtown-api:legacy-test',
        MINIAPP_IMAGE: 'maxtown-miniapp:legacy-test',
        ADMIN_IMAGE: 'maxtown-admin:legacy-test',
        BOT_IMAGE: 'maxtown-bot:legacy-test',
        POSTGRES_DB: 'maxtown',
        POSTGRES_USER: 'maxtown',
        POSTGRES_PASSWORD: 'test-only-password',
        DATABASE_URL: 'postgres://maxtown:test-only-password@postgres:5432/maxtown',
        BOT_TOKEN: 'test-only-token',
        DOMAIN: 'localhost',
        MODERATOR_USERNAME: 'smoke-moderator',
        MODERATOR_PASSWORD_HASH: '$2a$04$test-only-placeholder-hash',
      },
      encoding: 'utf8',
    });
    const compose = JSON.parse(output) as {
      services: Record<string, {
        image?: string;
        build?: { dockerfile?: string };
        depends_on?: Record<string, { condition?: string }>;
        environment?: Record<string, string>;
        ports?: unknown[];
      }>;
    };

    expect(Object.keys(compose.services).sort()).toEqual(['postgres', 'web']);
    expect(compose.services.web?.image).toBe('maxtown-api:contract-test');
    expect(compose.services.web?.build?.dockerfile).toMatch(/apps\/api\/Dockerfile$/);
    expect(compose.services.web?.depends_on?.postgres?.condition).toBe('service_healthy');
    expect(compose.services.web?.environment?.PORT).toBe('3000');
    expect(compose.services.web?.ports).toHaveLength(1);
    expect(compose.services.postgres?.ports).toBeUndefined();
  });

  it('pins every external action in GitHub workflows to a full commit SHA', async () => {
    const workflow = await readProjectFile('.github/workflows/deploy.yml');
    const ci = await readProjectFile('.github/workflows/ci.yml');
    for (const yaml of [workflow, ci]) {
      const actionRefs = [...yaml.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?\s*$/gm)].map((match) => match[1]!);
      expect(actionRefs.length).toBeGreaterThan(0);
      expect(actionRefs.every((ref) => /@[0-9a-f]{40}$/.test(ref))).toBe(true);
    }
    expect(workflow).toContain("workflow_run:");
    expect(workflow).toContain("conclusion == 'success'");
    expect(workflow).toContain('packages: write');
  });
});
