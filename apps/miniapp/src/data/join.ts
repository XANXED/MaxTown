import { useEffect, useMemo, useState } from 'react';
import type { HouseRegistration, HouseSearchResult, InviteCheck } from '@maxtown/shared';
import { apiFetch } from '../auth/session.ts';
import { demoMode, loadFixtures, useLoadable, type LoadStatus } from './loadable.ts';

// Как стать Жильцом (CONTEXT.md): по Приглашению — QR-код или ссылка на
// конкретную Квартиру — или Запросом на вступление, который решает Жилец
// Квартиры, а если в ней никого нет, Староста.
//
// Приглашение — ссылка MAX на мини-апп: https://max.ru/<бот>?startapp=inv_<код>,
// код — 22 символа base64url (docs/research/2026-09-house-data-and-max-platform.md, 2.5).
// В payload MAX пропускает только латиницу, цифры, «_» и «-», до 512 символов.

const INVITE_PREFIX = 'inv_';
const codePattern = /^[A-Za-z0-9_-]{4,64}$/;

/** Код Приглашения из ссылки, из payload `inv_…` или сам код. Иначе null. */
export function parseInviteCode(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (/[/?]/.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(/^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`);
    } catch {
      return null;
    }
    if (url.hostname !== 'max.ru') return null;
    return inviteFromStartParam(url.searchParams.get('startapp') ?? undefined);
  }

  const code = trimmed.startsWith(INVITE_PREFIX) ? trimmed.slice(INVITE_PREFIX.length) : trimmed;
  return codePattern.test(code) ? code : null;
}

/** Приглашение из параметра запуска MAX (`initDataUnsafe.start_param`). */
export function inviteFromStartParam(startParam: string | undefined): string | null {
  if (!startParam?.startsWith(INVITE_PREFIX)) return null;
  const code = startParam.slice(INVITE_PREFIX.length);
  return codePattern.test(code) ? code : null;
}

/** Приглашение, с которым открыли мини-апп, если оно было в ссылке. */
export function launchInviteCode(): string | null {
  const startParam = window.WebApp?.initDataUnsafe?.start_param;
  return inviteFromStartParam(typeof startParam === 'string' ? startParam : undefined);
}

/** Ошибка в номере Квартиры или null. Бывают номера с буквой: 34А. */
export function validateApartment(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Укажите номер Квартиры';
  if (!/^[1-9]\d{0,3}[а-яА-Яa-zA-Z]?$/.test(trimmed)) return 'Только номер, например 34 или 34А';
  return null;
}

/** Результат проверки на экране: к ответам сервера добавляется «вступить пока нельзя». */
export type InviteResult = InviteCheck | { status: 'unavailable' };

/**
 * Проверить Приглашение. API ещё нет: в сборке честно отвечаем, что вступить
 * пока нельзя. В dev-демо ответ даёт fixtures.ts.
 */
export async function checkInvite(code: string): Promise<InviteResult> {
  const fixtures = demoMode() ? loadFixtures() : null;
  if (fixtures) return (await fixtures).sampleInviteCheck(code);
  try {
    const response = await apiFetch(`/api/invitations/${encodeURIComponent(code)}`);
    if (!response.ok) return { status: 'unavailable' };
    return (await response.json() as { invitation: InviteResult }).invitation;
  } catch {
    return { status: 'unavailable' };
  }
}

export async function redeemInvite(code: string): Promise<void> {
  if (demoMode()) return;
  const response = await apiFetch(`/api/invitations/${encodeURIComponent(code)}/redeem`, { method: 'POST' });
  if (!response.ok) throw new Error('Не удалось вступить по Приглашению');
}

export async function requestHouseMembership(houseId: string, apartmentNumber: string): Promise<string> {
  if (demoMode()) return `demo-${houseId}-${apartmentNumber}`;
  const response = await apiFetch('/api/join-requests', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ houseId, apartmentNumber }),
  });
  if (!response.ok) throw new Error('Не удалось отправить Запрос на вступление');
  return (await response.json() as { id: string }).id;
}

export async function cancelHouseMembershipRequest(requestId: string): Promise<void> {
  if (demoMode()) return;
  const response = await apiFetch(`/api/join-requests/${encodeURIComponent(requestId)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Не удалось отозвать Запрос на вступление');
}

export async function getMyHouseRegistration(): Promise<HouseRegistration | null> {
  if (demoMode()) return null;
  const response = await apiFetch('/api/houses/registrations/mine');
  if (!response.ok) throw new Error('Не удалось загрузить регистрацию Дома');
  return (await response.json() as { registration: HouseRegistration | null }).registration;
}

export async function registerHouse(input: { address: string; locality: string; apartmentNumber: string }): Promise<void> {
  if (demoMode()) return;
  const response = await apiFetch('/api/houses/registrations', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error('Не удалось отправить регистрацию Дома');
}

function normalize(text: string): string {
  return text.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Дома, где встречается каждое слово запроса: «лесная 12» находит «ул. Лесная, 12». */
export function matchHouses(houses: HouseSearchResult[], query: string): HouseSearchResult[] {
  const words = normalize(query).split(' ').filter(Boolean);
  if (words.length === 0) return [];
  return houses.filter((house) => {
    const haystack = normalize(`${house.address} ${house.locality}`);
    return words.every((word) => haystack.includes(word));
  });
}

/**
 * Поиск Дома для Запроса на вступление. Без API Домов в поиске нет;
 * в dev-демо — несколько примеров.
 */
export function useHouseSearch(query: string): { status: LoadStatus; houses: HouseSearchResult[] } {
  const { status, data } = useLoadable<HouseSearchResult[]>([], ({ sampleHouses }) => sampleHouses);
  const demo = demoMode();
  const [remote, setRemote] = useState<{ status: LoadStatus; houses: HouseSearchResult[] }>({ status: 'ready', houses: [] });
  useEffect(() => {
    if (demo) return;
    const text = query.trim();
    if (text.length < 2) {
      setRemote({ status: 'ready', houses: [] });
      return;
    }
    const controller = new AbortController();
    setRemote((current) => ({ ...current, status: 'loading' }));
    void apiFetch(`/api/houses/search?query=${encodeURIComponent(text)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('house search failed');
        const result = await response.json() as { houses: HouseSearchResult[] };
        if (!controller.signal.aborted) setRemote({ status: 'ready', houses: result.houses });
      })
      .catch(() => { if (!controller.signal.aborted) setRemote({ status: 'error', houses: [] }); });
    return () => controller.abort();
  }, [demo, query]);
  const houses = useMemo(() => matchHouses(demo ? data : remote.houses, query), [data, demo, query, remote.houses]);
  return demo ? { status, houses } : { status: remote.status, houses };
}
