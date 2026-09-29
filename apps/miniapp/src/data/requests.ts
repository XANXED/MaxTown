import type { RequestAction, RequestDetails, RequestInput, RequestSummary } from '@maxtown/shared';
import { apiFetch } from '../auth/session.ts';
import { ApiError, jsonRequest, readApiJson, type Fetcher } from './api.ts';
import { useMembership } from '../auth/membership.tsx';
import { useApiLoadable, type ApiLoadable } from './loadable.ts';

// Заявки Дома из apps/api (docs/adr/0012). Список, карточка и действия;
// демо-режим `?demo=filled` берёт примеры из fixtures.ts.

const errorMessages: Record<string, string> = {
  apartment_required: 'Укажите номер Квартиры: без него Ответственный не узнает, куда прийти',
  category_not_for_place: 'Эта Категория не подходит к месту неисправности',
  subcategory_required: 'Выберите, что именно сломалось',
  subcategory_invalid: 'Выберите, что именно сломалось, из списка',
  description_invalid: 'Опишите неисправность подробнее: нужно хотя бы 10 символов',
  visit_date_invalid: 'Выберите день Визита не раньше сегодняшнего',
  request_not_found: 'Заявка не найдена',
  request_action_not_allowed: 'Заявка уже изменилась. Обновите карточку',
  reason_required: 'Укажите причину отказа',
  visit_time_required: 'Выберите время Визита',
  comment_not_allowed: 'Комментарии к этой Заявке закрыты',
  support_not_allowed: 'Отметить «У меня тоже» уже нельзя: Заявку закрыли',
  photo_limit_reached: 'К Заявке уже приложено 4 фото',
  photo_not_allowed: 'Фото можно приложить, пока Заявку не взяли в работу',
  unsupported_photo: 'Это фото не подошло: нужен JPEG, PNG или WebP',
  photo_too_large: 'Фото слишком большое',
  payload_too_large: 'Фото слишком большое',
  forbidden: 'Вы больше не участник этого Дома',
};

const readJson = <T,>(response: Response, fallback: string) => readApiJson<T>(response, fallback, errorMessages);

export function createRequestsClient(fetcher: Fetcher = apiFetch) {
  const base = (houseId: string) => `/api/houses/${encodeURIComponent(houseId)}/requests`;
  const one = (houseId: string, requestId: string) => `${base(houseId)}/${encodeURIComponent(requestId)}`;
  const details = async (response: Response, fallback: string) =>
    (await readJson<{ request: RequestDetails }>(response, fallback)).request;

  return {
    list: async (houseId: string): Promise<RequestSummary[]> =>
      (await readJson<{ requests: RequestSummary[] }>(await fetcher(base(houseId)), 'Не удалось загрузить Заявки')).requests,
    get: async (houseId: string, requestId: string): Promise<RequestDetails | null> => {
      const response = await fetcher(one(houseId, requestId));
      if (response.status === 404) return null;
      return details(response, 'Не удалось загрузить Заявку');
    },
    create: async (houseId: string, input: RequestInput): Promise<RequestDetails> =>
      details(await fetcher(base(houseId), jsonRequest('POST', input)), 'Не удалось отправить Заявку'),
    act: async (houseId: string, requestId: string, action: RequestAction, extra: { note?: string; scheduledAt?: string } = {}): Promise<RequestDetails> =>
      details(await fetcher(`${one(houseId, requestId)}/actions`, jsonRequest('POST', { action, ...extra })), 'Не удалось изменить Заявку'),
    comment: async (houseId: string, requestId: string, text: string): Promise<RequestDetails> =>
      details(await fetcher(`${one(houseId, requestId)}/comments`, jsonRequest('POST', { text })), 'Не удалось отправить Комментарий'),
    support: async (houseId: string, requestId: string, supported: boolean): Promise<RequestDetails> =>
      details(await fetcher(`${one(houseId, requestId)}/support`, jsonRequest(supported ? 'POST' : 'DELETE')), 'Не удалось сохранить отметку'),
    uploadPhoto: async (houseId: string, requestId: string, photo: Blob): Promise<void> => {
      const response = await fetcher(`${one(houseId, requestId)}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': photo.type || 'image/jpeg' },
        body: photo,
      });
      await readJson<unknown>(response, 'Не удалось загрузить фото');
    },
    /** Фото Заявки — только с сессией: адрес API в <img> не подставить. */
    photo: async (url: string): Promise<Blob> => {
      const response = await fetcher(url);
      if (!response.ok) throw new ApiError('Не удалось загрузить фото', null, response.status);
      return response.blob();
    },
  };
}

export const requestsClient = createRequestsClient();

/** Может ли Роль обрабатывать Заявки: УК и Администратор Дома. */
export function isProcessor(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'management-company';
}

/** Заявки человека: свои и отмеченные «У меня тоже»; у УК и Администратора — все Заявки Дома. */
export function useRequests(): ApiLoadable<RequestSummary[]> {
  const houseId = useMembership()?.houseId ?? null;
  return useApiLoadable(
    houseId ? () => requestsClient.list(houseId) : null,
    [],
    ({ sampleRequests }) => sampleRequests(),
    houseId ?? '',
  );
}

/** Карточка Заявки. Не найдена или человек не в Доме — null. */
export function useRequestDetails(id: string): ApiLoadable<RequestDetails | null> {
  const houseId = useMembership()?.houseId ?? null;
  return useApiLoadable<RequestDetails | null>(
    houseId ? () => requestsClient.get(houseId, id) : null,
    null,
    ({ sampleRequestDetails }) => sampleRequestDetails(id),
    `${houseId ?? ''}:${id}`,
  );
}
