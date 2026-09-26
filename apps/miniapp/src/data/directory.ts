import type { Contact, Place } from '@maxtown/shared';
import { useLoadable, type Loadable } from './loadable.ts';

// Справочник: Контакты (их ведёт Староста) и Места рядом с Домом.

/**
 * Экстренные номера России — одинаковы для любого Дома, поэтому живут в
 * приложении, а не приходят от Старосты. С мобильного работают без SIM-карты.
 */
export const emergencyNumbers: Contact[] = [
  { id: 'sos-112', title: 'Единый номер экстренных служб', description: 'Пожар, ДТП, угроза жизни', phone: '112', kind: 'emergency' },
  { id: 'sos-101', title: 'Пожарная охрана', phone: '101', kind: 'emergency' },
  { id: 'sos-102', title: 'Полиция', phone: '102', kind: 'emergency' },
  { id: 'sos-103', title: 'Скорая помощь', phone: '103', kind: 'emergency' },
  { id: 'sos-104', title: 'Аварийная газовая служба', description: 'Пахнет газом', phone: '104', kind: 'emergency' },
];

/** Ссылка для звонка: из номера остаются плюс и цифры. */
export function phoneHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

const kilometres = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

/** «350 м», «1,2 км». Метры округляем до десятков: точнее всё равно не пройти. */
export function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres / 10) * 10} м`;
  return `${kilometres.format(metres / 1000)} км`;
}

/** Адрес на Яндекс Картах: карта откроется в браузере или в приложении карт. */
export function mapLink(address: string): string {
  return `https://yandex.ru/maps/?text=${encodeURIComponent(address)}`;
}

export const placeCategoryLabels: Record<Place['category'], string> = {
  clinic: 'Поликлиники',
  mfc: 'МФЦ',
  pharmacy: 'Аптеки',
  school: 'Школы',
  kindergarten: 'Детские сады',
  other: 'Другое',
};

export type PlaceFilter = 'all' | Place['category'];

/** Фильтры Мест рядом: «Все» и только те категории, что есть, с числом. */
export function placeFilters(places: Place[]): Array<{ value: PlaceFilter; label: string; count: number }> {
  const categories = Object.keys(placeCategoryLabels) as Array<Place['category']>;
  return [
    { value: 'all' as const, label: 'Все', count: places.length },
    ...categories
      .map((category) => ({
        value: category,
        label: placeCategoryLabels[category],
        count: places.filter((place) => place.category === category).length,
      }))
      .filter(({ count }) => count > 0),
  ];
}

/**
 * Контакты Дома от Старосты. null — человек ещё не Жилец, Дом неизвестен.
 * Без API так всегда; примеры для dev — см. loadable.ts.
 */
export function useHouseContacts(): Loadable<Contact[] | null> {
  return useLoadable<Contact[] | null>(null, ({ sampleContacts }) => sampleContacts);
}

/** Места рядом с Домом, ближние первыми. null — Дом неизвестен. */
export function usePlaces(): Loadable<Place[] | null> {
  return useLoadable<Place[] | null>(null, ({ samplePlaces }) => [...samplePlaces].sort((a, b) => a.distance - b.distance));
}
