// Примеры для `?demo=filled` в режиме разработки. В сборку не попадают — см. loadable.ts.
import type { HouseRegistration } from '@maxtown/shared';

function daysAgo(days: number, hours = 10): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hours, 0, 0, 0);
  return date.toISOString();
}

export function sampleRegistrations(): HouseRegistration[] {
  return [
    {
      id: 'g1',
      address: 'ул. Архитектора Гайнутдинова, 26',
      locality: 'Казань, Приволжский район',
      headman: { name: 'Ильдар Сафин', maxUsername: 'ildar_safin', phone: '+7 917 402-18-66', apartment: '87' },
      submittedAt: daysAgo(3, 19),
      status: 'pending',
    },
    {
      id: 'g2',
      address: 'пр. Победы, 3',
      locality: 'Казань, Приволжский район',
      garHouseGuid: '5b8e2c1a-7f43-4d0e-9a61-2c3f8e0b7d14',
      headman: { name: 'Олег Баранов', phone: '+7 987 215-40-93', apartment: '45' },
      submittedAt: daysAgo(2, 9),
      status: 'pending',
    },
    {
      id: 'g3',
      address: 'пр. Победы, 3',
      locality: 'Казань, Приволжский район',
      garHouseGuid: '5b8e2c1a-7f43-4d0e-9a61-2c3f8e0b7d14',
      headman: { name: 'Светлана Кузнецова', maxUsername: 'kuznetsova_s', apartment: '12' },
      submittedAt: daysAgo(1, 21),
      status: 'pending',
    },
    {
      id: 'g4',
      address: 'ул. Сосновая, 4',
      locality: 'Казань, Советский район',
      garHouseGuid: 'a13d09f2-44be-4c71-8d2a-6e5b0f9c3a87',
      headman: { name: 'Евгения Лаптева', maxUsername: 'laptevaev', phone: '+7 903 318-72-04', apartment: '31' },
      submittedAt: daysAgo(0, 8),
      status: 'pending',
    },
    {
      id: 'g5',
      address: 'ул. Лесная, 12',
      locality: 'Казань, Советский район',
      garHouseGuid: 'e7f1b6d0-2c95-4a3e-b8d7-19f4a6c02e5b',
      headman: { name: 'Марина Ковалёва', maxUsername: 'marina_kov', phone: '+7 917 286-55-10', apartment: '12' },
      submittedAt: daysAgo(12),
      status: 'approved',
      decidedAt: daysAgo(11),
    },
    {
      id: 'g6',
      address: 'ул. Лесная, 14',
      locality: 'Казань, Советский район',
      garHouseGuid: '0c4a8e27-91d3-4f6b-a5e2-7b3d9f1c8a60',
      headman: { name: 'Артём Юсупов', apartment: '7' },
      submittedAt: daysAgo(8),
      status: 'rejected',
      decidedAt: daysAgo(7),
      rejectionReason: 'По этому адресу школа, а не жилой дом. Проверьте номер дома и зарегистрируйте заново',
    },
  ];
}
