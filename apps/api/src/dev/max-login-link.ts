import { signMaxInitData } from '../auth/max-init-data.ts';

// Ссылка входа для локального запуска без клиента MAX. MAX подписывает
// initData токеном бота; здесь подписываем тем же BOT_TOKEN, и API проверяет
// подпись как у настоящего MAX — отдельного входа для разработки нет.
// Мини-апп читает initData из параметра WebAppData во фрагменте адреса, как
// у настоящего клиента MAX.

/** Токен, которым `npm run local` подписывает ссылки, если своего BOT_TOKEN нет. */
export const LOCAL_BOT_TOKEN = 'local-dev-bot-token';

export function maxLoginLink(options: { base: string; maxUserId: number; botToken: string; name?: string; startParam?: string }): string {
  const initData = signMaxInitData({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: `local-${options.maxUserId}`,
    user: JSON.stringify({ id: options.maxUserId, first_name: options.name ?? `Жилец ${options.maxUserId}`, language_code: 'ru' }),
    ...(options.startParam ? { start_param: options.startParam } : {}),
  }, options.botToken);
  const hash = new URLSearchParams({ WebAppData: initData, ...(options.startParam ? { WebAppStartParam: options.startParam } : {}) });
  return `${options.base}#${hash.toString()}`;
}
