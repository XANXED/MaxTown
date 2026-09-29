import { useCallback, useEffect, useState } from 'react';
import type { AssignedPlace, AssignedPlaceInput, AssignedPlaceKind, GeoPoint, HouseLocationResponse, NearestPlaceKind, NearestPlacesResponse } from '@maxtown/shared';
import { apiFetch } from '../auth/session.ts';
import { demoMode, initialStatus, loadFixtures, type Loadable } from './loadable.ts';

// Места рядом (CONTEXT.md, docs/adr/0008): Закреплённые места ведёт Администратор Дома,
// Ближайшие API ищет в 2ГИС при каждом открытии. Здесь ничего из 2ГИС не
// сохраняется — ни в памяти между экранами, ни в хранилище браузера.

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Почему Ближайших мест нет: ключ 2ГИС не задан, 2ГИС недоступен или не нашёл Дом. */
export type NearestProblem = 'not-configured' | 'unavailable' | 'location-unknown';

export class NearestPlacesError extends Error {
  readonly problem: NearestProblem;
  constructor(problem: NearestProblem) {
    super(problem);
    this.problem = problem;
  }
}

const nearestProblems: Record<string, NearestProblem> = {
  nearest_places_not_configured: 'not-configured',
  nearest_places_unavailable: 'unavailable',
  house_location_unknown: 'location-unknown',
};

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error('places_request_failed');
  return response.json() as Promise<T>;
}

export function createPlacesClient(fetcher: Fetcher = apiFetch) {
  const base = (houseId: string) => `/api/houses/${encodeURIComponent(houseId)}/places`;
  return {
    assigned: (houseId: string) =>
      fetcher(`${base(houseId)}/assigned`).then((response) => readJson<{ places: AssignedPlace[] }>(response)).then(({ places }) => places),
    save: (houseId: string, input: AssignedPlaceInput, placeId?: string) => {
      const url = placeId ? `${base(houseId)}/assigned/${encodeURIComponent(placeId)}` : `${base(houseId)}/assigned`;
      return fetcher(url, { method: placeId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
        .then((response) => readJson<{ place: AssignedPlace }>(response))
        .then(({ place }) => place);
    },
    remove: async (houseId: string, placeId: string) => {
      const response = await fetcher(`${base(houseId)}/assigned/${encodeURIComponent(placeId)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('places_request_failed');
    },
    /** Точка Дома для карты; ошибки — те же, что у Ближайших мест. */
    location: async (houseId: string) => {
      const response = await fetcher(`${base(houseId)}/location`);
      if (response.ok) return ((await response.json()) as HouseLocationResponse).house;
      const { error } = (await response.json().catch(() => ({}))) as { error?: string };
      throw new NearestPlacesError(nearestProblems[error ?? ''] ?? 'unavailable');
    },
    nearest: async (houseId: string, kind: NearestPlaceKind) => {
      const response = await fetcher(`${base(houseId)}/nearest/${encodeURIComponent(kind)}`);
      if (response.ok) return response.json() as Promise<NearestPlacesResponse>;
      const { error } = (await response.json().catch(() => ({}))) as { error?: string };
      throw new NearestPlacesError(nearestProblems[error ?? ''] ?? 'unavailable');
    },
  };
}

export const placesClient = createPlacesClient();

export const assignedKindLabels: Record<AssignedPlaceKind, string> = {
  'adult-clinic': 'Поликлиника',
  'children-clinic': 'Детская поликлиника',
  'womens-clinic': 'Женская консультация',
  school: 'Школа',
  kindergarten: 'Детский сад',
  'polling-station': 'Избирательный участок',
  magistrate: 'Мировой судья',
  'police-precinct': 'Участковый пункт полиции',
  'military-office': 'Военкомат',
  other: 'Другое',
};

export const assignedKinds = Object.keys(assignedKindLabels) as AssignedPlaceKind[];

export const nearestKindLabels: Record<NearestPlaceKind, { title: string; description: string }> = {
  trauma: { title: 'Травмпункт', description: 'Ушиб, перелом, порез, укус' },
  'emergency-room': { title: 'Приёмное отделение', description: 'Больница, куда можно приехать самому' },
  'pharmacy-24': { title: 'Дежурная аптека', description: 'Работает круглосуточно' },
  'vet-24': { title: 'Круглосуточная ветклиника', description: 'Если питомцу плохо ночью' },
  mfc: { title: 'МФЦ «Мои документы»', description: 'Паспорт, прописка, справки, льготы' },
  'social-services': { title: 'Социальная защита', description: 'Субсидии на ЖКУ, пособия, помощь' },
  'social-fund': { title: 'Социальный фонд', description: 'Пенсии, больничные, материнский капитал' },
  tax: { title: 'Налоговая', description: 'Вычеты, ИНН, налог на имущество' },
  'registry-office': { title: 'ЗАГС', description: 'Рождение, брак, смерть' },
  batteries: { title: 'Приём батареек и ламп', description: 'Куда сдать батарейки, лампы, градусники' },
};

/** Группы Ближайших мест на экране: срочное — первым. */
export const nearestGroups: Array<{ id: string; title: string; kinds: NearestPlaceKind[] }> = [
  { id: 'urgent', title: 'Срочно', kinds: ['trauma', 'emergency-room', 'pharmacy-24', 'vet-24'] },
  { id: 'documents', title: 'Документы и льготы', kinds: ['mfc', 'social-services', 'social-fund', 'tax', 'registry-office'] },
  { id: 'ecology', title: 'Экология', kinds: ['batteries'] },
];

/** Адрес Закреплённого места в 2ГИС: поиск по городу и адресу. */
export function addressLink(locality: string | undefined, address: string): string {
  return `https://2gis.ru/search/${encodeURIComponent([locality, address].filter(Boolean).join(', '))}`;
}

/** Закреплённые места Дома. null — человек ещё не в Доме. */
export function useAssignedPlaces(houseId: string | null): Loadable<AssignedPlace[] | null> {
  const [mode] = useState(demoMode);
  const [status, setStatus] = useState(() => initialStatus(mode));
  const [data, setData] = useState<AssignedPlace[] | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (mode === 'loading' || (mode === 'error' && attempt === 0)) return () => { cancelled = true; };
    if (mode === 'filled') {
      void loadFixtures()?.then(({ sampleAssignedPlaces }) => {
        if (cancelled) return;
        setData(sampleAssignedPlaces);
        setStatus('ready');
      });
      return () => { cancelled = true; };
    }
    if (!houseId) {
      setData(null);
      setStatus('ready');
      return () => { cancelled = true; };
    }
    setStatus('loading');
    placesClient.assigned(houseId).then(
      (places) => {
        if (cancelled) return;
        setData(places);
        setStatus('ready');
      },
      () => { if (!cancelled) setStatus('error'); },
    );
    return () => { cancelled = true; };
  }, [attempt, houseId, mode]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);
  return { status, data, retry };
}

export type NearestPlacesState = Loadable<NearestPlacesResponse | null> & { problem: NearestProblem | null };

/** Ближайшие места одного Вида: живой запрос через API в 2ГИС на каждое открытие. */
export function useNearestPlaces(houseId: string | null, kind: NearestPlaceKind): NearestPlacesState {
  const [mode] = useState(demoMode);
  // Без демо сразу грузимся: запрос уходит при открытии экрана.
  const [status, setStatus] = useState(() => (mode === null ? 'loading' : initialStatus(mode)));
  const [data, setData] = useState<NearestPlacesResponse | null>(null);
  const [problem, setProblem] = useState<NearestProblem | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (mode === 'loading' || (mode === 'error' && attempt === 0)) return () => { cancelled = true; };
    if (mode === 'filled') {
      void loadFixtures()?.then(({ sampleNearestPlaces, sampleHousePoint }) => {
        if (cancelled) return;
        setData({ kind, house: sampleHousePoint, places: sampleNearestPlaces(kind) });
        setStatus('ready');
      });
      return () => { cancelled = true; };
    }
    if (!houseId) {
      setData(null);
      setStatus('ready');
      return () => { cancelled = true; };
    }
    setStatus('loading');
    setProblem(null);
    placesClient.nearest(houseId, kind).then(
      (response) => {
        if (cancelled) return;
        setData(response);
        setStatus('ready');
      },
      (error: unknown) => {
        if (cancelled) return;
        setProblem(error instanceof NearestPlacesError ? error.problem : 'unavailable');
        setStatus('error');
      },
    );
    return () => { cancelled = true; };
  }, [attempt, houseId, kind, mode]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);
  return { status, data, problem, retry };
}

/**
 * Точка Дома для карты Закреплённых мест и выбора точки в форме. null — карты
 * не будет (нет ключа 2ГИС, Дом не нашёлся), а списки работают как раньше.
 */
export function useHouseLocation(houseId: string | null): GeoPoint | null {
  const [mode] = useState(demoMode);
  const [point, setPoint] = useState<GeoPoint | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (mode === 'filled') {
      void loadFixtures()?.then(({ sampleHousePoint }) => { if (!cancelled) setPoint(sampleHousePoint); });
    } else if (houseId && mode === null) {
      placesClient.location(houseId).then(
        (house) => { if (!cancelled) setPoint(house); },
        () => { if (!cancelled) setPoint(null); },
      );
    }
    return () => { cancelled = true; };
  }, [houseId, mode]);

  return point;
}
