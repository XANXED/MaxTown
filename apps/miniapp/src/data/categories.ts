// Системы и Категории по CONTEXT.md. Каждая Система — ещё и Категория
// Заявки, но бывают Категории без Системы (сантехника в Квартире, уборка,
// домофон). Список общий с API: packages/shared/src/requests.ts.
import type { RequestPlace } from '@maxtown/shared';
import { HOUSE_SYSTEMS, REQUEST_CATEGORIES, type HouseSystemName } from '@maxtown/shared/requests';

export type { HouseSystemName, RequestPlace };
export { categoriesFor, findSubcategory, subcategoriesFor, type RequestSubcategory } from '@maxtown/shared/requests';

/** Системы Дома в порядке показа в Состоянии дома. */
export const houseSystems = HOUSE_SYSTEMS;

/** Все Категории Заявки: сначала Системы, потом остальные. */
export const requestCategories: readonly string[] = REQUEST_CATEGORIES;

/** Где неисправность: Заявка бывает о своей Квартире или об Общем имуществе. */
export const requestPlaces: Array<{ value: RequestPlace; label: string; hint: string }> = [
  { value: 'apartment', label: 'В Квартире', hint: 'Ответственный придёт в Квартиру: выберите удобный день Визита' },
  { value: 'common-property', label: 'В Общем имуществе', hint: 'Лифты, подъезды, стояки, крыша, двор. Заявку увидят все соседи' },
];
