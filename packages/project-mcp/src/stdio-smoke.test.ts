import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, expect, test } from 'vitest';

const transports: StdioClientTransport[] = [];

afterEach(async () => {
  await Promise.all(transports.splice(0).map((transport) => transport.close()));
});

test('stdio process lists MCP capabilities, reads resources and closes cleanly', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['packages/project-mcp/src/index.ts'],
    cwd: process.cwd(),
    stderr: 'pipe',
  });
  transports.push(transport);
  const client = new Client({ name: 'MaxTown smoke client', version: '1.0.0' });
  await client.connect(transport);

  const [resources, tools, context] = await Promise.all([
    client.listResources(),
    client.listTools(),
    client.readResource({ uri: 'maxtown://context/glossary' }),
  ]);

  expect(resources.resources).toHaveLength(3);
  expect(tools.tools.map(({ name }) => name).sort()).toEqual(['check_domain_language', 'search_project_knowledge']);
  expect(JSON.stringify(context)).toContain('CONTEXT.md');
  await client.close();
});
