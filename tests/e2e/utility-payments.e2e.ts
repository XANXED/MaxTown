import { expect, test, type Page, type Route } from '@playwright/test';

const houseId = '11111111-1111-4111-8111-111111111111';
const apartmentId = '22222222-2222-4222-8222-222222222222';
const templateId = '33333333-3333-4333-8333-333333333333';
const periodId = '44444444-4444-4444-8444-444444444444';

const membership = {
  id: '55555555-5555-4555-8555-555555555555', houseId, apartmentId, apartmentNumber: '42',
  address: 'ул. Сроков, 1', locality: 'Казань', role: 'resident', profileCompleted: true,
  phoneVisibleToNeighbors: false, neighborApartments: { left: null, right: null, below: null, above: null },
};

async function maxBridge(page: Page) {
  await page.route('https://st.max.ru/js/max-web-app.js', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `window.WebApp = { initData: 'signed-test-data', initDataUnsafe: {} };`,
  }));
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

test('Квартира создаёт график, отмечает оплату и прикладывает Чек', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await maxBridge(page);
  let template: Record<string, unknown> | null = null;
  let period: Record<string, unknown> | null = null;
  const overview = () => ({
    apartmentId, apartmentNumber: '42', today: '2026-09-30',
    templates: template ? [template] : [], periods: period ? [period] : [],
  });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/auth/max') return json(route, { token: 'Q'.repeat(43), expiresAt: '2030-01-01T00:00:00.000Z', pendingHouseSetups: [] });
    if (pathname === '/api/me') return json(route, { resident: { id: 'resident-1', maxUserId: '42', displayName: 'Анна', username: null }, memberships: [membership] });
    if (pathname.endsWith('/utility-payments') && request.method() === 'GET') return json(route, overview());
    if (pathname.endsWith('/utility-payments/templates') && request.method() === 'POST') {
      const input = request.postDataJSON() as Record<string, unknown>;
      template = { id: templateId, houseId, apartmentId, ...input, archivedAt: null, version: 1, createdAt: '2026-09-30T09:00:00.000Z', updatedAt: '2026-09-30T09:00:00.000Z' };
      period = { id: periodId, templateId, houseId, apartmentId, billingMonth: '2026-09-01', category: input.category, title: input.title, dueOn: '2026-09-30', state: 'due-today', paidAt: null, skippedAt: null, version: 1, receipt: null };
      return json(route, { template }, 201);
    }
    if (pathname.endsWith(`/periods/${periodId}`) && request.method() === 'GET') return json(route, { period: { ...period, events: [] } });
    if (pathname.endsWith(`/periods/${periodId}/pay`)) {
      period = { ...period, state: 'paid', paidAt: '2026-09-30T10:00:00.000Z', version: 2 };
      return json(route, { period });
    }
    if (pathname.endsWith(`/periods/${periodId}/receipt`) && request.method() === 'PUT') {
      period = { ...period, receipt: { fileName: 'чек.pdf', contentType: 'application/pdf', size: 64, url: `${pathname}`, uploadedBy: 'Анна', uploadedAt: '2026-09-30T10:01:00.000Z' } };
      return json(route, { period });
    }
    if (pathname.endsWith('/utility-payments/periods')) return json(route, { periods: period ? [period] : [], nextCursor: null });
    return json(route, { error: 'not_found' }, 404);
  });

  await page.goto('/#/utilities');
  await expect(page.getByRole('heading', { name: 'ЖКУ' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Платежи' })).toBeChecked();
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByLabel('Категория').selectOption('electricity');
  await page.getByLabel('Название').fill('Электричество');
  await page.getByLabel('Оплатить до').fill('30');
  await page.getByLabel('Первый месяц').fill('2026-09');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('button', { name: /Электричество.*До 30 сентября/ })).toBeVisible();

  await page.getByRole('button', { name: /Электричество.*До 30 сентября/ }).click();
  await expect(page).toHaveURL(new RegExp(`#\/utilities\/payments\/${periodId}`));
  await page.getByRole('button', { name: 'Отметить оплаченным' }).click();
  await expect(page.getByText('Оплачено', { exact: true })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({ name: 'чек.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nтест') });
  await expect(page.getByText('чек.pdf')).toBeVisible();

  await page.goto('/#/');
  await expect(page.getByText('Все платежи отмечены')).toBeVisible();

  await page.goto('/#/readings');
  await expect(page.getByRole('heading', { name: 'ЖКУ' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Показания' })).toBeChecked();
});

test('Уведомление о сроке исчезает и открывает Платёжный период', async ({ page }) => {
  await maxBridge(page);
  let read = false;
  const period = {
    id: periodId, templateId, houseId, apartmentId, billingMonth: '2026-09-01', category: 'rent', title: 'Квартплата',
    dueOn: '2026-09-30', state: 'due-today', paidAt: null, skippedAt: null, version: 1, receipt: null, events: [],
  };
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/auth/max') return json(route, { token: 'Q'.repeat(43), expiresAt: '2030-01-01T00:00:00.000Z', pendingHouseSetups: [] });
    if (pathname === '/api/me') return json(route, { resident: { id: 'resident-1', maxUserId: '42', displayName: 'Анна', username: null }, memberships: [membership] });
    if (pathname === '/api/notifications') return json(route, { notifications: read ? [] : [{ id: 'notice-1', kind: 'utility-payment', houseId, utilityPaymentPeriodId: periodId, title: 'Сегодня срок оплаты', text: 'Квартплата · 30 сентября', at: new Date().toISOString(), read: false }] });
    if (pathname === '/api/notifications/notice-1/read') { read = true; return json(route, { status: 'read' }); }
    if (pathname.endsWith(`/utility-payments/periods/${periodId}`)) return json(route, { period });
    return json(route, { error: 'not_found' }, 404);
  });

  await page.goto('/#/notifications');
  await page.getByText('Сегодня срок оплаты').click();
  await expect(page).toHaveURL(new RegExp(`#\/utilities\/payments\/${periodId}`));
  await expect(page.getByRole('heading', { name: 'Квартплата' })).toBeVisible();
  await expect.poll(() => read).toBe(true);
});
