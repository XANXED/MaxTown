import { expect, test, type Page, type Route } from '@playwright/test';
import type { HouseMembershipSummary, Meter, MeterInput, ReadingsInput, ReadingsWindow } from '@maxtown/shared';

const houseId = '71111111-1111-4111-8111-111111111111';
const apartmentId = '72222222-2222-4222-8222-222222222222';

const membership: HouseMembershipSummary = {
  id: '73333333-3333-4333-8333-333333333333',
  houseId,
  apartmentId,
  apartmentNumber: '42',
  address: 'ул. Учётная, 1',
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

test('Жилец записывает Показания и настраивает Приборы учёта Квартиры', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await maxBridge(page);
  let meters: Meter[] = [{
    id: '74444444-4444-4444-8444-444444444444',
    kind: 'cold-water',
    title: 'Холодная вода, кухня',
    unit: 'м³',
    serial: '04521873',
    decimals: 3,
    version: 1,
    previous: { value: 123.456, at: '2026-08-01' },
  }];
  const window = (): ReadingsWindow => ({
    from: '2026-09-01',
    to: '2026-09-30',
    apartment: 'Квартира 42',
    meters,
  });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/auth/max') return json(route, { token: 'Q'.repeat(43), expiresAt: '2030-01-01T00:00:00.000Z', pendingHouseSetups: [] });
    if (pathname === '/api/me') return json(route, { resident: { id: 'resident-1', maxUserId: '42', displayName: 'Анна', username: null }, memberships: [membership] });
    if (pathname.endsWith('/readings') && request.method() === 'GET') return json(route, window());
    if (pathname.endsWith('/readings') && request.method() === 'POST') {
      const input = request.postDataJSON() as ReadingsInput;
      meters = meters.map((meter) => {
        const reading = input.readings.find(({ meterId }) => meterId === meter.id);
        return reading ? { ...meter, current: { value: reading.value, at: '2026-09-30T10:00:00.000Z' } } : meter;
      });
      return json(route, window());
    }
    if (pathname.endsWith('/meters') && request.method() === 'POST') {
      const input = request.postDataJSON() as MeterInput;
      const meter: Meter = {
        id: '75555555-5555-4555-8555-555555555555',
        kind: input.kind,
        title: input.title,
        unit: 'кВт·ч',
        ...(input.serial ? { serial: input.serial } : {}),
        decimals: input.decimals,
        version: 1,
      };
      meters = [...meters, meter];
      return json(route, { meter }, 201);
    }
    if (pathname.endsWith('/75555555-5555-4555-8555-555555555555') && request.method() === 'PUT') {
      const input = request.postDataJSON() as MeterInput;
      meters = meters.map((meter) => meter.id === '75555555-5555-4555-8555-555555555555'
        ? { ...meter, ...input, version: meter.version + 1 }
        : meter);
      return json(route, { meter: meters[1] });
    }
    if (pathname.endsWith('/75555555-5555-4555-8555-555555555555/archive')) {
      meters = meters.filter(({ id }) => id !== '75555555-5555-4555-8555-555555555555');
      return route.fulfill({ status: 204, body: '' });
    }
    return json(route, { error: 'not_found' }, 404);
  });

  await page.goto('/#/utilities/readings');
  await expect(page.getByRole('heading', { name: 'ЖКУ' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Показания' })).toBeChecked();
  await page.getByRole('textbox', { name: 'Холодная вода, кухня' }).fill('124,001');
  await page.getByRole('button', { name: 'Сохранить показания' }).click();
  await expect(page.getByRole('heading', { name: 'Показания сохранены' })).toBeVisible();
  await expect(page.getByText('MaxTown не отправляет её в УК или Поставщику.')).toBeVisible();

  await page.getByRole('button', { name: 'Исправить запись' }).click();
  await expect(page.getByRole('textbox', { name: 'Холодная вода, кухня' })).toHaveValue('124,001');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Новый прибор' })).toBeVisible();
  await page.getByLabel('Тип Прибора учёта').selectOption('electricity-day');
  await page.getByLabel('Номер на приборе').fill('1187 5530');
  await page.getByRole('button', { name: 'Сохранить прибор' }).click();
  await expect(page.getByRole('button', { name: /Электричество, день.*1187 5530/ })).toBeVisible();

  await page.getByRole('button', { name: /Электричество, день.*1187 5530/ }).click();
  await page.getByLabel('Название').fill('Электричество, дневной тариф');
  await page.getByRole('button', { name: 'Сохранить прибор' }).click();
  await expect(page.getByRole('button', { name: /Электричество, дневной тариф/ })).toBeVisible();

  await page.getByRole('button', { name: /Электричество, дневной тариф/ }).click();
  await page.getByRole('button', { name: 'Убрать прибор', exact: true }).click();
  await expect(page.getByText('Его Показания останутся в истории.')).toBeVisible();
  await page.getByRole('button', { name: 'Убрать прибор', exact: true }).click();
  await expect(page.getByRole('button', { name: /Электричество, дневной тариф/ })).toHaveCount(0);
});
