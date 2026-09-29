import type { GeoPoint, HouseAddressSuggestion } from '@maxtown/shared';
import { withTimeout } from '@maxtown/shared/http';

// Адрес Дома из подсказок DaData (ГАР). Ключ только серверный; тексту адреса
// из браузера не верим — выбранный addressId перечитываем в DaData.

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
export type DaDataHouse = HouseAddressSuggestion & { garHouseGuid: string | null; point: GeoPoint | null };

/** Префикс addressId дома, которого нет в ГАР: street:<GUID улицы>:<номер дома>. */
const STREET_HOUSE_PREFIX = 'street:';

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** «д 14 к 1» — номер дома так, как его пишет DaData. */
function houseNumber(data: Record<string, unknown>): string | null {
  const parts = [data.house_type, data.house, data.block_type, data.block].map(text).filter((part) => part !== null);
  return text(data.house) ? parts.join(' ') : null;
}

function coordinate(value: unknown, limit: number): number | null {
  const number = typeof value === 'string' && value.trim() ? Number(value) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}

function parseSuggestion(value: unknown): DaDataHouse | null {
  if (!isRecord(value)) return null;
  const suggestion = value as DaDataSuggestion;
  if (!isRecord(suggestion.data)) return null;

  const data = suggestion.data;
  const label = text(suggestion.value) ?? text(suggestion.unrestricted_value);
  if (!label) return null;

  // Уровень 8 — конкретный дом, уровень 9 — квартира/комната в доме.
  // Для поиска Дома подходят оба варианта: при вводе номера квартиры DaData
  // возвращает уровень 9, но house_fias_id по-прежнему содержит GUID Дома.
  // Улицу или населённый пункт нельзя принять за Дом даже при единственной
  // подсказке.
  const fiasLevel = String(data.fias_level);
  const garHouseGuid = fiasLevel === '8' || fiasLevel === '9' ? text(data.house_fias_id) : null;
  // Часть домов (в Петербурге — без литеры) нет в ГАР: DaData отдаёт улицу
  // с номером дома. Принимаем такой дом, только если DaData знает его точные
  // координаты (qc_geo 0); выдуманный номер получает координаты улицы.
  const streetGuid = text(data.street_fias_id);
  const number = houseNumber(data);
  const streetHouse = fiasLevel === '7' && !garHouseGuid && streetGuid && number && String(data.qc_geo) === '0'
    ? `${STREET_HOUSE_PREFIX}${streetGuid}:${number}`
    : null;
  const addressId = garHouseGuid ?? streetHouse;
  if (!addressId) return null;

  const localityParts = [
    ...new Set(
      [data.region_with_type, data.area_with_type, data.city_with_type, data.settlement_with_type]
        .map(text)
        .filter((part) => part !== null),
    ),
  ];

  const lat = coordinate(data.geo_lat, 90);
  const lon = coordinate(data.geo_lon, 180);
  return {
    value: label,
    locality: localityParts.join(', ') || label,
    addressId,
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
    if (suggestion) unique.set(suggestion.addressId, suggestion);
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
export function publicSuggestion({ value, locality, addressId }: DaDataHouse): HouseAddressSuggestion {
  return { value, locality, addressId };
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

/**
 * Перечитать выбранный дом в DaData. Дом из ГАР ищется по GUID, дом без ГАР —
 * по номеру в пределах своей улицы, и снова проходит проверку координат.
 */
export async function findHouseAddress(
  apiKey: string,
  addressId: string,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<DaDataHouse | null> {
  const streetHouse = addressId.startsWith(STREET_HOUSE_PREFIX)
    ? /^([^:]+):(.+)$/u.exec(addressId.slice(STREET_HOUSE_PREFIX.length))
    : null;
  const suggestions = streetHouse
    ? await callDaData(
      apiKey,
      '/suggestions/api/4_1/rs/suggest/address',
      { query: streetHouse[2], count: 10, locations: [{ street_fias_id: streetHouse[1] }] },
      fetcher,
    )
    : await callDaData(apiKey, '/suggestions/api/4_1/rs/findById/address', { query: addressId, count: 1 }, fetcher);
  return suggestions.find((suggestion) => suggestion.addressId === addressId) ?? null;
}
