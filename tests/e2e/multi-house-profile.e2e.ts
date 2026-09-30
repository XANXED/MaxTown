import { expect, test, type Page, type Route } from '@playwright/test';
import type { HouseMembershipSummary, MeResponse, ResidentHouseProfileInput } from '@maxtown/shared';

const firstHouseId = '81111111-1111-4111-8111-111111111111';
const secondHouseId = '82222222-2222-4222-8222-222222222222';

function membership(houseId: string, address: string, apartmentNumber: string, floor: number): HouseMembershipSummary {
  return {
    id: houseId === firstHouseId ? '83333333-3333-4333-8333-333333333333' : '84444444-4444-4444-8444-444444444444',
    houseId,
    apartmentId: houseId === firstHouseId ? '85555555-5555-4555-8555-555555555555' : '86666666-6666-4666-8666-666666666666',
    apartmentNumber,
    apartmentFloor: floor,
    apartmentEntrance: null,
    address,
    locality: 'Казань',
    role: 'resident',
    profileCompleted: true,
    phoneVisibleToNeighbors: false,
    neighborApartments: { left: null, right: null, below: null, above: null },
  };
}

async function maxBridge(page: Page) {
  await page.route('https://st.max.ru/js/max-web-app.js', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `window.WebApp = { initData: 'signed-test-data', initDataUnsafe: { user: { first_name: 'Анна' } } };`,
  }));
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

test('человек переключает активный Дом и редактирует профиль его Квартиры', async ({ page }) => {
  await maxBridge(page);
  let memberships = [
    membership(firstHouseId, 'ул. Первая, 1', '12', 3),
    membership(secondHouseId, 'ул. Вторая, 2', '34', 8),
  ];
  const profile = (): MeResponse => ({
    resident: { id: 'resident-1', maxUserId: '42', displayName: 'Анна', username: null, phone: null, phoneVerified: false },
    memberships,
  });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/auth/max') return json(route, { token: 'Q'.repeat(43), expiresAt: '2030-01-01T00:00:00.000Z', pendingHouseSetups: [] });
    if (pathname === '/api/me' && request.method() === 'GET') return json(route, profile());
    const accessHouseId = /^\/api\/houses\/([^/]+)\/apartment-access$/.exec(pathname)?.[1];
    if (accessHouseId && request.method() === 'GET') {
      const item = memberships.find(({ houseId }) => houseId === accessHouseId)!;
      return json(route, {
        status: 'joined', pendingRequest: null, incomingRequests: [],
        apartment: { id: item.apartmentId, number: item.apartmentNumber, floor: item.apartmentFloor, entrance: item.apartmentEntrance },
      });
    }
    if (accessHouseId && request.method() === 'POST') {
      const input = request.postDataJSON() as { apartmentNumber: string; floor: number; entrance: number | null };
      memberships = memberships.map((item) => item.houseId === accessHouseId
        ? { ...item, apartmentFloor: input.floor, apartmentEntrance: input.entrance }
        : item);
      const item = memberships.find(({ houseId }) => houseId === accessHouseId)!;
      return json(route, { status: 'joined', state: {
        status: 'joined', pendingRequest: null, incomingRequests: [],
        apartment: { id: item.apartmentId, number: item.apartmentNumber, floor: item.apartmentFloor, entrance: item.apartmentEntrance },
      } }, 201);
    }
    if (pathname === `/api/me/houses/${secondHouseId}/profile` && request.method() === 'PUT') {
      const input = request.postDataJSON() as ResidentHouseProfileInput;
      memberships = memberships.map((item) => item.houseId === secondHouseId ? {
        ...item,
        phoneVisibleToNeighbors: input.phoneVisibleToNeighbors,
        neighborApartments: input.neighborApartments,
      } : item);
      return json(route, profile());
    }
    return json(route, { error: 'not_found' }, 404);
  });

  await page.goto('/#/profile');
  await expect(page.getByRole('heading', { name: 'Мои дома' })).toBeVisible();
  await expect(page.getByRole('button', { name: /ул\. Первая, 1.*Текущий/ })).toBeVisible();

  await page.getByRole('button', { name: /ул\. Вторая, 2/ }).click();
  await expect(page.getByRole('button', { name: /ул\. Вторая, 2.*Текущий/ })).toBeVisible();
  await expect(page.getByText('Квартира 34 · 8-й этаж')).toBeVisible();

  await page.getByRole('button', { name: /Профиль Квартиры/ }).click();
  await expect(page).toHaveURL(/#\/profile\/house/);
  await expect(page.getByRole('heading', { name: 'Профиль Квартиры' })).toBeVisible();
  await expect(page.getByLabel('Номер Квартиры')).toHaveValue('34');
  await expect(page.getByLabel('Номер Квартиры')).toHaveAttribute('readonly', '');
  await page.getByLabel('Этаж').fill('9');
  await page.getByRole('button', { name: 'Сохранить расположение' }).click();
  await page.getByRole('button', { name: 'Соседние Квартиры и показ телефона' }).click();
  await expect(page.getByLabel('Номер вашей квартиры')).toHaveAttribute('readonly', '');
  await page.getByLabel('Слева').fill('34');
  await page.getByRole('button', { name: 'Сохранить изменения' }).click();

  await expect(page).toHaveURL(/#\/profile\/house/);
  await page.reload();
  await expect(page.getByLabel('Номер Квартиры')).toHaveValue('34');
  await expect(page.getByLabel('Этаж')).toHaveValue('9');
  await page.goto('/#/profile');
  await expect(page.getByText('Квартира 34 · 9-й этаж')).toBeVisible();
  await page.getByRole('button', { name: /Данные и приватность/ }).click();
  await expect(page).toHaveURL(/#\/privacy$/);
  await expect(page.getByRole('heading', { name: 'Данные и приватность' })).toBeVisible();
  await expect(page.getByText('УК и соседи их не видят.')).toBeVisible();
});
