import type { GeoPoint, HouseAddressSuggestion } from '@maxtown/shared';
import { withTimeout } from '@maxtown/shared/http';

// Адрес Дома из подсказок DaData (ГАР). Ключ только серверный; тексту адреса
// из браузера не верим — выбранный GUID перечитываем через findById.

const DADATA_API_ORIGIN = 'https://suggestions.dadata.ru';

type DaDataSuggestion = {
  value?: unknown;
  unrestricted_value?: unknown;
  data?: unknown;
};

export class AddressProviderError extends Error {}

const ADDRESS_NOISE_WORDS = new Set([
  'дом',
  'дома',
  'домовой',
  'чат',
  'жители',
  'жильцы',
  'соседи',
  'улица',
  'ул',
  'домик',
  'д',
  'город',
  'г',
  'область',
  'обл',
  'район',
  'рн',
  'республика',
  'респ',
  'край',
  'проспект',
  'пркт',
  'просп',
  'переулок',
  'пер',
  'шоссе',
  'ш',
  'квартал',
  'квл',
  'корпус',
  'корп',
  'строение',
  'стр',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Дом из DaData с точкой на карте, если DaData её знает. */
export type DaDataHouse = HouseAddressSuggestion & { point: GeoPoint | null };

function coordinate(value: unknown, limit: number): number | null {
  const number = typeof value === 'string' && value.trim() ? Number(value) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}

function parseSuggestion(value: unknown): DaDataHouse | null {
  if (!isRecord(value)) return null;
  const suggestion = value as DaDataSuggestion;
  if (!isRecord(suggestion.data)) return null;

  const data = suggestion.data;
  const label =
    typeof suggestion.value === 'string' && suggestion.value.trim()
      ? suggestion.value.trim()
      : typeof suggestion.unrestricted_value === 'string' && suggestion.unrestricted_value.trim()
        ? suggestion.unrestricted_value.trim()
        : null;
  const garHouseGuid =
    typeof data.house_fias_id === 'string' && data.house_fias_id.trim()
      ? data.house_fias_id.trim()
      : null;

  // Уровень 8 — конкретный дом, уровень 9 — квартира/комната в доме.
  // Для поиска Дома подходят оба варианта: при вводе номера квартиры DaData
  // возвращает уровень 9, но house_fias_id по-прежнему содержит GUID Дома.
  // Улицу или населённый пункт нельзя принять за Дом даже при единственной
  // подсказке.
  const fiasLevel = String(data.fias_level);
  if (!label || !garHouseGuid || (fiasLevel !== '8' && fiasLevel !== '9')) return null;

  const localityParts = [
    ...new Set(
      [data.region_with_type, data.area_with_type, data.city_with_type, data.settlement_with_type]
        .filter((part): part is string => typeof part === 'string' && Boolean(part.trim()))
        .map((part) => part.trim()),
    ),
  ];

  const lat = coordinate(data.geo_lat, 90);
  const lon = coordinate(data.geo_lon, 180);
  return {
    value: label,
    locality: localityParts.join(', ') || label,
    garHouseGuid,
    point: lat !== null && lon !== null ? { lat, lon } : null,
  };
}

function addressTokens(value: string): string[] {
  // «14к1», «14 к.1», «14 корп1» пишут слитно, а DaData — «д 14 к 1».
  const spaced = value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е')
    .replace(/(\d)\s*(к|корп|стр)\.?\s*(\d)/gu, '$1 $2 $3');
  return (spaced.match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((token) => !ADDRESS_NOISE_WORDS.has(token));
}

/**
 * Одна подсказка ещё не означает точное совпадение: DaData может вернуть
 * единственный похожий номер из другого города. Для автоматического выбора
 * должны совпасть все числовые части и хотя бы два смысловых слова, обычно
 * населённый пункт и улица. В сомнительном случае решение принимает человек.
 */
export function titleMatchesAddress(chatTitle: string, address: HouseAddressSuggestion): boolean {
  const titleTokens = addressTokens(chatTitle);
  const addressValueTokens = addressTokens(address.value);
  const titleNumbers = new Set(titleTokens.filter((token) => /\d/u.test(token)));
  const addressNumbers = new Set(addressValueTokens.filter((token) => /\d/u.test(token)));
  if (
    titleNumbers.size === 0 ||
    titleNumbers.size !== addressNumbers.size ||
    [...titleNumbers].some((token) => !addressNumbers.has(token))
  ) {
    return false;
  }

  const addressWords = new Set(addressValueTokens.filter((token) => !/\d/u.test(token)));
  const matchingWords = new Set(
    titleTokens.filter((token) => !/\d/u.test(token) && addressWords.has(token)),
  );
  return matchingWords.size >= 2;
}

async function callDaData(
  apiKey: string,
  path: string,
  body: Record<string, unknown>,
  fetcher: typeof fetch,
): Promise<DaDataHouse[]> {
  if (!apiKey) throw new AddressProviderError('API-ключ DaData не настроен');

  let response: Response;
  let data: unknown;
  try {
    ({ response, data } = await withTimeout(async (signal) => {
      const response = await fetcher(new URL(path, DADATA_API_ORIGIN).href, {
        method: 'POST',
        headers: {
          authorization: `Token ${apiKey}`,
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      });
      return { response, data: await response.json() as unknown };
    }, 6_000));
  } catch {
    throw new AddressProviderError('DaData не ответила вовремя или вернула некорректный ответ');
  }

  if (!response.ok) {
    throw new AddressProviderError(`DaData ответила с HTTP ${response.status}`);
  }
  if (!isRecord(data) || !Array.isArray(data.suggestions)) {
    throw new AddressProviderError('DaData вернула ответ без подсказок');
  }

  const unique = new Map<string, DaDataHouse>();
  for (const item of data.suggestions) {
    const suggestion = parseSuggestion(item);
    if (suggestion) unique.set(suggestion.garHouseGuid, suggestion);
  }
  return [...unique.values()];
}

export function suggestHouseAddresses(
  apiKey: string,
  query: string,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<DaDataHouse[]> {
  return callDaData(apiKey, '/suggestions/api/4_1/rs/suggest/address', { query, count: 10 }, fetcher);
}

/** Подсказка для браузера: без точки, она нужна только серверу. */
export function publicSuggestion({ value, locality, garHouseGuid }: DaDataHouse): HouseAddressSuggestion {
  return { value, locality, garHouseGuid };
}

export async function resolveHouseAddressFromTitle(
  apiKey: string,
  chatTitle: string,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<DaDataHouse | null> {
  const suggestions = await suggestHouseAddresses(apiKey, chatTitle, fetcher);
  const exactMatches = suggestions.filter((address) => titleMatchesAddress(chatTitle, address));
  return exactMatches.length === 1 ? exactMatches[0] ?? null : null;
}

export async function findHouseAddressByGuid(
  apiKey: string,
  garHouseGuid: string,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<DaDataHouse | null> {
  const suggestions = await callDaData(
    apiKey,
    '/suggestions/api/4_1/rs/findById/address',
    { query: garHouseGuid, count: 1 },
    fetcher,
  );
  return suggestions.find((suggestion) => suggestion.garHouseGuid === garHouseGuid) ?? null;
}
