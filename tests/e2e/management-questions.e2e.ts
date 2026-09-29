import { expect, test, type Page, type Route } from '@playwright/test';
import type { HouseMembershipSummary, ManagementQuestion } from '@maxtown/shared';

const houseId = '61111111-1111-4111-8111-111111111111';
const questionId = '62222222-2222-4222-8222-222222222222';

function membership(role: HouseMembershipSummary['role']): HouseMembershipSummary {
  return {
    id: '63333333-3333-4333-8333-333333333333',
    houseId,
    apartmentId: role === 'management-company' ? null : '64444444-4444-4444-8444-444444444444',
    apartmentNumber: role === 'management-company' ? null : '42',
    address: 'ул. Тепловая, 7',
    locality: 'Санкт-Петербург',
    role,
    profileCompleted: true,
    phoneVisibleToNeighbors: false,
    neighborApartments: { left: null, right: null, below: null, above: null },
  };
}

async function maxBridge(page: Page) {
  await page.route('https://st.max.ru/js/max-web-app.js', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `window.WebApp = { initData: 'signed-test-data', initDataUnsafe: {} };`,
  }));
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function question(overrides: Partial<ManagementQuestion> = {}): ManagementQuestion {
  const at = '2030-09-30T10:00:00.000Z';
  return {
    id: questionId,
    title: 'Когда включат отопление?',
    state: 'waiting-for-answer',
    authorName: 'Анна',
    updatedAt: at,
    messages: [{ id: 'message-1', authorName: 'Анна', authorRole: 'resident', mine: true, text: 'В доме уже холодно.', photos: [], at }],
    history: [{ state: 'waiting-for-answer', at }],
    canWrite: true,
    canClose: true,
    canReopen: false,
    ...overrides,
  };
}

test('автор публикует вопрос без назначенной УК, закрывает и возобновляет его', async ({ page }) => {
  await maxBridge(page);
  let current: ManagementQuestion | null = null;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/auth/max') return json(route, { token: 'Q'.repeat(43), expiresAt: '2030-01-01T00:00:00.000Z', pendingHouseSetups: [] });
    if (pathname === '/api/me') return json(route, { resident: { id: 'resident-1', maxUserId: '42', displayName: 'Анна', username: null, phone: null, phoneVerified: false }, memberships: [membership('resident')] });
    if (pathname.endsWith('/management-questions') && request.method() === 'GET') {
      return json(route, { managementAssigned: false, questions: current ? [current] : [] });
    }
    if (pathname.endsWith('/management-questions') && request.method() === 'POST') {
      const input = request.postDataJSON() as { title: string; text: string };
      current = question({ title: input.title, messages: [{ ...question().messages[0]!, text: input.text }] });
      return json(route, { question: current }, 201);
    }
    if (pathname.endsWith(`/management-questions/${questionId}`) && request.method() === 'GET') {
      return json(route, { managementAssigned: false, question: current });
    }
    if (pathname.endsWith(`/management-questions/${questionId}/close`)) {
      current = question({ ...current!, state: 'closed', canWrite: false, canClose: false, canReopen: true, history: [...current!.history, { state: 'closed', at: '2030-09-30T11:00:00.000Z' }] });
      return json(route, { question: current });
    }
    if (pathname.endsWith(`/management-questions/${questionId}/reopen`)) {
      const text = (request.postDataJSON() as { text: string }).text;
      const messageId = 'message-2';
      current = question({ ...current!, state: 'waiting-for-answer', canWrite: true, canClose: true, canReopen: false, messages: [...current!.messages, { id: messageId, authorName: 'Анна', authorRole: 'resident', mine: true, text, photos: [], at: '2030-09-30T12:00:00.000Z' }], history: [...current!.history, { state: 'waiting-for-answer', at: '2030-09-30T12:00:00.000Z' }] });
      return json(route, { messageId, question: current }, 201);
    }
    return json(route, { error: 'not_found' }, 404);
  });

  await page.goto('/#/management-questions/new');
  await expect(page.getByText('УК ещё не подключена. Вопрос сохранится и будет доставлен после назначения.')).toBeVisible();
  await page.getByLabel('Тема').fill('Когда включат отопление?');
  await page.getByLabel('Вопрос').fill('В доме уже холодно.');
  await page.getByRole('button', { name: 'Опубликовать вопрос' }).click();
  await expect(page).toHaveURL(new RegExp(`#\/management-questions\/${questionId}`));
  await expect(page.getByRole('heading', { name: 'Когда включат отопление?' })).toBeVisible();
  await expect(page.getByText('В доме уже холодно.')).toBeVisible();

  await page.getByRole('button', { name: 'Закрыть вопрос' }).click();
  await expect(page.locator('#main-content').getByText('Вопрос закрыт', { exact: true })).toBeVisible();
  await page.getByLabel('Почему вопрос снова актуален').fill('Отопления всё ещё нет.');
  await page.getByRole('button', { name: 'Возобновить вопрос' }).click();
  await expect(page.getByText('Отопления всё ещё нет.')).toBeVisible();
  await expect(page.getByText('Ждёт ответа УК', { exact: true }).first()).toBeVisible();
});

test('УК публикует официальный ответ, а обычный читатель видит тему без права писать', async ({ page }) => {
  await maxBridge(page);
  let role: HouseMembershipSummary['role'] = 'management-company';
  let current = question({ canClose: false, messages: [{ ...question().messages[0]!, mine: false }] });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/auth/max') return json(route, { token: 'Q'.repeat(43), expiresAt: '2030-01-01T00:00:00.000Z', pendingHouseSetups: [] });
    if (pathname === '/api/me') return json(route, { resident: { id: 'resident-uk', maxUserId: '77', displayName: 'Ольга', username: null, phone: null, phoneVerified: false }, memberships: [membership(role)] });
    if (pathname.endsWith(`/management-questions/${questionId}`) && request.method() === 'GET') return json(route, { managementAssigned: true, question: current });
    if (pathname.endsWith(`/management-questions/${questionId}/messages`)) {
      const text = (request.postDataJSON() as { text: string }).text;
      const messageId = 'message-uk';
      current = question({ ...current, state: 'answered', messages: [...current.messages, { id: messageId, authorName: 'Ольга', authorRole: 'management-company', mine: true, text, photos: [], at: '2030-09-30T11:00:00.000Z' }], history: [...current.history, { state: 'answered', at: '2030-09-30T11:00:00.000Z' }] });
      return json(route, { messageId, question: current }, 201);
    }
    return json(route, { error: 'not_found' }, 404);
  });

  await page.goto(`/#/management-questions/${questionId}`);
  await page.getByLabel('Ответ УК').fill('Отопление включим 3 октября.');
  await page.getByRole('button', { name: 'Опубликовать ответ' }).click();
  await expect(page.getByText('УК · Ольга')).toBeVisible();
  await expect(page.getByText('Отопление включим 3 октября.')).toBeVisible();

  role = 'resident';
  current = question({ ...current, canWrite: false, canClose: false, messages: current.messages.map((message) => ({ ...message, mine: false })) });
  await page.reload();
  await expect(page.getByText('Писать в этой теме могут только автор вопроса и УК.')).toBeVisible();
  await expect(page.getByLabel('Уточнение')).toHaveCount(0);
});
