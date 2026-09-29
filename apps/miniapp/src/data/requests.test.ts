import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './api.ts';
import { createRequestsClient, isProcessor } from './requests.ts';
import { scaledSize } from './requestPhotos.ts';

const houseId = 'h1';

function fakeFetch(status: number, body: unknown) {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));
}

describe('клиент Заявок', () => {
  it('отправляет действие JSON-ом и возвращает карточку из ответа', async () => {
    const fetcher = fakeFetch(200, { request: { id: 'r1', status: 'in-progress' } });
    const request = await createRequestsClient(fetcher).act(houseId, 'r1', 'reject', { note: 'Не наша зона' });
    expect(request).toMatchObject({ id: 'r1' });
    expect(fetcher).toHaveBeenCalledWith('/api/houses/h1/requests/r1/actions', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ action: 'reject', note: 'Не наша зона' }),
    }));
  });

  it('превращает код ошибки сервера в понятный текст', async () => {
    const client = createRequestsClient(fakeFetch(400, { error: 'apartment_required' }));
    const error = await client.create(houseId, { category: 'Сантехника', place: 'apartment', description: 'Течёт кран на кухне' }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'apartment_required', status: 400 });
    expect((error as ApiError).message).toContain('номер Квартиры');
  });

  it('не найденная Заявка — null, а не ошибка', async () => {
    await expect(createRequestsClient(fakeFetch(404, { error: 'request_not_found' })).get(houseId, 'r404')).resolves.toBeNull();
  });

  it('«У меня тоже» ставит POST, а снимает DELETE', async () => {
    const fetcher = fakeFetch(200, { request: { id: 'r1' } });
    const client = createRequestsClient(fetcher);
    await client.support(houseId, 'r1', true);
    await client.support(houseId, 'r1', false);
    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'DELETE']);
  });

  it('фото уходит телом запроса со своим типом', async () => {
    const fetcher = fakeFetch(201, { photo: { id: 'p1' } });
    const photo = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });
    await createRequestsClient(fetcher).uploadPhoto(houseId, 'r1', photo);
    const [, init] = fetcher.mock.calls[0]!;
    expect(init).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: photo });
  });
});

describe('кто обрабатывает Заявки', () => {
  it('УК и Администратор Дома, но не Жилец', () => {
    expect(isProcessor('admin')).toBe(true);
    expect(isProcessor('management-company')).toBe(true);
    expect(isProcessor('resident')).toBe(false);
    expect(isProcessor(undefined)).toBe(false);
  });
});

describe('размер фото после сжатия', () => {
  it('уменьшает длинную сторону до 1600 и не растягивает маленькие', () => {
    expect(scaledSize(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(scaledSize(3000, 4000)).toEqual({ width: 1200, height: 1600 });
    expect(scaledSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
});
