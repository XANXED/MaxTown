import type { HouseRegistration, HouseRegistrationStatus } from '@maxtown/shared';
import { useEffect, useState } from 'react';
import { parseDemoMode, useLoadable } from './loadable.ts';

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
  const demo = import.meta.env.DEV && parseDemoMode(window.location.search) !== null;
  const fixtures = useLoadable<HouseRegistration[]>([], ({ sampleRegistrations }) => sampleRegistrations());
  const [attempt, setAttempt] = useState(0);
  const [remote, setRemote] = useState<{ status: 'loading' | 'ready' | 'error'; data: HouseRegistration[] }>({ status: 'loading', data: [] });

  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    setRemote((current) => ({ ...current, status: 'loading' }));
    void fetch('/api/moderator/registrations', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Не удалось загрузить регистрации');
        const result = await response.json() as { registrations: HouseRegistration[] };
        if (!controller.signal.aborted) setRemote({ status: 'ready', data: result.registrations });
      })
      .catch(() => { if (!controller.signal.aborted) setRemote({ status: 'error', data: [] }); });
    return () => controller.abort();
  }, [attempt, demo]);

  return demo ? fixtures : {
    status: remote.status,
    data: remote.data,
    retry: () => setAttempt((value) => value + 1),
  };
}

export async function decideRegistration(id: string, decision: 'approve' | 'reject', reason?: string): Promise<HouseRegistration> {
  if (import.meta.env.DEV && parseDemoMode(window.location.search) !== null) {
    const fixture = await import('./fixtures.ts');
    const sample = fixture.sampleRegistrations().find((item) => item.id === id);
    if (!sample) throw new Error('Регистрация не найдена');
    return decision === 'approve' ? approve(sample, new Date()) : reject(sample, new Date(), reason ?? '');
  }
  const response = await fetch(`/api/moderator/registrations/${encodeURIComponent(id)}/decision`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, ...(reason ? { reason } : {}) }),
  });
  if (!response.ok) throw new Error('Не удалось сохранить решение Модератора');
  return (await response.json() as { registration: HouseRegistration }).registration;
}
