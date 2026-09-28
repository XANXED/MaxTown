export type HouseForContactImport = { address: string; locality: string };

export type ImportedHouseContact = {
  externalKey: string;
  title: string;
  description: string;
  phone: string;
};

export type ContactImportResult = {
  status: 'ready' | 'not-found' | 'ambiguous';
  contacts: ImportedHouseContact[];
};

export type HouseContactSource = {
  importForHouse: (house: HouseForContactImport) => Promise<ContactImportResult>;
};

type DataMosPhone = { PublicPhone?: unknown };
type DataMosHouse = { Address?: unknown };
type DataMosCells = {
  FullName?: unknown;
  ShortName?: unknown;
  PublicPhone?: unknown;
  MKD?: unknown;
};
type DataMosRow = { global_id?: unknown; Cells?: unknown };

const PAGE_SIZE = 1000;
const DEFAULT_TIMEOUT_MS = 8_000;
const DATASET_ROWS_URL = 'https://apidata.mos.ru/v1/datasets/2681/rows';

const addressTokenAliases: Record<string, string> = {
  улица: 'ул',
  ул: 'ул',
  проспект: 'просп',
  просп: 'просп',
  переулок: 'пер',
  пер: 'пер',
  шоссе: 'ш',
  ш: 'ш',
  набережная: 'наб',
  наб: 'наб',
  корпус: 'корп',
  корп: 'корп',
  строение: 'стр',
  стр: 'стр',
};

/** Без нечёткого поиска: унифицируем только оформление и частые адресные сокращения. */
export function normalizeMoscowAddress(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/пр[\s.-]*кт/gu, 'проспект')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .filter((token) => !['г', 'город', 'москва', 'д', 'дом'].includes(token))
    .map((token) => addressTokenAliases[token] ?? token)
    .join(' ');
}

function normalizePhone(value: string): string {
  return value.replace(/[^+\d]/g, '');
}

function dataMosUrl(apiKey: string, skip: number, baseUrl: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('$top', String(PAGE_SIZE));
  url.searchParams.set('$skip', String(skip));
  return url.toString();
}

function parseRow(value: unknown): { id: string; cells: DataMosCells } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Некорректный ответ data.mos.ru');
  const row = value as DataMosRow;
  if ((typeof row.global_id !== 'number' && typeof row.global_id !== 'string')
    || !row.Cells || typeof row.Cells !== 'object' || Array.isArray(row.Cells)) {
    throw new Error('Некорректный ответ data.mos.ru');
  }
  return { id: String(row.global_id), cells: row.Cells as DataMosCells };
}

function stringsFromTable(value: unknown, key: 'PublicPhone' | 'Address'): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const field = (item as DataMosPhone & DataMosHouse)[key];
    return typeof field === 'string' && field.trim() ? [field.trim()] : [];
  });
}

function organisationName(cells: DataMosCells): string {
  if (typeof cells.ShortName === 'string' && cells.ShortName.trim()) return cells.ShortName.trim();
  if (typeof cells.FullName === 'string' && cells.FullName.trim()) return cells.FullName.trim();
  throw new Error('Некорректный ответ data.mos.ru');
}

export function createDataMosContactSource({
  apiKey,
  fetchImpl = fetch,
  baseUrl = DATASET_ROWS_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}): HouseContactSource {
  return {
    async importForHouse(house) {
      const rows: Array<{ id: string; cells: DataMosCells }> = [];
      for (let skip = 0; ; skip += PAGE_SIZE) {
        const response = await fetchImpl(dataMosUrl(apiKey, skip, baseUrl), {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) throw new Error(`data.mos.ru ответил ${response.status}`);
        const payload: unknown = await response.json();
        if (!Array.isArray(payload)) throw new Error('Некорректный ответ data.mos.ru');
        rows.push(...payload.map(parseRow));
        if (payload.length < PAGE_SIZE) break;
      }

      const target = normalizeMoscowAddress(`${house.locality} ${house.address}`);
      const matched = rows.filter(({ cells }) =>
        stringsFromTable(cells.MKD, 'Address').some((address) => normalizeMoscowAddress(address) === target));
      if (matched.length === 0) return { status: 'not-found', contacts: [] };
      if (matched.length > 1) return { status: 'ambiguous', contacts: [] };

      const { id, cells } = matched[0]!;
      const description = organisationName(cells);
      const phones = new Map<string, string>();
      for (const phone of stringsFromTable(cells.PublicPhone, 'PublicPhone')) {
        const normalized = normalizePhone(phone);
        if (normalized) phones.set(normalized, phone);
      }
      if (phones.size === 0) return { status: 'not-found', contacts: [] };

      return {
        status: 'ready',
        contacts: [...phones].map(([normalized, phone]) => ({
          externalKey: `${id}:${normalized}`,
          title: 'Управляющая организация',
          description,
          phone,
        })),
      };
    },
  };
}
