// Примеры для `?demo=filled` в режиме разработки: посмотреть, как выглядят
// списки Заявок и Событий дома. В сборку не попадают — см. useHomeData.
import type { HouseEventSummary, RequestSummary } from '@maxtown/shared';

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

export function sampleRequests(): RequestSummary[] {
  return [
    { id: 'r5', number: 2461, category: 'Электричество', title: 'Мигает свет в подъезде', status: 'new', updatedAt: hoursAgo(1) },
    { id: 'r4', number: 2458, category: 'Сантехника', title: 'Течёт кран на кухне', status: 'in-progress', updatedAt: hoursAgo(5) },
    { id: 'r3', number: 2431, category: 'Уборка', title: 'Мусор на лестнице 3-го этажа', status: 'done', updatedAt: hoursAgo(27) },
    { id: 'r2', number: 2390, category: 'Домофон', title: 'Не открывается дверь с ключа', status: 'closed', updatedAt: hoursAgo(24 * 9) },
    { id: 'r1', number: 2344, category: 'Отопление', title: 'Холодная батарея в спальне', status: 'rejected', updatedAt: hoursAgo(24 * 20) },
  ];
}

export const sampleEvents: HouseEventSummary[] = [
  { id: 'e4', kind: 'accident', title: 'Не работает лифт во 2-м подъезде', period: 'с 08:40' },
  { id: 'e3', kind: 'planned-outage', title: 'Отключение горячей воды', period: '12–14 октября' },
  { id: 'e2', kind: 'announcement', title: 'Собрание жильцов во дворе', period: '16 октября, 19:00' },
  { id: 'e1', kind: 'planned-outage', title: 'Отключение интернета', period: '20 октября, 10:00–16:00' },
];
