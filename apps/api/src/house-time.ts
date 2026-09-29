// Время в текстах, которые собирает сервер: Уведомления и сообщения бота.
// Процесс API живёт в UTC, а Жильцы читают время своего Дома.

/** Дома пока в одном поясе: Москва, Петербург, Казань. */
export const HOUSE_TIME_ZONE = 'Europe/Moscow';

const houseTime = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: HOUSE_TIME_ZONE,
});

/** «12 октября, 09:00» по времени Дома. */
export function formatHouseTime(date: Date): string {
  return houseTime.format(date).replace(' в ', ', ');
}
