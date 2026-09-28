import { registerShutdownHandlers, startServer } from './bootstrap.ts';

try {
  const app = await startServer({ env: process.env });
  registerShutdownHandlers(app);
} catch (error) {
  console.error('API startup failed');
  console.error(error instanceof Error ? error.message : 'Unknown startup error');
  process.exitCode = 1;
}
