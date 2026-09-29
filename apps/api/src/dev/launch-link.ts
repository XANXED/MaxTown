import { LOCAL_BOT_TOKEN, maxLoginLink } from './max-login-link.ts';

// Ссылка входа в мини-апп без клиента MAX (см. max-login-link.ts).
//
//   npm run dev:link              → человек с MAX ID 1
//   npm run dev:link -- 2         → другой человек (открывайте в другой вкладке)
//   npm run dev:link -- 2 setup_-100500  → с параметром запуска (выбор адреса чата)
//
// Ссылка живёт MAX_INIT_DATA_TTL_SECONDS (по умолчанию 15 минут), как настоящий
// initData; `npm run local` запускает API с долгим сроком.

if (process.env.NODE_ENV === 'production') {
  console.error('dev:link только для локального запуска');
  process.exit(1);
}

const [userId = '1', startParam] = process.argv.slice(2);
if (!/^\d+$/.test(userId) || Number(userId) < 1) {
  console.error('MAX ID — положительное число, например 1 или 2');
  process.exit(1);
}

const botToken = process.env.BOT_TOKEN?.trim() || LOCAL_BOT_TOKEN;
const base = process.env.MINIAPP_URL?.trim() || 'http://localhost:5173/';
console.log(maxLoginLink({ base, maxUserId: Number(userId), botToken, ...(startParam ? { startParam } : {}) }));
