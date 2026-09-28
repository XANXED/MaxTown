import { createContext, useContext } from 'react';
import type { HouseAccess, HouseRole } from '@maxtown/shared';

/** Только доступ, уже подтверждённый сервером при авторизации/создании Дома. */
export const HouseSession = createContext<HouseAccess | null>(null);
export function useCurrentHouse(): HouseAccess | null {
  return useContext(HouseSession);
}

const roleLabels: Record<HouseRole, string> = {
  admin: 'Администратор Дома',
  resident: 'Жилец',
  'management-company': 'УК',
};
export function houseRoleLabel(house: HouseAccess): string {
  return house.roles.map((role) => roleLabels[role]).join(' · ');
}
