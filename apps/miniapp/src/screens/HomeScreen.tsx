import { Bell, Drop, Elevator, Lightning, Thermometer, WifiHigh } from '@phosphor-icons/react';
import { Button, IconButton, Typography } from '@maxhub/max-ui';
import buildingImage from '../assets/home-building.webp';
import { serviceVisuals } from '../components/serviceVisuals.ts';
import {
  BottomNavigation,
  EmptyState,
  EventRow,
  IconTile,
  ListCard,
  RequestRow,
  SectionHeading,
  SkeletonRows,
  type IconComponent,
  type TileColor,
} from '../components/ui.tsx';
import { houseSystems, type HouseSystemName } from '../data/categories.ts';
import type { ServiceIcon } from '../data/services.ts';
import { JOIN_HINT, useHomeData } from '../data/home.ts';
import { ROUTES } from '../routes.ts';
import type { Navigate, Notify } from './types.ts';

/** Сколько последних строк показывать на главной; остальное — на экране по «Все». */
const PREVIEW_LIMIT = 3;

const systemVisuals: Record<HouseSystemName, { icon: IconComponent; color: TileColor }> = {
  Электричество: { icon: Lightning, color: 'coral' },
  Вода: { icon: Drop, color: 'blue' },
  Отопление: { icon: Thermometer, color: 'pink' },
  Лифты: { icon: Elevator, color: 'teal' },
  Интернет: { icon: WifiHigh, color: 'green' },
};

type HomeScreenProps = {
  navigate: Navigate;
  notify: Notify;
};

export function HomeScreen({ navigate, notify }: HomeScreenProps) {
  const { status, requests, events } = useHomeData();
  const join = () => notify(JOIN_HINT);

  const quickActions: Array<{ label: string; service: ServiceIcon; onClick: () => void }> = [
    { label: 'Подать заявку', service: 'new-request', onClick: () => navigate(ROUTES.newRequest) },
    { label: 'Мои заявки', service: 'requests', onClick: () => navigate(ROUTES.requests) },
    { label: 'События дома', service: 'events', onClick: () => navigate(ROUTES.events) },
    { label: 'Передать показания', service: 'readings', onClick: () => notify('Передача Показаний появится позже') },
  ];

  return (
    <div className="screen screen--home">
      <main className="home-content stagger" id="main-content">
        <header className="home-header">
          <span className="home-header__copy">
            <Typography.Text asChild variant="header">
              <h1>Мой дом</h1>
            </Typography.Text>
            <Typography.Text asChild variant="detail" color="secondary">
              <span>Вы ещё не Жилец</span>
            </Typography.Text>
          </span>
          <IconButton
            size="small"
            variant="secondary"
            aria-label="Уведомления"
            onClick={() => notify('Новых Уведомлений нет')}
          >
            <Bell className="icon" aria-hidden />
          </IconButton>
        </header>

        <section className="house-card" aria-labelledby="house-card-title">
          <img className="house-card__image" src={buildingImage} alt="" width="960" height="400" />
          <div className="house-card__copy">
            <span className="caps-label">Состояние дома</span>
            <Typography.Text asChild variant="subheader">
              <h2 id="house-card-title">Станьте Жильцом</h2>
            </Typography.Text>
            <Typography.Text asChild variant="detail" color="secondary">
              <p>Тогда здесь будет видно, работают ли Системы вашего Дома</p>
            </Typography.Text>
          </div>
          <ul className="system-chips" aria-label="Системы дома">
            {houseSystems.map((name) => {
              const { icon: Icon, color } = systemVisuals[name];
              return (
                <li className="system-chip" key={name}>
                  <span className={`system-chip__icon icon-tile--${color}`}>
                    <Icon className="icon icon--small" weight="fill" aria-hidden />
                  </span>
                  {name}
                </li>
              );
            })}
          </ul>
          <Button className="house-card__action" size="small" variant="primary" onClick={join}>
            Стать Жильцом
          </Button>
        </section>

        <nav className="quick-actions" aria-label="Быстрые действия">
          {quickActions.map(({ label, service, onClick }) => (
            <button className="quick-action pressable" type="button" key={label} onClick={onClick}>
              <IconTile icon={serviceVisuals[service].icon} tone={serviceVisuals[service].color} size="medium" />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <section className="home-section" aria-labelledby="requests-title">
          <SectionHeading
            id="requests-title"
            title="Мои заявки"
            actionLabel={requests.length > 0 ? 'Все' : undefined}
            onAction={() => navigate(ROUTES.requests)}
          />
          {status === 'loading' ? (
            <SkeletonRows count={2} />
          ) : requests.length > 0 ? (
            <ListCard label="Последние Заявки">
              {requests.slice(0, PREVIEW_LIMIT).map((request) => (
                <RequestRow request={request} key={request.id} />
              ))}
            </ListCard>
          ) : (
            <div className="list-card">
              <EmptyState
                icon={serviceVisuals.requests.icon}
                tone={serviceVisuals.requests.color}
                title="Заявок пока нет"
                description="Сообщите о неисправности — Ответственный получит Заявку и возьмёт её в работу"
                action={
                  <Button size="small" variant="secondary" onClick={() => navigate(ROUTES.newRequest)}>
                    Подать заявку
                  </Button>
                }
              />
            </div>
          )}
        </section>

        <section className="home-section" aria-labelledby="events-title">
          <SectionHeading
            id="events-title"
            title="События дома"
            actionLabel={events.length > 0 ? 'Все' : undefined}
            onAction={() => navigate(ROUTES.events)}
          />
          {status === 'loading' ? (
            <SkeletonRows count={2} />
          ) : events.length > 0 ? (
            <ListCard label="Последние События дома">
              {events.slice(0, PREVIEW_LIMIT).map((event) => (
                <EventRow event={event} key={event.id} />
              ))}
            </ListCard>
          ) : (
            <div className="list-card">
              <EmptyState
                icon={serviceVisuals.events.icon}
                tone={serviceVisuals.events.color}
                title="Событий пока нет"
                description="Здесь появятся Аварии, Плановые отключения и Объявления для всех Жильцов"
              />
            </div>
          )}
        </section>
      </main>
      <BottomNavigation active={ROUTES.home} navigate={navigate} />
    </div>
  );
}
