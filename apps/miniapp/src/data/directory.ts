import type { Contact } from '@maxtown/shared';

export { phoneHref } from './contacts.ts';

// Справочник: экстренные номера и общие подписи. Контакты — в contacts.ts,
// Места рядом — в places.ts.

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
const kilometres = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

/** «350 м», «1,2 км». Метры округляем до десятков: точнее всё равно не пройти. */
export function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres / 10) * 10} м`;
  return `${kilometres.format(metres / 1000)} км`;
}
