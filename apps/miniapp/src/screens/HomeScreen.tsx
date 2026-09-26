import { Bell, CaretRight } from '@phosphor-icons/react';
import { Button, Counter, IconButton, Typography } from '@maxhub/max-ui';
import buildingImage from '../assets/home-building.webp';
import { systemVisuals } from '../components/categoryVisuals.ts';
import { serviceVisuals } from '../components/serviceVisuals.ts';
import {
  BottomNavigation,
  EventRow,
  IconTile,
  InlineEmpty,
  InlineError,
  ListCard,
  MiniTile,
  RequestRow,
  SectionHeading,
  SkeletonRows,
} from '../components/ui.tsx';
import { houseSystems } from '../data/categories.ts';
import { useHomeData } from '../data/home.ts';
import { brokenFirst, houseSummary, useHouseState } from '../data/houseState.ts';
import { unreadCount, useNotifications } from '../data/notifications.ts';
import type { ServiceIcon } from '../data/services.ts';
import { greeting } from '../data/text.ts';
import { currentProfileUser } from '../maxUser.ts';
import { eventRoute, requestRoute, ROUTES } from '../routes.ts';
import type { Navigate } from './types.ts';

/** Сколько последних строк показывать на главной; остальное — на экране по «Все». */
const PREVIEW_LIMIT = 3;

type HomeScreenProps = {
  navigate: Navigate;
};

type QuickAction = {
  label: string;
  service: ServiceIcon;
  /** Сервис ещё не готов: плитка помечена «скоро», нажатие только объясняет. */
  soon?: boolean;
  onClick: () => void;
};

export function HomeScreen({ navigate }: HomeScreenProps) {
  const { status, isResident, requests, events, retry } = useHomeData();
  const firstName = currentProfileUser()?.name.split(' ')[0];
  const unread = unreadCount(useNotifications().data);

  const quickActions: QuickAction[] = [
    { label: 'Подать заявку', service: 'new-request', onClick: () => navigate(ROUTES.newRequest) },
    { label: 'Мои заявки', service: 'requests', onClick: () => navigate(ROUTES.requests) },
    { label: 'События дома', service: 'events', onClick: () => navigate(ROUTES.events) },
    { label: 'Передать показания', service: 'readings', onClick: () => navigate(ROUTES.readings) },
  ];

  return (
    <div className="screen screen--home">
      <main className="home-content stagger" id="main-content">
        <header className="home-header">
          <span className="home-header__copy">
            <Typography.Text asChild variant="detail" color="secondary">
              <span>{greeting(new Date(), firstName)}</span>
            </Typography.Text>
            <Typography.Text asChild variant="header">
              <h1>Мой дом</h1>
            </Typography.Text>
          </span>
          <span className="bell">
            <IconButton
              size="small"
              variant="secondary"
              aria-label={unread > 0 ? `Уведомления, новых: ${unread}` : 'Уведомления'}
              onClick={() => navigate(ROUTES.notifications)}
            >
              <Bell className="icon" aria-hidden />
            </IconButton>
            {unread > 0 ? (
              <Counter className="bell__counter" value={unread} variant="primary" rounded aria-hidden />
            ) : null}
          </span>
        </header>

        {/* Пока не знаем, Жилец ли человек, — скелетон, а не мигание чужой карточки.
            При ошибке карточку не показываем: ниже уже есть «Повторить». */}
        {status === 'loading' ? (
          <SkeletonRows count={1} />
        ) : status === 'error' ? null : isResident ? (
          <HouseCard navigate={navigate} />
        ) : (
          <JoinCard navigate={navigate} />
        )}

        <nav className="quick-actions" aria-label="Быстрые действия">
          {quickActions.map(({ label, service, soon, onClick }) => (
            <button className="quick-action pressable" type="button" key={label} onClick={onClick}>
              <span className="quick-action__tile">
                <IconTile icon={serviceVisuals[service].icon} tone={serviceVisuals[service].color} size="medium" />
                {soon ? <span className="quick-action__soon">скоро</span> : null}
              </span>
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
          ) : status === 'error' ? (
            <InlineError onRetry={retry} />
          ) : requests.length > 0 ? (
            <ListCard label="Последние Заявки">
              {requests.slice(0, PREVIEW_LIMIT).map((request) => (
                <RequestRow request={request} key={request.id} onOpen={() => navigate(requestRoute(request.id))} />
              ))}
            </ListCard>
          ) : (
            <div className="list-card">
              <InlineEmpty
                icon={serviceVisuals.requests.icon}
                tone={serviceVisuals.requests.color}
                title="Заявок пока нет"
                description="Что-то сломалось? Ответственный возьмёт Заявку в работу"
                actionLabel="Подать"
                onAction={() => navigate(ROUTES.newRequest)}
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
          ) : status === 'error' ? (
            <InlineError onRetry={retry} />
          ) : events.length > 0 ? (
            <ListCard label="Последние События дома">
              {events.slice(0, PREVIEW_LIMIT).map((event) => (
                <EventRow event={event} key={event.id} onOpen={() => navigate(eventRoute(event.id))} />
              ))}
            </ListCard>
          ) : (
            <div className="list-card">
              <InlineEmpty
                icon={serviceVisuals.events.icon}
                tone={serviceVisuals.events.color}
                title="Событий пока нет"
                description="Аварии, Плановые отключения и Объявления появятся здесь"
              />
            </div>
          )}
        </section>
      </main>
      <BottomNavigation active={ROUTES.home} navigate={navigate} />
    </div>
  );
}

/** Гость: чем станет эта карточка, когда он вступит в Дом. */
function JoinCard({ navigate }: { navigate: Navigate }) {
  return (
    <section className="join-card" aria-labelledby="join-card-title">
      <div className="join-card__media">
        <img className="join-card__image" src={buildingImage} alt="" width="960" height="400" />
      </div>
      <div className="join-card__body">
        <span className="caps-label">Состояние дома</span>
        <Typography.Text asChild variant="subheader">
          <h2 id="join-card-title">Станьте Жильцом</h2>
        </Typography.Text>
        <Typography.Text asChild variant="detail" color="secondary">
          <p>И здесь будет видно, работает ли каждая Система вашего Дома прямо сейчас.</p>
        </Typography.Text>
        <ul className="system-chips" aria-label="Системы дома">
          {houseSystems.map((name) => (
            <li className="system-chip" key={name}>
              <MiniTile icon={systemVisuals[name].icon} tone={systemVisuals[name].tone} />
              {name}
            </li>
          ))}
        </ul>
        <div className="join-card__actions">
          <Button size="small" variant="primary" onClick={() => navigate(ROUTES.join)}>
            Стать Жильцом
          </Button>
          <button className="text-action pressable" type="button" onClick={() => navigate(ROUTES.welcome)}>
            Как это работает
          </button>
        </div>
      </div>
    </section>
  );
}

/** Жилец: Состояние дома одной фразой и Системы чипами; нажатие ведёт в подробности. */
function HouseCard({ navigate }: { navigate: Navigate }) {
  const { status, data: house } = useHouseState();

  if (status === 'loading') return <SkeletonRows count={1} />;
  if (!house) return null;

  const summary = houseSummary(house.systems);
  return (
    <section className="join-card" aria-labelledby="house-card-title">
      <div className="join-card__body">
        <button className="house-card__open pressable" type="button" onClick={() => navigate(ROUTES.house)}>
          <span className="house-card__copy">
            <span className="caps-label">Состояние дома</span>
            <Typography.Text asChild variant="subheader">
              <h2 id="house-card-title" className={`house-card__title--${summary.tone}`}>
                {summary.title}
              </h2>
            </Typography.Text>
            <Typography.Text asChild variant="detail" color="secondary">
              <span>{summary.description}</span>
            </Typography.Text>
          </span>
          <CaretRight className="icon icon--small icon--mute" aria-hidden />
        </button>
        <ul className="system-chips" aria-label="Системы дома">
          {brokenFirst(house.systems).map((system) => {
            const visual = systemVisuals[system.name as keyof typeof systemVisuals];
            const broken = system.status !== 'working';
            return (
              <li className={`system-chip system-chip--${system.status}`} key={system.name}>
                {visual ? <MiniTile icon={visual.icon} tone={broken && system.status === 'accident' ? 'danger' : visual.tone} /> : null}
                {system.name}
                {broken ? <span className="visually-hidden">: не работает</span> : null}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
