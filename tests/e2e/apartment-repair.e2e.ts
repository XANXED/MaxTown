import { expect, test, type Page, type Route } from '@playwright/test';

const houseId = '11111111-1111-4111-8111-111111111111';
const apartmentId = '22222222-2222-4222-8222-222222222222';
const repairId = '33333333-3333-4333-8333-333333333333';

const membership = {
  id: '44444444-4444-4444-8444-444444444444',
  houseId,
  apartmentId,
  apartmentNumber: '20',
  address: 'ул. Соседская, 1',
  locality: 'Казань',
  role: 'resident',
  profileCompleted: true,
  phoneVisibleToNeighbors: false,
  neighborApartments: { left: null, right: null, below: null, above: null },
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

test('Жилец размещает Квартиру, публикует и изменяет ремонт, а Работы в Доме остаются доступны', async ({ page }) => {
  await maxBridge(page);
  let layout = [
    { apartmentId, apartmentNumber: '20', entrance: null, floor: null, column: null, canEdit: true },
    { apartmentId: '55555555-5555-4555-8555-555555555555', apartmentNumber: '21', entrance: 1, floor: 2, column: 0, canEdit: false },
  ];
  let repair: Record<string, unknown> | null = null;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/auth/max') return json(route, { token: 'Q'.repeat(43), expiresAt: '2030-01-01T00:00:00.000Z', pendingHouseSetups: [] });
    if (pathname === '/api/me') return json(route, { resident: { id: 'resident-1', maxUserId: '42', displayName: 'Анна', username: null }, memberships: [membership] });
    if (pathname.endsWith('/apartment-layout') && request.method() === 'GET') return json(route, { apartments: layout });
    if (pathname.endsWith(`/apartments/${apartmentId}/layout`) && request.method() === 'PUT') {
      const position = request.postDataJSON() as { entrance: number; floor: number; column: number };
      layout = layout.map((item) => item.apartmentId === apartmentId ? { ...item, ...position } : item);
      return json(route, { apartment: layout[0] });
    }
    if (pathname.endsWith('/apartment-repairs') && request.method() === 'GET') return json(route, { repairs: repair ? [repair] : [] });
    if (pathname.endsWith('/apartment-repairs') && request.method() === 'POST') {
      const input = request.postDataJSON() as Record<string, unknown>;
      repair = { id: repairId, houseId, apartmentId, apartmentNumber: '20', ...input, details: input.details ?? null, state: 'scheduled', version: 1, canEdit: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      return json(route, { repair }, 201);
    }
    if (pathname.endsWith(`/apartment-repairs/${repairId}`) && request.method() === 'PUT') {
      const input = request.postDataJSON() as Record<string, unknown>;
      repair = { ...repair, ...input, version: 2, updatedAt: new Date().toISOString() };
      return json(route, { repair });
    }
    if (pathname.endsWith('/repair-mode')) return json(route, { repairMode: { isActive: false, title: null, description: null, startsAt: null, expectedCompletionAt: null, instructions: null, updatedAt: null, updatedBy: null } });
    return json(route, { error: 'not_found' }, 404);
  });

  await page.goto('/#/repair-mode');
  await expect(page.getByRole('heading', { name: 'Ремонт' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Схема Квартир' })).toBeVisible();
  await page.getByLabel('Подъезд').fill('1');
  await page.getByLabel('Этаж').fill('2');
  await page.getByRole('button', { name: 'Свободная ячейка' }).first().click();
  await page.getByRole('button', { name: 'Сохранить положение' }).click();

  await expect(page.getByRole('button', { name: 'Запланировать ремонт' })).toBeVisible();
  await page.getByRole('button', { name: 'Запланировать ремонт' }).click();
  await page.getByLabel('Сверление').focus();
  await page.keyboard.press('Space');
  await page.getByPlaceholder('Что важно знать соседям — необязательно').fill('Соберём кухню без ночных работ');
  await page.getByLabel('Начало').fill('2030-10-01T10:00');
  await page.getByLabel('Окончание').fill('2030-10-01T14:00');
  await page.getByRole('button', { name: 'Сохранить' }).click();

  await expect(page.getByText('Квартира №20')).toBeVisible();
  await expect(page.getByText('Соберём кухню без ночных работ')).toBeVisible();
  await page.getByRole('button', { name: 'Изменить', exact: true }).click();
  await page.getByPlaceholder('Что важно знать соседям — необязательно').fill('Сверление закончим до обеда');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Сверление закончим до обеда')).toBeVisible();

  await page.getByRole('radio', { name: 'Работы в Доме' }).click();
  await expect(page.getByRole('heading', { name: 'Сейчас общедомовых работ нет' })).toBeVisible();
});

test('уведомление о ремонте исчезает и открывает адресную карточку', async ({ page }) => {
  await maxBridge(page);
  const repair = {
    id: repairId, houseId, apartmentId, apartmentNumber: '20', workTypes: ['drilling'], details: 'Только до обеда',
    startsAt: '2030-10-01T10:00:00.000Z', endsAt: '2030-10-01T12:00:00.000Z', state: 'scheduled', version: 1,
    canEdit: false, createdAt: '2030-09-30T10:00:00.000Z', updatedAt: '2030-09-30T10:00:00.000Z',
  };
  let read = false;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/auth/max') return json(route, { token: 'Q'.repeat(43), expiresAt: '2030-01-01T00:00:00.000Z', pendingHouseSetups: [] });
    if (pathname === '/api/me') return json(route, { resident: { id: 'resident-1', maxUserId: '42', displayName: 'Анна', username: null }, memberships: [membership] });
    if (pathname === '/api/notifications') return json(route, { notifications: read ? [] : [{ id: 'notice-1', kind: 'apartment-repair', houseId, repairId, title: 'Квартира №20: запланирован ремонт', text: 'Сверление', at: new Date().toISOString(), read: false }] });
    if (pathname === '/api/notifications/notice-1/read') { read = true; return route.fulfill({ status: 204, body: '' }); }
    if (pathname.endsWith(`/apartment-repairs/${repairId}`)) return json(route, { repair });
    if (pathname.endsWith('/apartment-repairs')) return json(route, { repairs: [repair] });
    if (pathname.endsWith('/apartment-layout')) return json(route, { apartments: [{ apartmentId, apartmentNumber: '20', entrance: 1, floor: 2, column: 0, canEdit: true }] });
    return json(route, { error: 'not_found' }, 404);
  });

  await page.goto('/#/notifications');
  await page.getByText('Квартира №20: запланирован ремонт').click();
  await expect(page).toHaveURL(new RegExp(`#\/repair-mode\/${repairId}`));
  await expect(page.getByText('Только до обеда')).toBeVisible();
  await expect.poll(() => read).toBe(true);
});
