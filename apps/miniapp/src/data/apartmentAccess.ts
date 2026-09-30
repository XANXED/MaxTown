import type { ApartmentAccessRequest, ApartmentAccessState, ApartmentLocationInput } from '@maxtown/shared';
import { apiFetch } from '../auth/session.ts';
import { jsonRequest, readApiJson } from './api.ts';

const messages: Record<string, string> = {
  house_membership_not_found: 'Сначала вступите в Домовой чат этого Дома',
  apartment_access_forbidden: 'УК не привязывается к Квартире',
  apartment_location_invalid: 'Проверьте номер Квартиры, этаж и подъезд',
  apartment_location_conflict: 'У этой Квартиры уже сохранено другое расположение',
  apartment_location_incomplete: 'Участникам Квартиры нужно сначала указать её этаж',
  apartment_location_locked_by_repair: 'Расположение нельзя менять, пока идёт Ремонт Квартиры',
  apartment_change_forbidden: 'Самостоятельно сменить Квартиру нельзя. Обратитесь в поддержку',
  apartment_request_pending: 'Сначала отмените текущий запрос на привязку',
  apartment_access_request_not_found: 'Запрос уже отменён или обработан',
  apartment_access_request_decided: 'По этому запросу уже приняли решение',
  apartment_access_decision_forbidden: 'Решение может принять только участник этой Квартиры',
  apartment_household_stale: 'Состав Квартиры уже изменился. Обновите экран',
  apartment_access_required: 'Сначала привяжитесь к Квартире',
  invitation_unavailable: 'Приглашение отозвано или состав Квартиры уже изменился',
};

function url(houseId: string): string {
  return `/api/houses/${encodeURIComponent(houseId)}/apartment-access`;
}

export async function loadApartmentAccess(houseId: string): Promise<ApartmentAccessState> {
  return readApiJson<ApartmentAccessState>(
    await apiFetch(url(houseId)),
    'Не удалось загрузить привязку к Квартире',
    messages,
  );
}

export async function saveApartmentAccess(
  houseId: string,
  input: ApartmentLocationInput,
): Promise<{ status: 'joined'; state: ApartmentAccessState } | { status: 'pending'; request: ApartmentAccessRequest }> {
  return readApiJson(
    await apiFetch(url(houseId), jsonRequest('POST', input)),
    'Не удалось сохранить Квартиру',
    messages,
  );
}

export async function cancelApartmentRequest(houseId: string, requestId: string): Promise<void> {
  await readApiJson(
    await apiFetch(`${url(houseId)}/requests/${encodeURIComponent(requestId)}`, { method: 'DELETE' }),
    'Не удалось отменить запрос',
    messages,
  );
}

export async function decideApartmentRequest(
  houseId: string,
  requestId: string,
  decision: 'approve' | 'reject',
): Promise<void> {
  await readApiJson(
    await apiFetch(`${url(houseId)}/requests/${encodeURIComponent(requestId)}/decision`, jsonRequest('POST', { decision })),
    'Не удалось обработать запрос',
    messages,
  );
}

export async function createApartmentInvite(houseId: string): Promise<string> {
  const response = await readApiJson<{ code: string }>(
    await apiFetch(`${url(houseId)}/invitations`, { method: 'POST' }),
    'Не удалось создать Приглашение',
    messages,
  );
  return response.code;
}
