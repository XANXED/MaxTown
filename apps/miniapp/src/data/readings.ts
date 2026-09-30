import type { Meter, MeterInput, ReadingsInput, ReadingsWindow } from '@maxtown/shared';
import { apiFetch } from '../auth/session.ts';
import { useMembership } from '../auth/membership.tsx';
import { jsonRequest, readApiJson } from './api.ts';
import { useApiLoadable, type ApiLoadable } from './loadable.ts';

// Показания — цифры с приборов учёта Квартиры (CONTEXT.md). Проверяем то,
// что видно сразу: число, не меньше прошлого, не больше знаков, чем на приборе.

/** Число из поля: запятая или точка, пробелы между разрядами. Иначе null. */
export function parseReading(text: string): number | null {
  const compact = text.replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(compact)) return null;
  return Number(compact);
}

export type ReadingCheck =
  | { kind: 'empty' }
  | { kind: 'ok'; value: number; consumption?: number }
  /** Необычно большой расход: скорее всего, лишняя цифра или запятая не там. Отправить можно. */
  | { kind: 'warning'; value: number; consumption: number; message: string }
  | { kind: 'error'; message: string };

/** Расход за месяц, после которого переспрашиваем. */
const unusualConsumption: Record<Meter['kind'], number> = {
  'cold-water': 30,
  'hot-water': 30,
  'electricity-day': 2000,
  'electricity-night': 2000,
  heat: 5,
};

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function checkReading(meter: Meter, text: string): ReadingCheck {
  if (!text.trim()) return { kind: 'empty' };
  const value = parseReading(text);
  if (value === null) return { kind: 'error', message: 'Только цифры, например 127,5' };

  const fraction = text.replace(/\s/g, '').split(/[.,]/)[1] ?? '';
  if (fraction.length > meter.decimals) {
    return { kind: 'error', message: `После запятой не больше ${meter.decimals} цифр, как на приборе` };
  }

  if (!meter.previous) return { kind: 'ok', value };
  if (value < meter.previous.value) {
    return {
      kind: 'error',
      message: `Меньше прошлых Показаний: ${formatReading(meter.previous.value, meter.decimals)} ${meter.unit}`,
    };
  }

  const consumption = round(value - meter.previous.value, meter.decimals);
  if (consumption > unusualConsumption[meter.kind]) {
    return {
      kind: 'warning',
      value,
      consumption,
      message: `Расход ${formatReading(consumption, meter.decimals)} ${meter.unit} за месяц, это необычно много. Проверьте запятую`,
    };
  }
  return { kind: 'ok', value, consumption };
}

/** «4,044», «1 204,2» — как пишут на приборе и в квитанции. */
export function formatReading(value: number, decimals: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: decimals }).format(value);
}

/** Принимают ли Показания сегодня. Даты — включительно, по местному времени. */
export function windowState(window: Pick<ReadingsWindow, 'from' | 'to'>, now: Date): 'not-yet' | 'open' | 'closed' {
  const day = (iso: string) => {
    const [year, month, date] = iso.split('-').map(Number);
    return new Date(year ?? 0, (month ?? 1) - 1, date ?? 1).getTime();
  };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (today < day(window.from)) return 'not-yet';
  if (today > day(window.to)) return 'closed';
  return 'open';
}

const messages = {
  meter_readings_private: 'Показания доступны только участникам Квартиры',
  meter_readings_apartment_required: 'Сначала привяжитесь к Квартире',
  meter_invalid: 'Проверьте название, номер и точность Прибора учёта',
  meter_version_required: 'Обновите экран и повторите изменение Прибора учёта',
  meter_already_exists: 'Такой Прибор учёта уже добавлен',
  meter_version_conflict: 'Прибор уже изменил другой участник Квартиры. Обновите экран',
  meter_not_found: 'Прибор учёта не найден',
  reading_invalid: 'Проверьте число и количество знаков после запятой',
  reading_less_than_previous: 'Показания не могут быть меньше записи за прошлый месяц',
  readings_empty: 'Заполните хотя бы один Прибор учёта',
  readings_duplicate_meter: 'Один Прибор учёта указан дважды',
};

function readingsUrl(houseId: string): string {
  return `/api/houses/${encodeURIComponent(houseId)}/readings`;
}

function metersUrl(houseId: string): string {
  return `/api/houses/${encodeURIComponent(houseId)}/meters`;
}

export async function loadReadings(houseId: string): Promise<ReadingsWindow> {
  return readApiJson<ReadingsWindow>(
    await apiFetch(readingsUrl(houseId)),
    'Не удалось загрузить Показания',
    messages,
  );
}

export async function saveReadings(houseId: string, input: ReadingsInput): Promise<ReadingsWindow> {
  return readApiJson<ReadingsWindow>(
    await apiFetch(readingsUrl(houseId), jsonRequest('POST', input)),
    'Не удалось сохранить Показания',
    messages,
  );
}

export async function saveMeter(houseId: string, input: MeterInput, meterId?: string): Promise<Meter> {
  const response = await apiFetch(
    meterId ? `${metersUrl(houseId)}/${encodeURIComponent(meterId)}` : metersUrl(houseId),
    jsonRequest(meterId ? 'PUT' : 'POST', input),
  );
  return (await readApiJson<{ meter: Meter }>(response, 'Не удалось сохранить Прибор учёта', messages)).meter;
}

export async function archiveMeter(houseId: string, meter: Meter): Promise<void> {
  await readApiJson(
    await apiFetch(
      `${metersUrl(houseId)}/${encodeURIComponent(meter.id)}/archive`,
      jsonRequest('POST', { version: meter.version }),
    ),
    'Не удалось убрать Прибор учёта',
    messages,
  );
}

/** Приборы и Показания Квартиры. null — у человека нет доступной Квартиры. */
export function useReadingsWindow(): ApiLoadable<ReadingsWindow | null> {
  const membership = useMembership();
  const houseId = membership?.apartmentId && membership.role !== 'management-company' ? membership.houseId : null;
  return useApiLoadable<ReadingsWindow | null>(
    houseId ? () => loadReadings(houseId) : null,
    null,
    ({ sampleReadingsWindow }) => sampleReadingsWindow(),
    houseId ?? '',
  );
}
