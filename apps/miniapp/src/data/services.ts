import type { AppRoute } from '../routes.ts';
import { ROUTES } from '../routes.ts';

/** Ключ иконки: сами иконки подставляет экран, чтобы данные не зависели от React. */
export type ServiceIcon = 'new-request' | 'requests' | 'house-state' | 'events' | 'readings' | 'contacts' | 'places' | 'community' | 'repair-mode';

export type Service = {
  id: string;
  title: string;
  description: string;
  icon: ServiceIcon;
  /** Куда ведёт сервис; без маршрута сервис ещё не готов. */
  route?: AppRoute;
  /**
   * Слова для поиска, которых нет в названии и описании. Сюда намеренно
   * попадают бытовые синонимы, которых нет в глоссарии («мастер»,
   * «счётчики»): люди ищут именно ими.
   */
  keywords?: string;
};

export type ServiceGroup = {
  id: string;
  title: string;
  services: Service[];
};

export const serviceGroups: ServiceGroup[] = [
  {
    id: 'community',
    title: 'Домовое сообщество',
    services: [{ id: 'community', title: 'Чат Дома', description: 'Сообщения соседей и неформальные Опросы', icon: 'community', route: ROUTES.community }],
  },
  {
    id: 'requests',
    title: 'Заявки',
    services: [
      {
        id: 'new-request',
        title: 'Подать заявку',
        description: 'Неисправность в Квартире или в Общем имуществе',
        icon: 'new-request',
        route: ROUTES.newRequest,
        keywords: 'сломалось поломка мастер ремонт',
      },
      {
        id: 'requests',
        title: 'Мои заявки',
        description: 'Статусы, Визиты и Комментарии',
        icon: 'requests',
        route: ROUTES.requests,
      },
    ],
  },
  {
    id: 'house',
    title: 'Дом',
    services: [
      {
        id: 'house-state',
        title: 'Состояние дома',
        description: 'Электричество, вода, отопление, лифты и интернет',
        icon: 'house-state',
        route: ROUTES.house,
        keywords: 'свет системы авария',
      },
      {
        id: 'events',
        title: 'События дома',
        description: 'Аварии, Плановые отключения и Объявления',
        icon: 'events',
        route: ROUTES.events,
        keywords: 'новости собрание отключение',
      },
      {
        id: 'repair-mode',
        title: 'Ремонтные работы',
        description: 'Сроки, подрядчики и влияние на жильцов',
        icon: 'repair-mode',
        route: ROUTES.repairMode,
        keywords: 'ремонт работы сроки подрядчик',
      },
      {
        id: 'readings',
        title: 'Передать показания',
        description: 'Цифры с приборов учёта Квартиры',
        icon: 'readings',
        route: ROUTES.readings,
        keywords: 'счётчики вода электричество',
      },
    ],
  },
  {
    id: 'directory',
    title: 'Справочник',
    services: [
      {
        id: 'contacts',
        title: 'Контакты',
        description: 'Диспетчерская, аварийная служба, участковый',
        icon: 'contacts',
        route: ROUTES.contacts,
        keywords: 'телефон позвонить 112 скорая полиция',
      },
      {
        id: 'places',
        title: 'Места рядом',
        description: 'Поликлиника, МФЦ, аптека, школа',
        icon: 'places',
        route: ROUTES.places,
        keywords: 'карта адрес',
      },
    ],
  },
];

function normalize(text: string): string {
  return text.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').trim();
}

/** Оставляет сервисы, где встречается каждое слово запроса; пустые группы убирает. */
export function filterServiceGroups(groups: ServiceGroup[], query: string): ServiceGroup[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return groups;

  return groups
    .map((group) => ({
      ...group,
      services: group.services.filter((service) => {
        const haystack = normalize(`${service.title} ${service.description} ${service.keywords ?? ''} ${group.title}`);
        return words.every((word) => haystack.includes(word));
      }),
    }))
    .filter((group) => group.services.length > 0);
}
