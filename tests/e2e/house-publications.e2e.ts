import { expect, test, type Page, type Route } from '@playwright/test';
import type { HouseEventDetails, HouseEventSummary, HouseMembershipSummary, HousePublicationInput } from '@maxtown/shared';

const houseId = '91111111-1111-4111-8111-111111111111';
const eventId = '92222222-2222-4222-8222-222222222222';
const membership: HouseMembershipSummary = {
  id: '93333333-3333-4333-8333-333333333333', houseId, apartmentId: null, apartmentNumber: null,
  address: 'ул. Плановая, 1', locality: 'Казань', role: 'management-company', profileCompleted: true,
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

test('УК публикует Плановое отключение и открывает его карточку', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await maxBridge(page);
  let event: HouseEventDetails | null = null;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/auth/max') return json(route, { token: 'Q'.repeat(43), expiresAt: '2030-01-01T00:00:00.000Z', pendingHouseSetups: [] });
    if (pathname === '/api/me') return json(route, { resident: { id: 'resident-uk', maxUserId: '77', displayName: 'Ольга', username: null, phone: null, phoneVerified: false }, memberships: [membership] });
    if (pathname.endsWith('/requests') && request.method() === 'GET') return json(route, { requests: [] });
    if (pathname.endsWith('/events') && request.method() === 'GET') return json(route, { events: event ? [event satisfies HouseEventSummary] : [] });
    if (pathname.endsWith('/events/publications') && request.method() === 'POST') {
      const input = request.postDataJSON() as HousePublicationInput;
      event = {
        id: eventId, ...input,
        author: { name: 'Ольга', role: 'УК' },
      };
      return json(route, { event }, 201);
    }
    if (pathname.endsWith(`/events/${eventId}`) && event) return json(route, { event });
    if (pathname.endsWith(`/events/${eventId}/publication`) && request.method() === 'DELETE') {
      event = null;
      return route.fulfill({ status: 204, body: '' });
    }
    return json(route, { error: 'not_found' }, 404);
  });

  await page.goto('/#/events');
  await page.getByRole('button', { name: 'Добавить Событие' }).click();
  await expect(page.getByRole('heading', { name: 'Новое Событие' })).toBeVisible();
  await page.getByRole('radio', { name: 'Отключение' }).click();
  await page.getByRole('button', { name: 'Вода' }).click();
  await page.getByRole('textbox', { name: 'Заголовок' }).fill('Отключение горячей воды');
  await page.getByRole('textbox', { name: 'Описание' }).fill('Подрядчик меняет задвижку на вводе в Дом.');
  await page.getByRole('textbox', { name: 'Где' }).fill('Весь Дом');
  await page.locator('#event-start').fill('2030-10-12T09:00');
  await page.locator('#accident-until').fill('2030-10-12T18:00');
  await page.getByRole('textbox', { name: 'Что делать Жильцам' }).fill('Наберите воду заранее');
  await page.getByRole('button', { name: 'Опубликовать Событие' }).click();

  await expect(page).toHaveURL(new RegExp(`#\/events\/${eventId}`));
  await expect(page.getByRole('heading', { name: 'Отключение горячей воды' })).toBeVisible();
  await expect(page.getByText('Подрядчик меняет задвижку на вводе в Дом.')).toBeVisible();
  await expect(page.getByText('Наберите воду заранее')).toBeVisible();
  expect(event).toMatchObject({ kind: 'planned-outage', systems: ['Вода'] });
  await page.getByRole('button', { name: 'Убрать Событие' }).click();
  await expect(page.getByRole('heading', { name: 'Убрать Событие?' })).toBeVisible();
  await page.getByRole('button', { name: 'Убрать', exact: true }).click();
  await expect(page).toHaveURL(/#\/events$/);
});
