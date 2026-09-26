import { chmod, mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { loadProjectDocuments } from './documents.ts';

const tempDirectories: string[] = [];

async function createRoot() {
  const root = await mkdtemp(join(tmpdir(), 'maxtown-project-mcp-docs-'));
  tempDirectories.push(root);
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'maxtown' }));
  return root;
}

afterEach(async () => {
  for (const directory of tempDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

test('discovers the MaxTown root from a nested start directory', async () => {
  const root = await createRoot();
  const nested = join(root, 'apps', 'miniapp', 'src');
  await mkdir(nested, { recursive: true });
  await writeFile(join(root, 'CONTEXT.md'), 'glossary');

  const result = await loadProjectDocuments(nested);

  expect(result.rootDir).toBe(await realpath(root));
  expect(result.documents).toContainEqual({
    path: 'CONTEXT.md',
    area: 'glossary',
    content: 'glossary',
  });
});

test('loads only allowlisted Markdown sources', async () => {
  const root = await createRoot();
  await mkdir(join(root, 'design'), { recursive: true });
  await mkdir(join(root, 'docs', 'adr'), { recursive: true });
  await mkdir(join(root, 'docs', 'research', 'platform'), { recursive: true });
  await mkdir(join(root, 'apps', 'api', 'src'), { recursive: true });
  await writeFile(join(root, 'CONTEXT.md'), 'glossary');
  await writeFile(join(root, 'AGENTS.md'), 'root rules');
  await writeFile(join(root, 'design', 'AGENTS.md'), 'design rules');
  await writeFile(join(root, 'docs', 'adr', '0001-choice.md'), 'decision');
  await writeFile(join(root, 'docs', 'research', 'platform', 'source.md'), 'research');
  await writeFile(join(root, 'docs', 'adr', 'notes.txt'), 'not markdown');
  await writeFile(join(root, 'apps', 'api', 'src', 'secret.ts'), 'not documentation');
  await writeFile(join(root, '.env'), 'SECRET=value');

  const result = await loadProjectDocuments(root);

  expect(result.documents.map(({ path, area }) => [path, area])).toEqual([
    ['AGENTS.md', 'rules'],
    ['CONTEXT.md', 'glossary'],
    ['design/AGENTS.md', 'rules'],
    ['docs/adr/0001-choice.md', 'decisions'],
    ['docs/research/platform/source.md', 'research'],
  ]);
  expect(result.documents.map(({ content }) => content)).not.toContain('SECRET=value');
  expect(result.diagnostics).toEqual([]);
});

test('rejects symlink targets outside the project root', async () => {
  const root = await createRoot();
  const outside = await mkdtemp(join(tmpdir(), 'maxtown-project-mcp-outside-'));
  tempDirectories.push(outside);
  await mkdir(join(root, 'docs', 'adr'), { recursive: true });
  const secret = join(outside, 'private.md');
  await writeFile(secret, 'private data');
  await symlink(secret, join(root, 'docs', 'adr', 'outside.md'));

  const result = await loadProjectDocuments(root);

  expect(result.documents.some(({ content }) => content === 'private data')).toBe(false);
  expect(result.diagnostics).toContainEqual({
    path: 'docs/adr/outside.md',
    message: 'Source resolves outside the project root.',
  });
});

test('reports missing allowlisted sources without reading elsewhere', async () => {
  const root = await createRoot();

  const result = await loadProjectDocuments(root);

  expect(result.documents).toEqual([]);
  expect(result.diagnostics.map(({ path }) => path)).toEqual([
    'AGENTS.md',
    'CONTEXT.md',
    'design/AGENTS.md',
    'docs/adr',
    'docs/research',
  ]);
});

test('reports an unreadable allowlisted file with its project-relative path', async () => {
  const root = await createRoot();
  const glossaryPath = join(root, 'CONTEXT.md');
  await writeFile(glossaryPath, 'private glossary');
  await chmod(glossaryPath, 0);

  const result = await loadProjectDocuments(root);

  expect(result.documents.some(({ path }) => path === 'CONTEXT.md')).toBe(false);
  expect(result.diagnostics).toContainEqual({
    path: 'CONTEXT.md',
    message: 'Source could not be read (EACCES).',
  });
});

test('rejects a start directory outside any MaxTown repository', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'not-maxtown-'));
  tempDirectories.push(directory);

  await expect(loadProjectDocuments(directory)).rejects.toThrow('MaxTown repository root not found');
});
