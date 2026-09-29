import type { HouseRepairStatus } from '@maxtown/shared';

const transitions: Record<HouseRepairStatus, readonly HouseRepairStatus[]> = {
  planned: ['in_progress', 'cancelled'],
  in_progress: ['paused', 'completed', 'cancelled'],
  paused: ['in_progress', 'completed', 'cancelled'],
  completed: ['in_progress'],
  cancelled: [],
};

export function canTransitionRepair(
  current: HouseRepairStatus,
  next: HouseRepairStatus,
  note?: string,
): boolean {
  if (!transitions[current].includes(next)) return false;
  return current !== 'completed' || next !== 'in_progress' || Boolean(note?.trim());
}
