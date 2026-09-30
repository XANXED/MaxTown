import type { MeResponse, ResidentHouseProfileInput } from '@maxtown/shared';
import { apiFetch } from '../auth/session.ts';

export class ResidentProfileRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const errorMessages: Record<string, string> = {
  invalid_apartment_number: 'Проверьте номера квартир',
  neighbor_matches_apartment: 'Своя квартира не может быть соседней',
  phone_contact_required: 'Разрешите MAX передать номер или выключите его показ',
  invalid_phone_contact: 'MAX не подтвердил номер. Попробуйте поделиться им снова',
  phone_verification_unavailable: 'Проверка телефона временно недоступна',
  house_membership_not_found: 'Доступ к этому Дому не найден',
  apartment_access_required: 'Сначала привяжите Квартиру',
  apartment_change_forbidden: 'Самостоятельно сменить Квартиру нельзя. Обратитесь в поддержку',
};

export async function saveResidentHouseProfile(
  houseId: string,
  input: ResidentHouseProfileInput,
): Promise<MeResponse> {
  const response = await apiFetch(`/api/me/houses/${encodeURIComponent(houseId)}/profile`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { error?: unknown } | null;
    const code = typeof data?.error === 'string' ? data.error : '';
    throw new ResidentProfileRequestError(errorMessages[code] ?? 'Не удалось сохранить профиль', response.status);
  }
  return response.json() as Promise<MeResponse>;
}
