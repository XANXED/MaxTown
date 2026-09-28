import { createHmac } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { handleRequest, type HouseChatStore } from '../../apps/bot/src/index.ts';

const chatId = -42;
const userId = 67890;
const address = 'г Казань, ул Лесная, д 12';
const botToken = 'e2e-test-bot-token';

function initData() {
  const pairs = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    start_param: `setup_${chatId}`,
    user: JSON.stringify({ id: userId, first_name: 'Анна' }),
  });
  pairs.sort();
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  pairs.set('hash', createHmac('sha256', secret).update([...pairs].map(([k, v]) => `${k}=${v}`).join('\n')).digest('hex'));
  return pairs.toString();
}

async function maxBridge(page: Page, available = true) {
  await page.route('https://st.max.ru/js/max-web-app.js', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: available ? `window.WebApp = ${JSON.stringify({ initData: initData(), initDataUnsafe: { start_param: `setup_${chatId}` } })};` : '',
  }));
}

test('зависшая проверка доступа заканчивается предложением повторить вход', async ({ page }) => {
  await maxBridge(page);
  await page.clock.install();
  let requested = false;
  await page.route('**/api/auth/max', () => { requested = true; });
  await page.goto('/');
  await expect(page.getByText('Проверяем участие в чате')).toBeVisible();
  await expect.poll(() => requested).toBe(true);
  await page.clock.fastForward(25_000);
  await expect(page.getByRole('button', { name: 'Проверить снова' })).toBeVisible();
  await expect(page.getByText('Проверяем участие в чате')).toHaveCount(0);
});

for (const available of [true, false]) {
test(`администратор создаёт Дом и видит его после перезагрузки (${available ? 'MAX Bridge' : 'WebAppData без моста'})`, async ({ page }) => {
  await maxBridge(page, available);
  const values = new Map<string, { value: string; metadata?: unknown }>();
  const store: HouseChatStore = {
    async get(key) { return values.get(key)?.value ?? null; },
    async put(key, value, options) { values.set(key, { value, metadata: options?.metadata }); },
    async delete(key) { values.delete(key); },
    async list(options) {
      return { list_complete: true, keys: [...values].filter(([k]) => k.startsWith(options?.prefix ?? '')).map(([name, v]) => ({ name, metadata: v.metadata })) };
    },
  };
  const env = { BOT_TOKEN: botToken, MAX_WEBHOOK_SECRET: 'e2e-secret', DADATA_API_KEY: 'e2e-dadata', HOUSE_CHATS: store };
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes('suggestions.dadata.ru')) return Response.json({ suggestions: [{ value: address, data: { house_fias_id: 'guid-12', fias_level: '8', city_with_type: 'г Казань' } }] });
    if (url.includes('/members/me')) return Response.json({ is_admin: true });
    if (url.includes('/members?')) return Response.json({ members: [{ user_id: userId, is_admin: true }] });
    if (new URL(url).pathname === `/chats/${chatId}`) return Response.json({ type: 'chat', status: 'active', title: 'тест2' });
    if (url.includes('/messages?')) return Response.json({ message: {} });
    throw new Error(`Unexpected request: ${url}`);
  };
  const connected = await handleRequest(new Request('https://test.example/api/max/webhook', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-max-bot-api-secret': env.MAX_WEBHOOK_SECRET },
    body: JSON.stringify({ update_type: 'bot_added', chat_id: chatId, user: { user_id: userId } }),
  }), env, fetcher);
  expect(connected.status).toBe(200);
  expect(values.has(`house-onboarding:${chatId}`)).toBe(true);
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const response = await handleRequest(new Request(request.url(), { method: request.method(), headers: request.headers(), body: request.postData() }), env, fetcher);
    await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() });
  });
  await page.goto(available ? '/' : '/#' + new URLSearchParams({ WebAppData: initData(), WebAppStartParam: `setup_${chatId}` }));
  await expect(page.getByRole('heading', { name: 'Укажите адрес Дома' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Адрес', exact: true }).fill('Казань, Лесная, 12');
  await page.getByRole('list', { name: 'Подсказки адреса' }).getByText(address, { exact: true }).click();
  await page.getByRole('button', { name: 'Создать Дом' }).click();
  await expect(page.getByRole('heading', { name: 'Дом создан' })).toBeVisible();
  expect(JSON.parse((await store.get(`house-chat:${chatId}`))!)).toMatchObject({ houseId: 'max-chat:-42', houseLabel: address });
  await page.getByRole('button', { name: 'Открыть Дом' }).click();
  await expect(page.getByRole('heading', { name: 'Мой дом', exact: true })).toBeVisible();
  await expect(page.getByText(address, { exact: true })).toBeVisible();
  await expect(page.getByText('Администратор Дома', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Стать Жильцом', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(address, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Дом подключён', exact: false }).click();
  await expect(page.getByRole('heading', { name: 'Состояние дома', exact: true })).toBeVisible();
  await expect(page.getByText('Данные о системах дома ещё не добавлены', { exact: true })).toBeVisible();
});
}
