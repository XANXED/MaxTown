import type { ApartmentInfoAccessGrant } from '@maxtown/shared';
import { apiFetch } from '../auth/session.ts';
import { jsonRequest, readApiJson } from './api.ts';

const message = 'Не удалось изменить ограниченный доступ к Квартире';

export async function createApartmentInfoInvite(houseId: string, apartmentId: string): Promise<{ code: string; expiresAt: string }> {
  return readApiJson(
    await apiFetch(`/api/houses/${encodeURIComponent(houseId)}/apartment-info-access/invitations`, jsonRequest('POST', { apartmentId })),
    message,
  );
}

export async function loadApartmentInfoGrants(houseId: string): Promise<ApartmentInfoAccessGrant[]> {
  const result = await readApiJson<{ grants: ApartmentInfoAccessGrant[] }>(
    await apiFetch(`/api/houses/${encodeURIComponent(houseId)}/apartment-info-access`), message,
  );
  return result.grants;
}

export async function revokeApartmentInfoInvite(houseId: string, code: string): Promise<void> {
  await readApiJson(
    await apiFetch(`/api/houses/${encodeURIComponent(houseId)}/apartment-info-access/invitations/${encodeURIComponent(code)}`, { method: 'DELETE' }),
    message,
  );
}

export async function revokeApartmentInfoGrant(houseId: string, grantId: string): Promise<void> {
  await readApiJson(
    await apiFetch(`/api/houses/${encodeURIComponent(houseId)}/apartment-info-access/${encodeURIComponent(grantId)}`, { method: 'DELETE' }),
    message,
  );
}
