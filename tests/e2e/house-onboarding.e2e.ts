import { test, expect, type Page } from '@playwright/test';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { buildApp } from '../../apps/api/src/app.ts';
import { signMaxInitData } from '../../apps/api/src/auth/max-init-data.ts';
import { runMigrations } from '../../apps/api/src/db/migrate.ts';
import { createPool } from '../../apps/api/src/db/pool.ts';
import { createFakeMax, member } from '../../apps/api/src/max/fake-max.ts';

// Подключение Дома глазами администратора Домового чата: production-сборка
// мини-аппа, настоящий API на Postgres, поддельные MAX и DaData.
// Нужен TEST_DATABASE_URL — отдельная схема, как у тестов API.

const databaseUrl = process.env.TEST_DATABASE_URL;
const chatId = -42;
const userId = 67890;
const address = 'г Казань, ул Лесная, д 12';
const street = 'ул Лесная, д 12';
const botToken = 'e2e-test-bot-token';
const webhookSecret = 'e2e-webhook-secret';

test.describe.configure({ mode: 'serial' });

function initData() {
  return signMaxInitData({
    auth_date: String(Math.floor(Date.now() / 1000)),
    start_param: `setup_${chatId}`,
    user: JSON.stringify({ id: userId, first_name: 'Анна' }),
  }, botToken);
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

test('поздний MAX Bridge сохраняет маршрут и подключает системную кнопку Назад', async ({ page }) => {
  const signed = initData();
  await page.route('https://st.max.ru/js/max-web-app.js', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `setTimeout(() => {
      window.__maxBackButtonCalls = [];
      window.WebApp = {
        initData: ${JSON.stringify(signed)},
        BackButton: {
          show() { window.__maxBackButtonCalls.push('show'); },
          hide() { window.__maxBackButtonCalls.push('hide'); },
          onClick() {},
          offClick() {}
        }
      };
    }, 100);`,
  }));
  await page.route('**/api/auth/max', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ token: 'Q'.repeat(43), expiresAt: '2030-01-01T00:00:00.000Z', pendingHouseSetups: [] }),
  }));
  await page.route('**/api/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ resident: { id: 'resident-1', maxUserId: String(userId), displayName: 'Анна', username: null }, memberships: [] }),
  }));

  await page.goto('/#/join');

  await expect(page.getByRole('heading', { name: 'Стать Жильцом' })).toBeVisible();
  await expect(page.getByPlaceholder('https://max.ru/…')).toBeVisible();
  await expect(page).toHaveURL(/#\/join/);
  await expect(page.getByText('Ваш дом в MAX')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Назад' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as Window & { __maxBackButtonCalls?: string[] }).__maxBackButtonCalls ?? [])).toContain('show');
});

test('production preview отдаёт оба favicon', async ({ request }) => {
  for (const path of ['/favicon.svg', '/favicon.ico']) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect((await response.body()).byteLength, path).toBeGreaterThan(0);
  }
});

test('ошибка отметки уведомлений не создаёт ложную прочитанность', async ({ page }) => {
  await maxBridge(page);
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/auth/max') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'Q'.repeat(43), expiresAt: '2030-01-01T00:00:00.000Z', pendingHouseSetups: [] }) });
    }
    if (pathname === '/api/me') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ resident: { id: 'resident-1', maxUserId: String(userId), displayName: 'Анна', username: null }, memberships: [] }) });
    }
    if (pathname === '/api/notifications' && request.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ notifications: [{ id: 'notice-1', kind: 'request-status', title: 'Заявка обновлена', at: new Date().toISOString(), read: false, requestId: 'request-1' }] }) });
    }
    if (pathname === '/api/notifications/read-all') {
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'failed' }) });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/#/notifications');
  await expect(page.getByText('1 новое')).toBeVisible();
  await page.getByRole('button', { name: 'Прочитать все' }).click();

  await expect(page.getByRole('alert')).toHaveText('Не удалось отметить уведомления. Попробуйте ещё раз.');
  await expect(page.getByText('1 новое')).toBeVisible();
});

test('прочитанные уведомления исчезают из ленты', async ({ page }) => {
  await maxBridge(page);
  let notificationRead = false;
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/auth/max') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'Q'.repeat(43), expiresAt: '2030-01-01T00:00:00.000Z', pendingHouseSetups: [] }) });
    }
    if (pathname === '/api/me') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ resident: { id: 'resident-1', maxUserId: String(userId), displayName: 'Анна', username: null }, memberships: [] }) });
    }
    if (pathname === '/api/notifications' && request.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ notifications: [{ id: 'notice-1', kind: 'request-status', title: 'Заявка обновлена', at: new Date().toISOString(), read: notificationRead, requestId: 'request-1' }] }) });
    }
    if (pathname === '/api/notifications/read-all' && request.method() === 'PATCH') {
      notificationRead = true;
      return route.fulfill({ status: 204, body: '' });
    }
    if (pathname === '/api/notifications/notice-1/read' && request.method() === 'PATCH') {
      notificationRead = true;
      return route.fulfill({ status: 204, body: '' });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/#/notifications');
  await expect(page.getByText('Заявка обновлена')).toBeVisible();
  await page.getByRole('button', { name: 'Прочитать все' }).click();
  await expect(page.getByText('Заявка обновлена')).toHaveCount(0);

  notificationRead = false;
  await page.reload();
  await expect(page.getByText('Заявка обновлена')).toBeVisible();
  await page.getByText('Заявка обновлена').click();
  await expect.poll(() => notificationRead).toBe(true);

  await page.goto('/#/notifications');
  await expect(page.getByText('Заявка обновлена')).toHaveCount(0);
});

test.describe('подключение Дома', () => {
  test.skip(!databaseUrl, 'Нужен TEST_DATABASE_URL: e2e ходит в настоящий API на Postgres');

  let pool: Pool;
  let app: FastifyInstance;

  test.beforeEach(async () => {
    pool = createPool(databaseUrl!);
    await runMigrations(pool);
    await pool.query('TRUNCATE TABLE houses CASCADE');
    await pool.query('TRUNCATE TABLE residents CASCADE');
    await pool.query('TRUNCATE TABLE house_chat_onboardings');
    const max = createFakeMax();
    max.chats.set(chatId, { title: 'тест2', botIsAdmin: true, members: [member(userId, { isAdmin: true })] });
    const dadata: typeof fetch = async () => Response.json({
      suggestions: [{ value: address, data: { house_fias_id: 'guid-12', fias_level: '8', city_with_type: 'г Казань' } }],
    });
    app = await buildApp({
      pool,
      env: { NODE_ENV: 'test', BOT_TOKEN: botToken, MAX_WEBHOOK_SECRET: webhookSecret, DADATA_API_KEY: 'e2e-dadata', MAX_CHAT_NOTIFICATIONS: 'off' },
      max,
      dadataFetch: dadata,
    });
  });

  test.afterEach(async () => { await app.close(); });

  for (const launch of ['MAX Bridge', 'WebAppData без моста', 'вложенный hash из web MAX'] as const) {
    test(`администратор создаёт Дом и видит его после перезагрузки (${launch})`, async ({ page }) => {
      const available = launch === 'MAX Bridge';
      await maxBridge(page, available);
      // Бота добавили в чат с названием, по которому адрес не угадать.
      const connected = await app.inject({
        method: 'POST', url: '/api/max/webhook', headers: { 'x-max-bot-api-secret': webhookSecret },
        payload: { update_type: 'bot_added', chat_id: chatId, user: { user_id: userId } },
      });
      expect(connected.statusCode).toBe(200);

      await page.route('**/api/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const response = await app.inject({
          method: request.method() as 'GET',
          url: `${url.pathname}${url.search}`,
          headers: request.headers(),
          ...(request.postData() ? { payload: request.postData()! } : {}),
        });
        await route.fulfill({ status: response.statusCode, contentType: 'application/json', body: response.body });
      });

      const launchUrl = available ? '/'
        : launch === 'вложенный hash из web MAX'
          // MAX дописывает свои данные после маршрута из настроек приложения.
          ? `/#/welcome?WebAppStartParam=setup_${chatId}#WebAppData=${encodeURIComponent(initData())}&WebAppPlatform=web`
          : '/#' + new URLSearchParams({ WebAppData: initData(), WebAppStartParam: `setup_${chatId}` });
      await page.goto(launchUrl);
      await expect(page.getByRole('heading', { name: 'Укажите адрес Дома' })).toBeVisible();
      await page.getByRole('textbox', { name: 'Адрес', exact: true }).fill('Казань, Лесная, 12');
      await page.getByRole('list', { name: 'Подсказки адреса' }).getByText(address, { exact: true }).click();
      await page.getByRole('button', { name: 'Создать Дом' }).click();
      await expect(page.getByRole('heading', { name: 'Дом создан' })).toBeVisible();
      const house = await pool.query('SELECT h.address FROM houses h JOIN house_chats c ON c.house_id = h.id WHERE c.chat_id = $1', [chatId]);
      expect(house.rows).toEqual([{ address: street }]);

      await page.getByRole('button', { name: 'Открыть Дом' }).click();
      await expect(page.getByText(street, { exact: true })).toBeVisible();
      await expect(page.getByText(/Администратор Дома/)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Стать Жильцом', exact: true })).toHaveCount(0);
      await page.reload();
      await expect(page.getByText(street, { exact: true })).toBeVisible();
      await page.getByRole('button', { name: /Всё работает/ }).click();
      await expect(page.getByRole('heading', { name: 'Состояние дома', exact: true })).toBeVisible();
      await expect(page.getByText('Все 5 Систем Дома в порядке', { exact: true })).toBeVisible();
    });
  }
});
