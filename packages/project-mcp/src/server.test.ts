import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createProjectMcpServer } from './server.ts';

const roots: string[] = [];

async function makeProject(options: { context?: string; rules?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'maxtown-mcp-server-'));
  roots.push(root);
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'maxtown' }));
  await writeFile(join(root, 'CONTEXT.md'), options.context ?? '# Термины\n**Жилец**: человек в доме.\n_Avoid_: пользователь');
  await writeFile(join(root, 'AGENTS.md'), options.rules ?? '# Правила\nТолько русский интерфейс.');
  await mkdir(join(root, 'design'));
  await writeFile(join(root, 'design', 'AGENTS.md'), '# Дизайн\nИспользуй токены.');
  await mkdir(join(root, 'docs', 'adr'), { recursive: true });
  await writeFile(join(root, 'docs', 'adr', '001.md'), '# Решение\nДомовой чат');
  await mkdir(join(root, 'docs', 'research'), { recursive: true });
  await writeFile(join(root, 'docs', 'research', 'sources.md'), '# Исследование\nГИС ЖКХ');
  return root;
}

async function connect(root: string) {
  const server = createProjectMcpServer(root);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server, clientTransport };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('project MCP server', () => {
  it('registers the exact project resources and tools', async () => {
    const root = await makeProject();
    const { client } = await connect(root);
    const [resources, tools] = await Promise.all([client.listResources(), client.listTools()]);

    expect(resources.resources.map(({ uri }) => uri).sort()).toEqual([
      'maxtown://context/glossary', 'maxtown://decisions', 'maxtown://project/rules',
    ]);
    expect(tools.tools.map(({ name }) => name).sort()).toEqual([
      'check_domain_language', 'search_project_knowledge',
    ]);
  });

  it('searches selected knowledge areas and returns source locations', async () => {
    const root = await makeProject();
    const { client } = await connect(root);
    const result = await client.callTool({ name: 'search_project_knowledge', arguments: { query: 'домовой чат', areas: ['decisions'] } }) as {
      content: Array<{ type: 'text'; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).not.toBe(true);
    expect(result.content[0]?.text).toContain('"line": 2');
    expect(result.content[0]?.text).toContain('docs/adr/001.md');
  });

  it('checks avoided terms and returns canonical guidance', async () => {
    const root = await makeProject();
    const { client } = await connect(root);
    const result = await client.callTool({ name: 'check_domain_language', arguments: { text: 'Пользователь открыл чат' } });

    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result)).toContain('Жилец');
    expect(JSON.stringify(result)).toContain('человек в доме');
    expect(JSON.stringify(result)).toContain('CONTEXT.md');
  });

  it('reads each resource with its source paths and current content', async () => {
    const root = await makeProject();
    const { client } = await connect(root);
    const glossary = await client.readResource({ uri: 'maxtown://context/glossary' });
    const rules = await client.readResource({ uri: 'maxtown://project/rules' });
    const decisions = await client.readResource({ uri: 'maxtown://decisions' });

    expect(JSON.stringify(glossary)).toContain('CONTEXT.md');
    expect(JSON.stringify(rules)).toContain('design/AGENTS.md');
    expect(JSON.stringify(decisions)).toContain('docs/adr/001.md');
  });

  it('returns explicit diagnostics for missing sources and malformed glossary entries', async () => {
    const root = await makeProject({ context: '# Термины\n**Жилец** человек\n_Avoid_: пользователь' });
    await rm(join(root, 'AGENTS.md'));
    const { client } = await connect(root);
    const search = await client.callTool({ name: 'search_project_knowledge', arguments: { query: 'ничего' } });
    const language = await client.callTool({ name: 'check_domain_language', arguments: { text: 'пользователь' } });

    expect(JSON.stringify(search)).toContain('AGENTS.md');
    expect(JSON.stringify(language)).toContain('недоступен');
    expect(JSON.stringify(language)).toContain('colon');
  });
});
