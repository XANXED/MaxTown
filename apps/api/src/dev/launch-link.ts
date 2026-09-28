import { signVkLaunchParams } from '../auth/vk-launch-params.ts';

// Ссылка для локального запуска мини-аппа без VK. VK подписывает
// launch-параметры секретом приложения; здесь их подписываем тем же
// VK_APP_SECRET из .env, и API проверяет подпись как обычно — отдельного
// входа для разработки нет.
//
//   npm run dev:link              → Жилец с vk_user_id=1
//   npm run dev:link -- 2         → другой человек (открывайте в другой вкладке)
//   npm run dev:link -- 2 <hid>   → сразу в Дом с этим id

if (process.env.NODE_ENV === 'production') {
  console.error('dev:link только для локального запуска');
  process.exit(1);
}

const appId = process.env.VK_APP_ID?.trim();
const secret = process.env.VK_APP_SECRET?.trim();
if (!appId || !/^\d+$/.test(appId) || !secret) {
  console.error('Задайте в .env VK_APP_ID (число) и VK_APP_SECRET (любая строка для локального запуска)');
  process.exit(1);
}

const [userId = '1', houseId] = process.argv.slice(2);
if (!/^\d+$/.test(userId) || Number(userId) < 1) {
  console.error('vk_user_id — положительное число, например 1 или 2');
  process.exit(1);
}

const params: Record<string, string> = {
  vk_app_id: appId,
  vk_user_id: userId,
  vk_platform: 'desktop_web',
  vk_language: 'ru',
  vk_ts: String(Math.floor(Date.now() / 1000)),
};
const query = new URLSearchParams({ ...params, sign: signVkLaunchParams(params, secret), ...(houseId ? { house_id: houseId } : {}) });
const base = process.env.MINIAPP_URL?.trim() || 'http://localhost:5173/';
console.log(`${base}?${query.toString()}`);
