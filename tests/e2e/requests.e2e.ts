import { test, expect, type Browser, type Page } from '@playwright/test';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { buildApp } from '../../apps/api/src/app.ts';
import { signMaxInitData } from '../../apps/api/src/auth/max-init-data.ts';
import { runMigrations } from '../../apps/api/src/db/migrate.ts';
import { createPool } from '../../apps/api/src/db/pool.ts';
import { createFakeMax, member } from '../../apps/api/src/max/fake-max.ts';

// Заявки глазами Жильца, соседа и Администратора Дома: production-сборка
// мини-аппа, настоящий API на Postgres, поддельный MAX (docs/adr/0012).

const databaseUrl = process.env.TEST_DATABASE_URL;
const botToken = 'e2e-requests-bot-token';
const chatId = -4242;
const people = { resident: 71001, admin: 71002, neighbour: 71003 } as const;
const names: Record<keyof typeof people, string> = { resident: 'Анна', admin: 'Борис', neighbour: 'Вера' };
// Настоящий PNG 1×1: телефон перед отправкой сжимает фото через canvas.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test.describe.configure({ mode: 'serial' });

test.describe('Заявки', () => {
  test.skip(!databaseUrl, 'Нужен TEST_DATABASE_URL: e2e ходит в настоящий API на Postgres');

  let pool: Pool;
  let app: FastifyInstance;

  test.beforeEach(async () => {
    pool = createPool(databaseUrl!);
    await runMigrations(pool);
    await pool.query('TRUNCATE TABLE houses CASCADE');
    await pool.query('TRUNCATE TABLE residents CASCADE');
    const house = await pool.query<{ id: string }>("INSERT INTO houses (address, locality) VALUES ('ул Лесная, д 12', 'г Казань') RETURNING id");
    await pool.query('INSERT INTO house_chats (chat_id, house_id, created_by_max_user_id) VALUES ($1, $2, $3)', [chatId, house.rows[0]!.id, people.admin]);
    for (const who of Object.keys(people) as Array<keyof typeof people>) {
      const resident = await pool.query<{ id: string }>(
        'INSERT INTO residents (max_user_id, display_name) VALUES ($1, $2) RETURNING id',
        [String(people[who]), names[who]],
      );
      await pool.query(
        `INSERT INTO memberships (house_id, resident_id, role, profile_completed_at)
         VALUES ($1, $2, $3, now())`,
        [house.rows[0]!.id, resident.rows[0]!.id, who === 'admin' ? 'admin' : 'resident'],
      );
    }
    const max = createFakeMax();
    max.chats.set(chatId, {
      title: 'Лесная 12', botIsAdmin: true,
      members: [member(people.admin, { isAdmin: true }), member(people.resident), member(people.neighbour)],
    });
    app = await buildApp({ pool, env: { NODE_ENV: 'test', BOT_TOKEN: botToken, MAX_CHAT_NOTIFICATIONS: 'off' }, max });
  });

  test.afterEach(async () => { await app.close(); });

  /** Отдельный браузер человека: свой вход через MAX и API через настоящий Fastify. */
  async function open(browser: Browser, baseURL: string | undefined, who: keyof typeof people): Promise<Page> {
    const context = await browser.newContext({ baseURL, viewport: { width: 420, height: 800 } });
    const page = await context.newPage();
    const initData = signMaxInitData({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: people[who], first_name: names[who] }),
    }, botToken);
    await page.route('https://st.max.ru/js/max-web-app.js', (route) => route.fulfill({
      contentType: 'application/javascript',
      body: `window.WebApp = ${JSON.stringify({ initData, initDataUnsafe: {} })};`,
    }));
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const body = request.postDataBuffer();
      const response = await app.inject({
        method: request.method() as 'GET',
        url: `${url.pathname}${url.search}`,
        headers: request.headers(),
        ...(body ? { payload: body } : {}),
      });
      await route.fulfill({
        status: response.statusCode,
        headers: { 'content-type': String(response.headers['content-type'] ?? 'application/json') },
        body: response.rawPayload,
      });
    });
    return page;
  }

  /** Значение поля datetime-local: браузер теста в том же часовом поясе, что и Node. */
  function localInput(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  async function requestId(title: string): Promise<string> {
    const result = await pool.query<{ id: string }>('SELECT id FROM requests WHERE title = $1', [title]);
    return result.rows[0]!.id;
  }

  test('Жилец подаёт Заявку о Квартире с фото, Администратор выполняет, Жилец подтверждает', async ({ browser, baseURL }) => {
    const resident = await open(browser, baseURL, 'resident');
    await resident.goto('/#/requests/new');
    await resident.getByRole('button', { name: 'Сантехника' }).click();
    // Без подкатегории Заявка не уходит.
    await resident.getByRole('textbox', { name: 'Что случилось?' }).fill('Течёт кран на кухне, подставили таз');
    await resident.getByRole('button', { name: 'Отправить заявку' }).click();
    await expect(resident.getByText('Выберите, что именно сломалось: так Ответственный поймёт, что взять с собой')).toBeVisible();
    await resident.getByRole('radio', { name: /Течёт смеситель или кран/ }).click();
    await resident.getByRole('textbox', { name: 'Номер Квартиры' }).fill('34');
    await resident.locator('input[type="file"]').setInputFiles({ name: 'leak.png', mimeType: 'image/png', buffer: png });
    await resident.getByRole('button', { name: 'Отправить заявку' }).click();

    await expect(resident.getByRole('heading', { name: 'Течёт кран на кухне, подставили таз' })).toBeVisible();
    await expect(resident.getByRole('img', { name: 'Фото 1 к Заявке' })).toBeVisible();
    await expect(resident.getByText('Течёт смеситель или кран', { exact: true })).toBeVisible();
    const id = await requestId('Течёт кран на кухне, подставили таз');
    expect((await pool.query('SELECT content_type FROM request_photos WHERE request_id = $1', [id])).rows).toEqual([{ content_type: 'image/jpeg' }]);

    const admin = await open(browser, baseURL, 'admin');
    await admin.goto('/#/requests');
    await expect(admin.getByRole('heading', { name: 'Заявки Дома' })).toBeVisible();
    await admin.goto(`/#/requests/${id}`);
    await expect(admin.getByText('Анна', { exact: true })).toBeVisible();
    await admin.getByRole('button', { name: 'Взять в работу' }).click();
    await expect(admin.getByRole('heading', { name: 'Заявка в работе' })).toBeVisible();
    await admin.getByRole('button', { name: 'Выполнено' }).click();
    await expect(admin.getByRole('heading', { name: 'Заявка в работе' })).toHaveCount(0);

    await resident.reload();
    await resident.getByRole('button', { name: 'Подтвердить исправление' }).click();
    await expect(resident.getByText('Исправление подтверждено, Заявка закрыта.')).toBeVisible();
    expect((await pool.query('SELECT status FROM requests WHERE id = $1', [id])).rows).toEqual([{ status: 'closed' }]);
  });

  test('проблема в Общем имуществе видна соседу на главной, «У меня тоже» и отклонение снимают тревогу', async ({ browser, baseURL }) => {
    const resident = await open(browser, baseURL, 'resident');
    await resident.goto('/#/requests/new');
    await resident.getByRole('radio', { name: 'В Общем имуществе' }).click();
    await resident.getByRole('button', { name: 'Лифты' }).click();
    await resident.getByRole('radio', { name: /Лифт не работает/ }).click();
    await resident.getByRole('textbox', { name: 'Что случилось?' }).fill('Не работает лифт во втором подъезде');
    await resident.getByRole('button', { name: 'Отправить заявку' }).click();
    await expect(resident.getByRole('heading', { name: 'Не работает лифт во втором подъезде' })).toBeVisible();

    const neighbour = await open(browser, baseURL, 'neighbour');
    await neighbour.goto('/#/');
    await expect(neighbour.getByText('Сообщили о проблеме: Не работает лифт во втором подъезде')).toBeVisible();
    await neighbour.getByRole('button', { name: /Сообщили о проблеме/ }).click();
    await expect(neighbour.getByRole('heading', { name: 'Сообщили Жильцы' })).toBeVisible();
    await neighbour.getByText('Не работает лифт во втором подъезде', { exact: true }).click();
    await expect(neighbour.getByText('Анна')).toHaveCount(0);
    await neighbour.getByRole('button', { name: 'У меня тоже' }).click();
    await expect(neighbour.getByRole('heading', { name: 'Вы отметили: у вас тоже' })).toBeVisible();

    const admin = await open(browser, baseURL, 'admin');
    await admin.goto(`/#/requests/${await requestId('Не работает лифт во втором подъезде')}`);
    await admin.getByRole('button', { name: 'Отклонить' }).click();
    await admin.getByRole('textbox', { name: 'Причина отказа' }).fill('Лифт работает, проверили с лифтовой службой');
    await admin.getByRole('button', { name: 'Отклонить' }).click();
    await expect(admin.getByText('Ответственный отклонил Заявку')).toBeVisible();

    await neighbour.goto('/#/');
    await neighbour.reload();
    await expect(neighbour.getByText('Всё работает', { exact: true })).toBeVisible();
  });

  test('в Квартире нет Категорий Общего имущества, а смена места сбрасывает неподходящий выбор', async ({ browser, baseURL }) => {
    const resident = await open(browser, baseURL, 'resident');
    await resident.goto('/#/requests/new');
    const categories = resident.getByRole('group', { name: 'Категория' });
    for (const name of ['Лифты', 'Домофон', 'Уборка', 'Интернет']) {
      await expect(categories.getByRole('button', { name })).toHaveCount(0);
    }
    await expect(categories.getByRole('button', { name: 'Вода' })).toBeVisible();

    await resident.getByRole('radio', { name: 'В Общем имуществе' }).click();
    await categories.getByRole('button', { name: 'Лифты' }).click();
    await expect(resident.getByRole('radio', { name: /Двери не закрываются/ })).toBeVisible();
    await resident.getByRole('radio', { name: 'В Квартире' }).click();
    await expect(resident.getByRole('radiogroup', { name: 'Что именно сломалось' })).toHaveCount(0);
    await expect(categories.getByRole('button', { name: 'Лифты' })).toHaveCount(0);

    // Подводка бывает только в Квартире: при переходе в Общее имущество выбор сбрасывается.
    await categories.getByRole('button', { name: 'Вода' }).click();
    await resident.getByRole('radio', { name: /Течёт подводка/ }).click();
    await expect(resident.getByRole('radio', { name: /Течёт подводка/ })).toHaveAttribute('aria-checked', 'true');
    await resident.getByRole('radio', { name: 'В Общем имуществе' }).click();
    await expect(resident.getByRole('radio', { name: /Течёт подводка/ })).toHaveCount(0);
    await expect(resident.getByRole('radio', { name: /Затопило подвал/ })).toBeVisible();
  });

  test('повторное нажатие, пока форма отправляется, не создаёт дубль', async ({ browser, baseURL }) => {
    const resident = await open(browser, baseURL, 'resident');
    // Сервер думает долго — человек успевает нажать ещё раз и нажать Enter.
    await resident.route('**/api/houses/*/management-questions', async (route) => {
      if (route.request().method() === 'POST') await new Promise((resolve) => setTimeout(resolve, 800));
      await route.fallback();
    });
    await resident.goto('/#/management-questions/new');
    await resident.getByRole('textbox', { name: 'Тема' }).fill('Когда включат отопление?');
    await resident.getByRole('textbox', { name: 'Вопрос' }).fill('В квартирах уже холодно, батареи чуть тёплые');
    // Пока идёт отправка, VKUI называет кнопку «Загрузка...»: ищем её по месту.
    const submit = resident.locator('.bottom-panel button[type="submit"]');
    await submit.click();
    await submit.click({ force: true });
    await resident.getByRole('textbox', { name: 'Тема' }).press('Enter');
    await expect(resident.getByRole('heading', { name: 'Когда включат отопление?' })).toBeVisible();
    expect((await pool.query('SELECT count(*)::int AS count FROM management_questions')).rows).toEqual([{ count: 1 }]);
  });

  test('режим ЧС: Авария в Состоянии дома — квартиры, статус, срок и «У меня тоже нет воды»', async ({ browser, baseURL }) => {
    const admin = await open(browser, baseURL, 'admin');
    await admin.goto('/#/events/new');
    await admin.getByRole('button', { name: 'Вода' }).click();
    await admin.getByRole('textbox', { name: 'Заголовок' }).fill('Нет холодной воды');
    await admin.getByRole('textbox', { name: 'Описание' }).fill('Прорыв на вводе, аварийная служба на месте');
    await admin.getByRole('button', { name: 'Открыть Аварию' }).click();

    // Карточка Аварии у Администратора: панель ЧС и Ход работ. Причину ещё выясняют, первый срок — «Срок».
    const panel = admin.getByRole('region', { name: 'Что с Аварией сейчас' });
    const works = admin.getByRole('form', { name: 'Ход работ' });
    await expect(panel.getByText('Срок', { exact: true })).toBeVisible();
    await expect(panel.getByText('уточняется', { exact: true })).toBeVisible();
    await works.getByRole('radio', { name: 'Выясняют причину' }).click();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(18, 0, 0, 0);
    await works.getByLabel('Устранят к').fill(localInput(tomorrow));
    await works.getByRole('button', { name: 'Сохранить' }).click();
    await expect(panel.getByText('выясняют причину', { exact: true })).toBeVisible();
    await expect(panel.getByText('Срок', { exact: true })).toBeVisible();

    // Жилец видит, что случилось, и подтверждает одной кнопкой — без Заявки и звонка в УК.
    const resident = await open(browser, baseURL, 'resident');
    await resident.goto('/#/house');
    const residentPanel = resident.getByRole('region', { name: 'Нет холодной воды' });
    await expect(residentPanel.getByText('Авария · Вода')).toBeVisible();
    await expect(residentPanel.getByText('0 квартир', { exact: true })).toBeVisible();
    await residentPanel.getByRole('button', { name: 'У меня тоже нет воды' }).click();
    await expect(residentPanel.getByText('1 квартира', { exact: true })).toBeVisible();
    await expect(residentPanel.getByText('Вы отметили, что у вас тоже. Уведомим, когда устранят')).toBeVisible();

    // На главной соседа — что случилось и что с работами, а не «N человек пожаловались».
    const neighbour = await open(browser, baseURL, 'neighbour');
    await neighbour.goto('/#/');
    await expect(neighbour.getByRole('heading', { name: 'Нет холодной воды' })).toBeVisible();
    await expect(neighbour.getByText(/^Выясняют причину, до/)).toBeVisible();
    await neighbour.goto('/#/house');
    await neighbour.getByRole('button', { name: 'У меня тоже нет воды' }).click();
    await expect(neighbour.getByText('2 квартиры', { exact: true })).toBeVisible();

    // УК начинает работы и переносит срок: у Жильцов «Новый срок», отметившим — уведомление.
    await works.getByRole('radio', { name: 'Аварийные работы' }).click();
    const later = new Date(tomorrow);
    later.setDate(later.getDate() + 1);
    await works.getByLabel('Срок устранения').fill(localInput(later));
    await works.getByRole('button', { name: 'Сохранить' }).click();
    await expect(panel.getByText('Новый срок', { exact: true })).toBeVisible();

    await resident.reload();
    await expect(residentPanel.getByText('аварийные работы', { exact: true })).toBeVisible();
    await expect(residentPanel.getByText('Новый срок', { exact: true })).toBeVisible();
    await residentPanel.getByRole('button', { name: 'Убрать отметку' }).click();
    await expect(residentPanel.getByText('1 квартира', { exact: true })).toBeVisible();
    await expect(residentPanel.getByRole('button', { name: 'У меня тоже нет воды' })).toBeVisible();

    // Устранили: режим ЧС уходит, отметившие узнают об этом.
    await admin.getByRole('button', { name: 'Закрыть Аварию' }).click();
    await admin.getByRole('button', { name: 'Закрыть Аварию' }).click();
    await expect(panel).toHaveCount(0);
    await neighbour.reload();
    await expect(neighbour.getByText('Всё работает', { exact: true })).toBeVisible();
    await neighbour.goto('/#/notifications');
    await expect(neighbour.getByText('Начались аварийные работы: Нет холодной воды')).toBeVisible();
    await expect(neighbour.getByText('Авария устранена: Нет холодной воды')).toBeVisible();
  });
});
