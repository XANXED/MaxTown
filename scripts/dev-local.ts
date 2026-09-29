// Локальный запуск без клиента MAX одной командой: npm run local [-- --users 3]
// Порты по умолчанию 3000, 5173, 5174; другие — API_PORT, MINIAPP_PORT, ADMIN_PORT.
//
// 1. Нет .env — создаёт его с локальными значениями (Модератор
//    moderator/moderator). Существующий .env не трогает.
// 2. Проверяет Postgres и подсказывает, что сделать, если он не готов.
// 3. Запускает API, мини-апп и панель Модератора; Ctrl+C останавливает всё.
// 4. Печатает подписанные ссылки входа (как у npm run dev:link) для
//    нескольких Жильцов — каждую открывайте в своей вкладке. Нет BOT_TOKEN в
//    .env — API и ссылки получают локальный токен: вход работает, а
//    Домовые чаты MAX — нет (для них нужен настоящий бот).

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { LOCAL_BOT_TOKEN, maxLoginLink } from '../apps/api/src/dev/max-login-link.ts';

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

# Токен бота MAX. Пусто — npm run local подпишет вход локальным токеном.
BOT_TOKEN=

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

const botToken = env.BOT_TOKEN?.trim() || LOCAL_BOT_TOKEN;
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
  // Процессу API — тот же токен, которым подписаны ссылки, и неделя жизни
  // initData, чтобы ссылка из консоли не протухала через 15 минут.
  const childEnv = { ...env, FORCE_COLOR: '1', BOT_TOKEN: botToken, MAX_INIT_DATA_TTL_SECONDS: env.MAX_INIT_DATA_TTL_SECONDS ?? '604800' };
  const child = spawn('npm', args, { cwd: root, env: childEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
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
  return maxLoginLink({ base: MINIAPP_URL, maxUserId: userId, botToken });
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
