// Системы и Категории по CONTEXT.md. Каждая Система — ещё и Категория
// Заявки, но бывают Категории без Системы (сантехника в Квартире, уборка,
// домофон). Когда появится API, список Категорий будет приходить от Дома.

/** Системы Дома в порядке показа в Состоянии дома. */
export const houseSystems = ['Электричество', 'Вода', 'Отопление', 'Лифты', 'Интернет'] as const;

export type HouseSystemName = (typeof houseSystems)[number];

/** Категории без Системы. */
const categoriesWithoutSystem = ['Сантехника', 'Домофон', 'Уборка', 'Другое'] as const;

/** Все Категории Заявки: сначала Системы, потом остальные. */
export const requestCategories: readonly string[] = [...houseSystems, ...categoriesWithoutSystem];

/** Где неисправность: Заявка бывает о своей Квартире или об Общем имуществе. */
export type RequestPlace = 'apartment' | 'common-property';

export const requestPlaces: Array<{ value: RequestPlace; label: string; hint: string }> = [
  { value: 'apartment', label: 'В Квартире', hint: 'Ответственный придёт в Квартиру: выберите удобный день Визита' },
  { value: 'common-property', label: 'В Общем имуществе', hint: 'Лифты, подъезды, стояки, крыша, двор' },
];
