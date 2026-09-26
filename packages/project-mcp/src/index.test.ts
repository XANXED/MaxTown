import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';

const serverEntry = fileURLToPath(new URL('./index.ts', import.meta.url));
const children: ChildProcessWithoutNullStreams[] = [];
const tempDirectories: string[] = [];

async function requestInitialize(child: ChildProcessWithoutNullStreams) {
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk;
  });

  const response = new Promise<Record<string, unknown>>((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`MCP server did not initialize. stderr: ${stderr}`));
    }, 2_000);

    const onData = (chunk: string) => {
      output += chunk;
      const newline = output.indexOf('\n');
      if (newline === -1) return;
      const line = output.slice(0, newline);
      cleanup();
      try {
        resolve(JSON.parse(line) as Record<string, unknown>);
      } catch (error) {
        reject(new Error(`MCP server wrote invalid stdio JSON: ${line}`, { cause: error }));
      }
    };

    const onClose = (code: number | null) => {
      cleanup();
      reject(new Error(`MCP server exited before initialization (${code}). stderr: ${stderr}`));
    };

    function cleanup() {
      clearTimeout(timeout);
      child.stdout.off('data', onData);
      child.off('close', onClose);
    }

    child.stdout.setEncoding('utf8').on('data', onData);
    child.once('close', onClose);
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'MaxTown test client', version: '1.0.0' },
      },
    })}\n`);
  });

  return response;
}

afterEach(async () => {
  for (const child of children.splice(0)) {
    child.kill();
  }
  for (const directory of tempDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

test('stdio server initializes with MaxTown metadata and advertises tools and resources', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'maxtown-project-mcp-'));
  tempDirectories.push(fixtureRoot);
  await writeFile(join(fixtureRoot, 'package.json'), JSON.stringify({ name: 'maxtown' }));

  const child = spawn(process.execPath, [serverEntry], {
    cwd: fixtureRoot,
    stdio: ['pipe', 'pipe', 'pipe'] as const,
  });
  children.push(child);

  const response = await requestInitialize(child);
  expect(response).toMatchObject({
    jsonrpc: '2.0',
    id: 1,
    result: {
      serverInfo: { name: 'maxtown-project', version: '1.0.0' },
      capabilities: { tools: {}, resources: {} },
    },
  });
});
