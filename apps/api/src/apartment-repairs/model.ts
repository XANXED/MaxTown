import {
  APARTMENT_REPAIR_WORK_TYPES,
  type ApartmentRepairState,
  type ApartmentRepairWorkType,
} from '@maxtown/shared';

export type RepairLifecycleFields = {
  startsAt: string | Date;
  endsAt: string | Date;
  completedAt: string | Date | null;
  cancelledAt: string | Date | null;
};

export function apartmentRepairState(repair: RepairLifecycleFields, now = new Date()): ApartmentRepairState {
  if (repair.cancelledAt) return 'cancelled';
  if (repair.completedAt || new Date(repair.endsAt).getTime() <= now.getTime()) return 'completed';
  if (new Date(repair.startsAt).getTime() > now.getTime()) return 'scheduled';
  return 'active';
}

export function normalizeWorkTypes(values: readonly string[]): ApartmentRepairWorkType[] | null {
  const allowed = new Set<string>(APARTMENT_REPAIR_WORK_TYPES);
  const unique = [...new Set(values)];
  if (unique.length === 0 || unique.some((value) => !allowed.has(value))) return null;
  return unique as ApartmentRepairWorkType[];
}
