import { useMemo } from 'react';
import type { HouseSearchResult, InviteCheck } from '@maxtown/shared';
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
  if (!fixtures) return { status: 'unavailable' };
  return (await fixtures).sampleInviteCheck(code);
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
  const houses = useMemo(() => matchHouses(data, query), [data, query]);
  return { status, houses };
}
