import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const projectRoot = new URL('../', import.meta.url);
const readProjectFile = (path: string) => readFile(new URL(path, projectRoot), 'utf8');

describe('production deployment contract', () => {
  it('keeps the database private and gates API startup on successful migration', async () => {
    const compose = await readProjectFile('compose.yml');
    const smokeCompose = await readProjectFile('deploy/compose.smoke.yml');
    expect(compose).toContain('postgres-data:/var/lib/postgresql/data');
    expect(compose).toContain('condition: service_healthy');
    expect(compose).toContain('condition: service_completed_successfully');
    expect(compose).toContain('internal: true');
    expect(compose).not.toMatch(/postgres:[\s\S]{0,120}?ports:/);
    expect(smokeCompose).toContain('volumes: !reset []');
    expect(smokeCompose).toContain('/var/lib/postgresql/data');
  });

  it('requires digest-pinned image references and restores the previous release after candidate failure', async () => {
    const script = await readProjectFile('deploy/deploy.sh');
    expect(script).toContain('ghcr\\.io/');
    expect(script).toContain('@sha256:[0-9a-f]{64}');
    expect(script).toContain('current-release');
    expect(script).toContain('restoring previous digest-pinned release');
    expect(script).toContain('pg_dump');
    expect(script).toContain('smoke.sh');
    expect(script).not.toContain('down -v');
  });

  it('protects all production credentials as placeholders and documents the deployment bootstrap', async () => {
    const example = await readProjectFile('.env.production.example');
    const guide = await readProjectFile('docs/deployment.md');
    expect(example).toContain('BOT_TOKEN=replace_with_max_bot_token');
    expect(example).toContain('MODERATOR_PASSWORD_HASH=');
    expect(guide).toContain('read:packages');
    expect(guide).toContain('INSERT INTO moderators');
    expect(guide).toContain('backup');
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
