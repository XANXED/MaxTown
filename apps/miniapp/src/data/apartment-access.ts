import type { ApartmentAccessGrant } from '@maxtown/shared';
import { apiFetch } from '../auth/session.ts';

export async function listApartmentAccess(houseId: string): Promise<ApartmentAccessGrant[]> {
  const response = await apiFetch(`/api/houses/${encodeURIComponent(houseId)}/apartment-access`);
  if (!response.ok) throw new Error('Не удалось загрузить список доступа');
  return (await response.json() as { grants: ApartmentAccessGrant[] }).grants;
}

export async function createApartmentInvite(houseId: string, apartmentId: string): Promise<{ code: string; expiresAt: string }> {
  const response = await apiFetch(`/api/houses/${encodeURIComponent(houseId)}/invitations`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apartmentId }),
  });
  if (!response.ok) throw new Error('Не удалось создать приглашение');
  return response.json() as Promise<{ code: string; expiresAt: string }>;
}

export async function revokeApartmentAccess(houseId: string, grantId: string): Promise<void> {
  const response = await apiFetch(`/api/houses/${encodeURIComponent(houseId)}/apartment-access/${encodeURIComponent(grantId)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Не удалось отозвать доступ');
}

export async function revokeApartmentInvite(houseId: string, code: string): Promise<void> {
  const response = await apiFetch(`/api/houses/${encodeURIComponent(houseId)}/invitations/${encodeURIComponent(code)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Не удалось отозвать приглашение');
}
