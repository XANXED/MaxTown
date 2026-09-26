import type { Meter, ReadingsWindow } from '@maxtown/shared';
import { useLoadable, type Loadable } from './loadable.ts';

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

/** Приборы Квартиры и сроки приёма. null — человек ещё не Жилец. Примеры для dev — см. loadable.ts. */
export function useReadingsWindow(): Loadable<ReadingsWindow | null> {
  return useLoadable<ReadingsWindow | null>(null, ({ sampleReadingsWindow }) => sampleReadingsWindow());
}
