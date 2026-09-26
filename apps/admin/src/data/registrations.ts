import type { HouseRegistration, HouseRegistrationStatus } from '@maxtown/shared';
import { useLoadable } from './loadable.ts';

// Проверка регистрации Дома Модератором. Решение одно на регистрацию:
// одобрить или отклонить с причиной, которую увидит Староста.

export type CheckState = 'ok' | 'warning' | 'problem';

export type RegistrationCheck = { label: string; hint: string; state: CheckState };

/** Повтор Дома: одобренный с тем же GUID мешает, ждущий — повод выбрать одного. */
function duplicateCheck(item: HouseRegistration, all: HouseRegistration[]): RegistrationCheck {
  if (!item.garHouseGuid) {
    return {
      label: 'Повтор не проверить',
      hint: 'Без GUID из ГАР не сравнить с другими Домами. Поищите адрес среди одобренных',
      state: 'warning',
    };
  }

  const sameHouse = all.filter((other) => other.id !== item.id && other.garHouseGuid === item.garHouseGuid);
  const working = sameHouse.find(({ status }) => status === 'approved');
  if (working) {
    return { label: 'Этот Дом уже работает в MaxTown', hint: `Его зарегистрировал ${working.headman.name}`, state: 'problem' };
  }

  const waiting = sameHouse.find(({ status }) => status === 'pending');
  if (waiting) {
    return {
      label: 'Этот Дом регистрирует ещё один человек',
      hint: `${waiting.headman.name}, Квартира ${waiting.headman.apartment}. Одобрите только одну регистрацию`,
      state: 'warning',
    };
  }

  return { label: 'Дом ещё не зарегистрирован', hint: 'Других регистраций этого адреса нет', state: 'ok' };
}

/** Что Модератору стоит проверить глазами: адрес в ГАР, повтор Дома, телефон Старосты. */
export function registrationChecks(item: HouseRegistration, all: HouseRegistration[]): RegistrationCheck[] {
  return [
    item.garHouseGuid
      ? { label: 'Адрес найден в ГАР', hint: 'Дом есть в государственном адресном реестре', state: 'ok' }
      : {
          label: 'Адреса нет в ГАР',
          hint: 'Так бывает с новостройками. Сверьте адрес вручную, прежде чем одобрять',
          state: 'warning',
        },
    duplicateCheck(item, all),
    item.headman.phone
      ? { label: 'Телефон подтверждён в MAX', hint: item.headman.phone, state: 'ok' }
      : { label: 'Телефон не подтверждён', hint: 'Связаться со Старостой можно только через MAX', state: 'warning' },
  ];
}

export function approve(item: HouseRegistration, now: Date): HouseRegistration {
  if (item.status !== 'pending') return item;
  return { ...item, status: 'approved', decidedAt: now.toISOString() };
}

export function reject(item: HouseRegistration, now: Date, reason: string): HouseRegistration {
  if (item.status !== 'pending' || rejectionError(reason)) return item;
  return { ...item, status: 'rejected', decidedAt: now.toISOString(), rejectionReason: reason.trim() };
}

const MINIMUM_REASON = 10;

/** Причину прочитает Староста: пустая или короткая не объяснит, что исправить. */
export function rejectionError(reason: string): string | null {
  const trimmed = reason.trim();
  if (!trimmed) return 'Напишите причину: её увидит Староста';
  if (trimmed.length < MINIMUM_REASON) return 'Слишком коротко: объясните, что исправить';
  return null;
}

export function countByStatus(items: HouseRegistration[]): Record<HouseRegistrationStatus, number> {
  const counts: Record<HouseRegistrationStatus, number> = { pending: 0, approved: 0, rejected: 0 };
  for (const { status } of items) counts[status] += 1;
  return counts;
}

/** Ждущие — сначала те, что ждут дольше; решённые — свежие решения сверху. */
export function visibleRegistrations(items: HouseRegistration[], status: HouseRegistrationStatus): HouseRegistration[] {
  const time = (iso: string | undefined) => (iso ? new Date(iso).getTime() : 0);
  return items
    .filter((item) => item.status === status)
    .sort((a, b) =>
      status === 'pending' ? time(a.submittedAt) - time(b.submittedAt) : time(b.decidedAt) - time(a.decidedAt),
    );
}

/** Регистрации Домов. Без API — пусто; примеры для dev — см. loadable.ts. */
export function useRegistrations() {
  return useLoadable<HouseRegistration[]>([], ({ sampleRegistrations }) => sampleRegistrations());
}
