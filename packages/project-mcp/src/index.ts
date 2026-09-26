import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { findProjectRoot } from './documents.ts';
import { createProjectMcpServer } from './server.ts';

const rootDir = await findProjectRoot(process.cwd());
const server: McpServer = createProjectMcpServer(rootDir);

await server.connect(new StdioServerTransport());
