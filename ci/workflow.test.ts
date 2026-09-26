import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowPath = resolve(import.meta.dirname, '../.github/workflows/ci.yml');

describe('GitHub Actions CI workflow', () => {
  it('runs locked install, typecheck, tests, production build, and Docker builds', () => {
    const workflow = readFileSync(workflowPath, 'utf8');

    expect(workflow).toContain('npm ci');
    expect(workflow).toContain('npm run typecheck');
    expect(workflow).toContain('npm test');
    expect(workflow).toContain('npm run build');
    expect(workflow).toContain('docker build');
  });

  it('uses pull request and push triggers with restricted token permissions', () => {
    const workflow = readFileSync(workflowPath, 'utf8');

    expect(workflow).toMatch(/on:\s*\n\s+push:/);
    expect(workflow).toMatch(/\n\s+pull_request:/);
    expect(workflow).toContain('permissions:');
    expect(workflow).toContain('contents: read');
  });

  it('pins every external action to a full commit SHA', () => {
    const workflow = readFileSync(workflowPath, 'utf8');
    const actionReferences = [...workflow.matchAll(/^\s+uses:\s+([^#\s]+)/gm)];

    expect(actionReferences.length).toBeGreaterThan(0);
    for (const [, reference] of actionReferences) {
      expect(reference).toMatch(/@[a-f0-9]{40}$/);
    }
  });
});
