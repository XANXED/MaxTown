import type { HouseAddressSuggestion } from '@maxtown/shared';
import { withTimeout } from '@maxtown/shared/http';

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

function parseSuggestion(value: unknown): HouseAddressSuggestion | null {
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

  // Уровень 8 в DaData означает конкретный дом. Улицу или населённый пункт
  // нельзя принять за Дом даже при единственной подсказке.
  if (!label || !garHouseGuid || String(data.fias_level) !== '8') return null;

  const localityParts = [
    ...new Set(
      [data.region_with_type, data.area_with_type, data.city_with_type, data.settlement_with_type]
        .filter((part): part is string => typeof part === 'string' && Boolean(part.trim()))
        .map((part) => part.trim()),
    ),
  ];

  return {
    value: label,
    locality: localityParts.join(', ') || label,
    garHouseGuid,
  };
}

function addressTokens(value: string): string[] {
  return (value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').match(/[\p{L}\p{N}]+/gu) ?? [])
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
): Promise<HouseAddressSuggestion[]> {
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

  const unique = new Map<string, HouseAddressSuggestion>();
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
): Promise<HouseAddressSuggestion[]> {
  return callDaData(apiKey, '/suggestions/api/4_1/rs/suggest/address', { query, count: 10 }, fetcher);
}

export async function resolveHouseAddressFromTitle(
  apiKey: string,
  chatTitle: string,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<HouseAddressSuggestion | null> {
  const suggestions = await suggestHouseAddresses(apiKey, chatTitle, fetcher);
  const exactMatches = suggestions.filter((address) => titleMatchesAddress(chatTitle, address));
  return exactMatches.length === 1 ? exactMatches[0] ?? null : null;
}

export async function findHouseAddressByGuid(
  apiKey: string,
  garHouseGuid: string,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<HouseAddressSuggestion | null> {
  const suggestions = await callDaData(
    apiKey,
    '/suggestions/api/4_1/rs/findById/address',
    { query: garHouseGuid, count: 1 },
    fetcher,
  );
  return suggestions.find((suggestion) => suggestion.garHouseGuid === garHouseGuid) ?? null;
}
