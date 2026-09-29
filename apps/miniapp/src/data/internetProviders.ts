import type {
  HouseInternetProvider,
  HouseInternetProviderInput,
  HouseInternetProviderRating,
  HouseInternetProvidersResponse,
  InternetTariff,
} from '@maxtown/shared';
import { apiFetch } from '../auth/session.ts';

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error('internet_providers_request_failed');
  return response.json() as Promise<T>;
}

export function createInternetProvidersClient(fetcher: Fetcher = apiFetch) {
  const base = (houseId: string) => `/api/houses/${encodeURIComponent(houseId)}/internet-providers`;
  return {
    load: (houseId: string) => fetcher(base(houseId))
      .then((response) => readJson<HouseInternetProvidersResponse>(response))
      .then(({ providers }) => providers),
    save: (houseId: string, input: HouseInternetProviderInput, providerId?: string) => fetcher(
      providerId ? `${base(houseId)}/${encodeURIComponent(providerId)}` : base(houseId),
      { method: providerId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) },
    ).then((response) => readJson<{ provider: HouseInternetProvider }>(response)).then(({ provider }) => provider),
    rate: (houseId: string, providerId: string, score: number) => fetcher(
      `${base(houseId)}/${encodeURIComponent(providerId)}/rating`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ score }) },
    ).then((response) => readJson<{ rating: HouseInternetProviderRating }>(response)).then(({ rating }) => rating),
    remove: async (houseId: string, providerId: string) => {
      const response = await fetcher(`${base(houseId)}/${encodeURIComponent(providerId)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('internet_providers_request_failed');
    },
  };
}

export const internetProvidersClient = createInternetProvidersClient();

export type TariffFreshness = 'current' | 'stale';

export function tariffFreshness(
  tariff: Pick<InternetTariff, 'checkedOn'>,
  today = new Date().toISOString().slice(0, 10),
): TariffFreshness {
  const checked = Date.parse(`${tariff.checkedOn}T00:00:00.000Z`);
  const current = Date.parse(`${today}T00:00:00.000Z`);
  return current - checked > 90 * 24 * 60 * 60 * 1000 ? 'stale' : 'current';
}

function ratingWord(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return 'оценок';
  if (mod10 === 1) return 'оценка';
  if (mod10 >= 2 && mod10 <= 4) return 'оценки';
  return 'оценок';
}

export function formatInternetRating(rating: HouseInternetProviderRating): string {
  if (rating.average === null || rating.count === 0) return 'Пока нет оценок';
  return `${rating.average.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} · ${rating.count} ${ratingWord(rating.count)}`;
}

export const internetTechnologyLabels: Record<NonNullable<InternetTariff['technology']>, string> = {
  fttb: 'FTTB',
  gpon: 'GPON',
  docsis: 'DOCSIS',
  xdsl: 'xDSL',
  wireless: 'Беспроводное',
  other: 'Другое',
};

export const internetProviderSourceLabels: Record<HouseInternetProvider['source'], string> = {
  manual: 'Добавлено Администратором Дома',
  'partner-feed': 'Партнёрская выгрузка',
  'operator-api': 'API Поставщика',
  'gis-zhkh': 'ГИС ЖКХ',
};
