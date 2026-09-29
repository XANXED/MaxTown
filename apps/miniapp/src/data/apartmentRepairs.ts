import type { ApartmentLayoutPosition, ApartmentRepair, ApartmentRepairInput } from '@maxtown/shared';
import { apiFetch } from '../auth/session.ts';

export class ApartmentRepairRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new ApartmentRepairRequestError(response.status, body.error ?? 'request_failed');
  return body as T;
}

function housePath(houseId: string): string {
  return `/api/houses/${encodeURIComponent(houseId)}`;
}

export async function loadApartmentLayout(houseId: string): Promise<ApartmentLayoutPosition[]> {
  const body = await responseJson<{ apartments: ApartmentLayoutPosition[] }>(
    await apiFetch(`${housePath(houseId)}/apartment-layout`),
  );
  return body.apartments;
}

export async function saveApartmentLayout(
  houseId: string,
  apartmentId: string,
  position: { entrance: number; floor: number; column: number },
): Promise<ApartmentLayoutPosition> {
  const body = await responseJson<{ apartment: ApartmentLayoutPosition }>(
    await apiFetch(`${housePath(houseId)}/apartments/${encodeURIComponent(apartmentId)}/layout`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(position),
    }),
  );
  return body.apartment;
}

export async function loadApartmentRepairs(houseId: string): Promise<ApartmentRepair[]> {
  const body = await responseJson<{ repairs: ApartmentRepair[] }>(
    await apiFetch(`${housePath(houseId)}/apartment-repairs`),
  );
  return body.repairs;
}

export async function loadApartmentRepair(houseId: string, repairId: string): Promise<ApartmentRepair> {
  const body = await responseJson<{ repair: ApartmentRepair }>(
    await apiFetch(`${housePath(houseId)}/apartment-repairs/${encodeURIComponent(repairId)}`),
  );
  return body.repair;
}

export async function createApartmentRepair(houseId: string, input: ApartmentRepairInput): Promise<ApartmentRepair> {
  const body = await responseJson<{ repair: ApartmentRepair }>(
    await apiFetch(`${housePath(houseId)}/apartment-repairs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    }),
  );
  return body.repair;
}

export async function updateApartmentRepair(houseId: string, repairId: string, input: ApartmentRepairInput): Promise<ApartmentRepair> {
  const body = await responseJson<{ repair: ApartmentRepair }>(
    await apiFetch(`${housePath(houseId)}/apartment-repairs/${encodeURIComponent(repairId)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    }),
  );
  return body.repair;
}

export async function cancelApartmentRepair(houseId: string, repairId: string): Promise<ApartmentRepair> {
  const body = await responseJson<{ repair: ApartmentRepair }>(
    await apiFetch(`${housePath(houseId)}/apartment-repairs/${encodeURIComponent(repairId)}/cancel`, { method: 'POST' }),
  );
  return body.repair;
}

export async function completeApartmentRepair(houseId: string, repairId: string): Promise<ApartmentRepair> {
  const body = await responseJson<{ repair: ApartmentRepair }>(
    await apiFetch(`${housePath(houseId)}/apartment-repairs/${encodeURIComponent(repairId)}/complete`, { method: 'POST' }),
  );
  return body.repair;
}
