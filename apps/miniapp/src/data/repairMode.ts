import type { HouseRepairMode } from '@maxtown/shared';
import { apiFetch } from '../auth/session.ts';

export type RepairModeInput = {
  isActive: boolean;
  title?: string;
  description?: string;
  startsAt?: string;
  expectedCompletionAt?: string;
  instructions?: string;
};

export function toDateTimeLocal(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function fromDateTimeLocal(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

async function requireOk(response: Response): Promise<void> {
  if (!response.ok) throw new Error('Не удалось сохранить Работы в Доме');
}

export async function loadRepairMode(houseId: string): Promise<HouseRepairMode> {
  const response = await apiFetch(`/api/houses/${encodeURIComponent(houseId)}/repair-mode`);
  await requireOk(response);
  return (await response.json() as { repairMode: HouseRepairMode }).repairMode;
}

export async function saveRepairMode(houseId: string, input: RepairModeInput): Promise<HouseRepairMode> {
  const response = await apiFetch(`/api/houses/${encodeURIComponent(houseId)}/repair-mode`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  await requireOk(response);
  return (await response.json() as { repairMode: HouseRepairMode }).repairMode;
}
