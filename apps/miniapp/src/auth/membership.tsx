import { createContext, useContext } from 'react';
import type { HouseMembershipSummary, HouseRole } from '@maxtown/shared';

// Членство в Доме из проверенной серверной сессии (/api/me). App кладёт его
// сюда после входа, экраны читают — так «Жилец или ещё нет» решает сервер,
// а не данные конкретного экрана.

type MembershipState = {
  membership: HouseMembershipSummary | null;
  /** Перечитать /api/me: после вступления или одобрения Дома. */
  refresh: () => Promise<void>;
};

export const MembershipContext = createContext<MembershipState>({ membership: null, refresh: async () => {} });

/** Активное членство или null, если человек ещё не в Доме (или вход не выполнен). */
export function useMembership(): HouseMembershipSummary | null {
  return useContext(MembershipContext).membership;
}

export function useRefreshMembership(): () => Promise<void> {
  return useContext(MembershipContext).refresh;
}

export const roleLabels: Record<HouseRole, string> = {
  headman: 'Староста',
  responsible: 'Ответственный',
  concierge: 'Консьерж',
  resident: 'Жилец',
};

/** «Квартира 42. Вы Староста», «Вы Консьерж». */
export function membershipLine(membership: HouseMembershipSummary): string {
  const role = `Вы ${roleLabels[membership.role]}`;
  return membership.apartmentNumber ? `Квартира ${membership.apartmentNumber}. ${role}` : role;
}
