import { createContext, useContext } from 'react';
import type { HouseMembershipSummary, HouseRole } from '@maxtown/shared';

// Членство в Доме из проверенной серверной сессии (/api/me). App кладёт его
// сюда после входа, экраны читают — так «Жилец или ещё нет» решает сервер,
// а не данные конкретного экрана.

type MembershipState = {
  membership: HouseMembershipSummary | null;
  /** Все активные Дома из проверенной серверной сессии. */
  memberships: HouseMembershipSummary[];
  /** Переключить Дом только на тот, к которому сервер уже подтвердил доступ. */
  selectHouse: (houseId: string) => void;
  /** Перечитать /api/me: после вступления по Приглашению или подключения Дома. */
  refresh: () => Promise<void>;
};

export const MembershipContext = createContext<MembershipState>({
  membership: null,
  memberships: [],
  selectHouse: () => {},
  refresh: async () => {},
});

/** Активное членство или null, если человек ещё не в Доме (или вход не выполнен). */
export function useMembership(): HouseMembershipSummary | null {
  return useContext(MembershipContext).membership;
}

/** Все Дома текущего человека и безопасное локальное переключение между ними. */
export function useHouseMemberships(): Pick<MembershipState, 'memberships' | 'selectHouse'> {
  const { memberships, selectHouse } = useContext(MembershipContext);
  return { memberships, selectHouse };
}

export function useRefreshMembership(): () => Promise<void> {
  return useContext(MembershipContext).refresh;
}

/** Роли по docs/adr/0007: выводятся из участия в Домовом чате MAX. */
export const roleLabels: Record<HouseRole, string> = {
  admin: 'Администратор Дома',
  'management-company': 'УК',
  resident: 'Жилец',
};

/** Может ли Роль вести Контакты, Места и Провайдеров Дома. */
export function canManageHouse(role: HouseRole | null): boolean {
  return role === 'admin';
}

/** Может ли Роль вести Работы в Доме и услуги дома: Администратор и УК. */
export function canManageServices(role: HouseRole | null): boolean {
  return role === 'admin' || role === 'management-company';
}

/** «Квартира 42. Вы Администратор Дома», «Вы УК». */
export function membershipLine(membership: HouseMembershipSummary): string {
  const role = `Вы ${roleLabels[membership.role]}`;
  return membership.apartmentNumber ? `Квартира ${membership.apartmentNumber}. ${role}` : role;
}
