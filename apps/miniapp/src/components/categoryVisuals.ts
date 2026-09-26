import {
  Broom,
  DoorOpen,
  DotsThreeCircle,
  Drop,
  Elevator,
  Lightning,
  Thermometer,
  Toilet,
  WifiHigh,
} from '@phosphor-icons/react';
import type { HouseSystemName } from '../data/categories.ts';
import type { IconComponent, TileTone } from './ui.tsx';

export type CategoryVisual = { icon: IconComponent; tone: TileTone };

/** Системы: один цвет на Систему везде — в Состоянии дома, в форме и в списке Заявок. */
export const systemVisuals: Record<HouseSystemName, CategoryVisual> = {
  Электричество: { icon: Lightning, tone: 'coral' },
  Вода: { icon: Drop, tone: 'blue' },
  Отопление: { icon: Thermometer, tone: 'pink' },
  Лифты: { icon: Elevator, tone: 'teal' },
  Интернет: { icon: WifiHigh, tone: 'green' },
};

const otherCategoryVisuals: Record<string, CategoryVisual> = {
  Сантехника: { icon: Toilet, tone: 'teal' },
  Домофон: { icon: DoorOpen, tone: 'coral' },
  Уборка: { icon: Broom, tone: 'pink' },
};

const fallback: CategoryVisual = { icon: DotsThreeCircle, tone: 'neutral' };

/** Иконка Категории; незнакомая Категория (придёт от Дома) получает нейтральную. */
export function categoryVisual(category: string): CategoryVisual {
  return systemVisuals[category as HouseSystemName] ?? otherCategoryVisuals[category] ?? fallback;
}
