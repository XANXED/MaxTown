import type { HouseService } from '@maxtown/shared';
import { apiFetch } from '../auth/session.ts';

export type HouseServiceInput = Omit<HouseService, 'id' | 'updatedAt' | 'tariffs'> & {
  tariffs: Array<Omit<HouseService['tariffs'][number], 'id'>>;
};

export type TariffFreshness = 'current' | 'expired' | 'stale';

export function tariffFreshness(
  tariff: Pick<HouseService['tariffs'][number], 'checkedOn' | 'endsOn'>,
  today = new Date().toISOString().slice(0, 10),
): TariffFreshness {
  if (tariff.endsOn && tariff.endsOn < today) return 'expired';
  const checked = Date.parse(`${tariff.checkedOn}T00:00:00Z`);
  const current = Date.parse(`${today}T00:00:00Z`);
  return current - checked > 90 * 24 * 60 * 60 * 1000 ? 'stale' : 'current';
}

async function expectOk(response: Response): Promise<void> {
  if (!response.ok) throw new Error('Не удалось загрузить сведения об услугах Дома');
}

export async function loadHouseServices(houseId: string): Promise<HouseService[]> {
  const response = await apiFetch(`/api/houses/${encodeURIComponent(houseId)}/services`);
  await expectOk(response);
  return (await response.json() as { services: HouseService[] }).services;
}

export async function saveHouseService(houseId: string, input: HouseServiceInput, serviceId?: string): Promise<HouseService> {
  const response = await apiFetch(`/api/houses/${encodeURIComponent(houseId)}/services${serviceId ? `/${encodeURIComponent(serviceId)}` : ''}`, {
    method: serviceId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  await expectOk(response);
  return (await response.json() as { service: HouseService }).service;
}
