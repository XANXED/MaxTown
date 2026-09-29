import type { HouseRepair, HouseRepairHistoryEntry, HouseRepairStatus, RepairMode } from '@maxtown/shared';
import type { HouseRole } from '@maxtown/shared';
import { apiFetch } from '../auth/session.ts';

export type RepairModeInput = {
  isActive: boolean;
  title?: string;
  description?: string;
  startsAt?: string;
  expectedCompletionAt?: string;
  instructions?: string;
};

export type HouseRepairInput = {
  title: string;
  description: string;
  location?: string | null;
  status: Extract<HouseRepairStatus, 'planned' | 'in_progress'>;
  startsAt?: string | null;
  expectedCompletionAt?: string | null;
  contractorName?: string | null;
  contractorContact?: string | null;
  residentImpact?: string | null;
  instructions?: string | null;
};

export type HouseRepairUpdate = Partial<Omit<HouseRepairInput, 'status'>> & {
  status?: HouseRepairStatus;
  note?: string;
};

export function splitHouseRepairs(repairs: HouseRepair[]): { current: HouseRepair[]; archive: HouseRepair[] } {
  return {
    current: repairs.filter(({ status }) => status === 'planned' || status === 'in_progress' || status === 'paused'),
    archive: repairs.filter(({ status }) => status === 'completed' || status === 'cancelled'),
  };
}

export function houseRepairStatusLabel(status: HouseRepairStatus): string {
  const labels: Record<HouseRepairStatus, string> = {
    planned: 'Запланирована', in_progress: 'В работе', paused: 'Приостановлена',
    completed: 'Завершена', cancelled: 'Отменена',
  };
  return labels[status];
}

export function canManageHouseRepairs(role: HouseRole | null): boolean {
  return role === 'headman' || role === 'responsible';
}

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

async function requireOk(response: Response, message = 'Не удалось сохранить режим ремонта'): Promise<void> {
  if (!response.ok) throw new Error(message);
}

export async function loadHouseRepairs(houseId: string): Promise<HouseRepair[]> {
  const response = await apiFetch(`/api/houses/${encodeURIComponent(houseId)}/repairs`);
  await requireOk(response, 'Не удалось загрузить ремонтные работы');
  return (await response.json() as { repairs: HouseRepair[] }).repairs;
}

export async function createHouseRepair(houseId: string, input: HouseRepairInput): Promise<HouseRepair> {
  const response = await apiFetch(`/api/houses/${encodeURIComponent(houseId)}/repairs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  await requireOk(response, 'Не удалось сохранить ремонтную работу');
  return (await response.json() as { repair: HouseRepair }).repair;
}

export async function updateHouseRepair(houseId: string, repairId: string, input: HouseRepairUpdate): Promise<HouseRepair> {
  const response = await apiFetch(`/api/houses/${encodeURIComponent(houseId)}/repairs/${encodeURIComponent(repairId)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  await requireOk(response, 'Не удалось сохранить ремонтную работу');
  return (await response.json() as { repair: HouseRepair }).repair;
}

export async function loadHouseRepairHistory(houseId: string, repairId: string): Promise<HouseRepairHistoryEntry[]> {
  const response = await apiFetch(`/api/houses/${encodeURIComponent(houseId)}/repairs/${encodeURIComponent(repairId)}/history`);
  await requireOk(response, 'Не удалось загрузить историю ремонтной работы');
  return (await response.json() as { history: HouseRepairHistoryEntry[] }).history;
}

export async function loadRepairMode(houseId: string): Promise<RepairMode> {
  const response = await apiFetch(`/api/houses/${encodeURIComponent(houseId)}/repair-mode`);
  await requireOk(response);
  return (await response.json() as { repairMode: RepairMode }).repairMode;
}

export async function saveRepairMode(houseId: string, input: RepairModeInput): Promise<RepairMode> {
  const response = await apiFetch(`/api/houses/${encodeURIComponent(houseId)}/repair-mode`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  await requireOk(response);
  return (await response.json() as { repairMode: RepairMode }).repairMode;
}
