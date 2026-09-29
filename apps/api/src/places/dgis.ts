import type { GeoPoint, NearestPlace, NearestPlaceKind } from '@maxtown/shared';

// Клиент 2ГИС для Ближайших мест (docs/adr/0008, docs/research/2gis-maps-api.md).
// Правила API 2ГИС запрещают сохранять полученные данные, кроме временного
// кеша геокодирования: поэтому здесь только запросы и приведение ответа к
// нашему типу, без записи куда-либо.

export type { GeoPoint };

/** Как искать Вид в Places API: рубрика, уточняющий запрос и радиус. */
type KindQuery = { rubricId: string; q?: string; radius: number; only24x7?: boolean };

// ID рубрик подобраны через Categories API 2026-09-28 (Санкт-Петербург,
// Казань). Текстовый запрос отсекает лишнее внутри рубрики: в «Больницах»
// много частных медцентров, а нужны приёмные отделения.
export const nearestQueries: Record<NearestPlaceKind, KindQuery> = {
  trauma: { rubricId: '229', radius: 5000 },
  'emergency-room': { rubricId: '201', q: 'приёмное отделение', radius: 10000 },
  'pharmacy-24': { rubricId: '207', q: 'круглосуточная аптека', radius: 3000, only24x7: true },
  'vet-24': { rubricId: '205', q: 'круглосуточная ветклиника', radius: 5000, only24x7: true },
  mfc: { rubricId: '53505', radius: 5000 },
  'social-services': { rubricId: '520', radius: 5000 },
  'social-fund': { rubricId: '112791', radius: 10000 },
  tax: { rubricId: '132', radius: 10000 },
  'registry-office': { rubricId: '138', radius: 10000 },
  batteries: { rubricId: '110523', q: 'приём батареек', radius: 3000 },
};

/** Демо-ключ 2ГИС отдаёт не больше 10 результатов на запрос. */
const PAGE_SIZE = 5;
const TIMEOUT_MS = 8000;
const BASE_URL = 'https://catalog.api.2gis.com';

type DgisWorkingHours = { from: string; to: string };
type DgisSchedule = Partial<Record<'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun', { working_hours?: DgisWorkingHours[] }>> & {
  is_24x7?: boolean;
};
type DgisItem = {
  id: string;
  name?: string;
  address_name?: string;
  address_comment?: string;
  point?: GeoPoint;
  schedule?: DgisSchedule;
};
type DgisResponse = { meta?: { code?: number; error?: { message?: string } }; result?: { items?: DgisItem[] } };

export class DgisError extends Error {}

export type DgisClient = {
  /** Точка здания по адресу; undefined — адрес не нашёлся. */
  geocode(address: string, locality: string): Promise<GeoPoint | undefined>;
  nearest(kind: NearestPlaceKind, house: GeoPoint, now?: Date): Promise<NearestPlace[]>;
};

type Fetcher = (url: URL, init: { signal: AbortSignal }) => Promise<{ json(): Promise<unknown> }>;

const EARTH_RADIUS = 6_371_000;
const radians = (degrees: number) => (degrees * Math.PI) / 180;

export function distanceMetres(a: GeoPoint, b: GeoPoint): number {
  const dLat = radians(b.lat - a.lat);
  const dLon = radians(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h))));
}

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
/** Дома пока в одном поясе: Москва, Петербург, Казань. */
const HOUSE_TIME_ZONE = 'Europe/Moscow';

/** «09:30» → «9:30», «24:00» остаётся. */
const clock = (value: string) => value.replace(/^0(\d)/, '$1');

/** Часы на сегодня по поясу Дома: «9:30–21:00»; null — выходной; undefined — часов нет. */
export function hoursToday(schedule: DgisSchedule | undefined, now: Date): string | null | undefined {
  if (!schedule) return undefined;
  if (schedule.is_24x7) return 'Круглосуточно';
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: HOUSE_TIME_ZONE }).format(now);
  const key = weekdays.find((name) => name === day);
  const hours = key ? schedule[key]?.working_hours : undefined;
  if (!hours || hours.length === 0) return null;
  return hours.map(({ from, to }) => `${clock(from)}–${clock(to)}`).join(', ');
}

/** id ветки бывает с хвостом «_хеш»; карточке 2ГИС нужен только номер. */
export function firmUrl(id: string): string {
  return `https://2gis.ru/firm/${encodeURIComponent(id.split('_')[0] ?? id)}`;
}

export function toNearestPlace(item: DgisItem, house: GeoPoint, now: Date): NearestPlace | undefined {
  if (!item.point || !item.name) return undefined;
  const today = hoursToday(item.schedule, now);
  return {
    id: item.id,
    title: item.name,
    ...(item.address_name ? { address: item.address_name } : {}),
    ...(item.address_comment ? { addressComment: item.address_comment } : {}),
    point: { lat: item.point.lat, lon: item.point.lon },
    distance: distanceMetres(house, item.point),
    open24x7: item.schedule?.is_24x7 === true,
    ...(today !== undefined ? { hoursToday: today } : {}),
    url: firmUrl(item.id),
  };
}

export function createDgisClient({ key, fetcher = fetch as unknown as Fetcher }: { key: string; fetcher?: Fetcher }): DgisClient {
  /** Запрос с таймаутом и одним повтором: соединение с 2ГИС иногда обрывается на подключении. */
  async function request(path: string, params: Record<string, string>): Promise<DgisResponse> {
    const url = new URL(path, BASE_URL);
    url.search = new URLSearchParams({ ...params, locale: 'ru_RU', key }).toString();
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = (await (await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })).json()) as DgisResponse;
        const code = response.meta?.code;
        // 404 у 2ГИС — «ничего не найдено», это не сбой.
        if (code === 200 || code === 404) return response;
        throw new DgisError(`2GIS ${code ?? 'unknown'}: ${response.meta?.error?.message ?? 'no message'}`);
      } catch (error) {
        if (error instanceof DgisError) throw error;
        lastError = error;
      }
    }
    throw new DgisError(`2GIS unreachable: ${lastError instanceof Error ? lastError.message : 'unknown'}`);
  }

  return {
    async geocode(address, locality) {
      const response = await request('/3.0/items/geocode', { q: `${locality}, ${address}`, type: 'building', fields: 'items.point' });
      return response.result?.items?.find((item) => item.point)?.point;
    },

    async nearest(kind, house, now = new Date()) {
      const query = nearestQueries[kind];
      const point = `${house.lon},${house.lat}`;
      const response = await request('/3.0/items', {
        type: 'branch',
        rubric_id: query.rubricId,
        ...(query.q ? { q: query.q } : {}),
        point,
        location: point,
        radius: String(query.radius),
        sort: 'distance',
        page_size: String(PAGE_SIZE),
        fields: 'items.point,items.address,items.schedule',
      });
      return (response.result?.items ?? [])
        .map((item) => toNearestPlace(item, house, now))
        .filter((place): place is NearestPlace => place !== undefined && (!query.only24x7 || place.open24x7))
        .sort((a, b) => a.distance - b.distance);
    },
  };
}
