// Локальный запуск без VK одной командой: npm run local [-- --users 3]
// Порты по умолчанию 3000, 5173, 5174; другие — API_PORT, MINIAPP_PORT, ADMIN_PORT.
//
// 1. Нет .env — создаёт его с локальными значениями (VK условный, Модератор
//    moderator/moderator). Существующий .env не трогает.
// 2. Проверяет Postgres и подсказывает, что сделать, если он не готов.
// 3. Запускает API, мини-апп и панель Модератора; Ctrl+C останавливает всё.
// 4. Печатает подписанные ссылки входа (как у npm run dev:link) для
//    нескольких Жильцов — каждую открывайте в своей вкладке.

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { signVkLaunchParams } from '../apps/api/src/auth/vk-launch-params.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const envPath = `${root}.env`;

const color = (code: number) => (text: string) => (process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text);
const bold = color(1);
const dim = color(2);
const red = color(31);
const green = color(32);

function fail(message: string, hint?: string): never {
  console.error(`\n${red('✗')} ${message}`);
  if (hint) console.error(`\n${hint}\n`);
  process.exit(1);
}

function option(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? Number(process.argv[index + 1]) : fallback;
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

// 1. .env

if (!existsSync(envPath)) {
  const hash = bcrypt.hashSync('moderator', 12);
  writeFileSync(
    envPath,
    `# Создан npm run local для локального запуска. В git не попадает.

DATABASE_URL=postgres://maxtown:maxtown@localhost:5432/maxtown
API_PORT=3000

# Условные значения VK: ими подписываются ссылки входа, ими же API проверяет подпись.
VK_APP_ID=1
VK_APP_SECRET=local-dev-secret
VK_API_VERSION=5.199

# Модератор: логин moderator, пароль moderator
MODERATOR_USERNAME=moderator
MODERATOR_PASSWORD_HASH='${hash}'

POLL_VOTER_NULLIFIER_SECRET=${randomBytes(32).toString('hex')}
`,
  );
  console.log(`${green('✓')} Создан .env для локального запуска`);
}

process.loadEnvFile(envPath);
const env = process.env;

if (env.NODE_ENV === 'production') fail('npm run local — только для локального запуска, а в окружении NODE_ENV=production');

const appId = env.VK_APP_ID?.trim();
const appSecret = env.VK_APP_SECRET?.trim();
if (!appId || !/^\d+$/.test(appId) || !appSecret) {
  fail(
    'В .env не заданы VK_APP_ID и VK_APP_SECRET',
    'Для локального запуска подойдут любые значения, например:\n  VK_APP_ID=1\n  VK_APP_SECRET=local-dev-secret',
  );
}
const databaseUrl = env.DATABASE_URL?.trim();
if (!databaseUrl) fail('В .env не задан DATABASE_URL', 'Например: DATABASE_URL=postgres://maxtown:maxtown@localhost:5432/maxtown');

// 2. Postgres

const setupHint = `Один раз на Manjaro/Arch:
  sudo pacman -S postgresql
  sudo -iu postgres initdb -D /var/lib/postgres/data
  sudo systemctl enable --now postgresql
  sudo -iu postgres psql -c "CREATE USER maxtown WITH PASSWORD 'maxtown';" -c "CREATE DATABASE maxtown OWNER maxtown;"`;

{
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    await client.query('SELECT 1');
  } catch (error) {
    const { code, message } = error as { code?: string; message: string };
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
      fail('Postgres не отвечает', `Запустите его: sudo systemctl start postgresql\n\nЕсли он ещё не установлен —\n${setupHint}`);
    }
    if (code === '28P01' || code === '28000' || code === '3D000') {
      fail(`Postgres запущен, но не пускает: ${message}`, `Создайте пользователя и базу из DATABASE_URL:\n  sudo -iu postgres psql -c "CREATE USER maxtown WITH PASSWORD 'maxtown';" -c "CREATE DATABASE maxtown OWNER maxtown;"`);
    }
    fail(`Не удалось подключиться к Postgres: ${message}`, setupHint);
  } finally {
    await client.end().catch(() => undefined);
  }
  console.log(`${green('✓')} Postgres на месте`);
}

// 3. Процессы

const apiPort = env.API_PORT ?? '3000';
const miniappPort = env.MINIAPP_PORT ?? '5173';
const adminPort = env.ADMIN_PORT ?? '5174';
const MINIAPP_URL = `http://localhost:${miniappPort}/`;
const ADMIN_URL = `http://localhost:${adminPort}/admin/`;

/** Занят ли порт: кто-то уже принимает соединения на localhost. */
function portBusy(port: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: 'localhost', port: Number(port) });
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

const ports: Array<[string, string, string]> = [
  ['API', apiPort, 'API_PORT'],
  ['мини-апп', miniappPort, 'MINIAPP_PORT'],
  ['панель', adminPort, 'ADMIN_PORT'],
];
const busy = [];
for (const [name, port, variable] of ports) if (await portBusy(port)) busy.push(`  ${name}: порт ${port} (${variable})`);
if (busy.length > 0) {
  fail(
    'Порты заняты — видимо, что-то уже запущено (npm run dev:* в другом терминале?)',
    `${busy.join('\n')}\n\nОстановите тот процесс (кто держит порт: ss -ltnp | grep <порт>) или запустите на других портах:\n  MINIAPP_PORT=5183 ADMIN_PORT=5184 API_PORT=3100 npm run local`,
  );
}
const children: ChildProcess[] = [];
let stopping = false;

function start(label: string, tint: (text: string) => string, args: string[]): void {
  const child = spawn('npm', args, { cwd: root, env: { ...env, FORCE_COLOR: '1' }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = tint(label.padEnd(8));
  const pipe = (stream: NodeJS.ReadableStream, out: NodeJS.WriteStream) => {
    let rest = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      const lines = (rest + chunk).split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) out.write(`${prefix} ${line}\n`);
    });
  };
  if (child.stdout) pipe(child.stdout, process.stdout);
  if (child.stderr) pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    if (stopping) return;
    console.error(`\n${red('✗')} ${label} остановился${code ? ` с кодом ${code}` : ''} — останавливаю остальное`);
    stop(code ?? 1);
  });
  children.push(child);
}

function stop(exitCode = 0): void {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    // Своя группа процессов: гасим npm вместе с node и vite под ним.
    try {
      if (child.pid) process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
  setTimeout(() => process.exit(exitCode), 500);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

// strictPort: если порт занят, лучше упасть, чем тихо уехать на другой — ссылки станут неверными.
start('api', color(36), ['run', 'dev', '-w', '@maxtown/api']);
start('miniapp', color(35), ['run', 'dev', '-w', '@maxtown/miniapp', '--', '--port', miniappPort, '--strictPort']);
start('admin', color(33), ['run', 'dev', '-w', '@maxtown/admin', '--', '--port', adminPort, '--strictPort']);

// 4. Ссылки

async function waitFor(url: string, seconds: number): Promise<boolean> {
  for (let attempt = 0; attempt < seconds * 2; attempt += 1) {
    if (stopping) return false;
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {
      // Ещё не поднялся.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function loginLink(userId: number): string {
  const params: Record<string, string> = {
    vk_app_id: appId as string,
    vk_user_id: String(userId),
    vk_platform: 'desktop_web',
    vk_language: 'ru',
    vk_ts: String(Math.floor(Date.now() / 1000)),
  };
  return `${MINIAPP_URL}?${new URLSearchParams({ ...params, sign: signVkLaunchParams(params, appSecret as string) })}`;
}

const [apiReady, miniappReady] = await Promise.all([
  waitFor(`http://localhost:${apiPort}/api/ready`, 60),
  waitFor(MINIAPP_URL, 60),
]);
if (!stopping) {
  if (!apiReady || !miniappReady) {
    console.error(`\n${red('✗')} ${!apiReady ? 'API' : 'Мини-апп'} не ответил за минуту — смотрите вывод выше`);
  } else {
    const users = option('users', 3);
    const moderator = env.MODERATOR_USERNAME ?? 'moderator';
    console.log(`\n${bold('MaxTown запущен локально')} ${dim('(Ctrl+C — остановить всё)')}\n`);
    for (let userId = 1; userId <= users; userId += 1) {
      console.log(`  ${bold(`Жилец ${userId}`)}  ${loginLink(userId)}`);
    }
    console.log(`\n  ${bold('Модератор')}  ${ADMIN_URL}  ${dim(`логин ${moderator}, пароль — тот, из которого сделан MODERATOR_PASSWORD_HASH`)}`);
    console.log(dim('\n  Каждого Жильца открывайте в отдельной вкладке. Ещё ссылки: npm run dev:link -- <номер>\n'));
  }
}
