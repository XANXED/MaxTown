import { CalendarBlank, CaretRight, CheckCircle, House, Warning, WarningCircle } from '@phosphor-icons/react';
import { Button, Typography } from '../components/platform-ui.tsx';
import type { HouseSystemState } from '@maxtown/shared';
import { categoryVisual } from '../components/categoryVisuals.ts';
import {
  EmptyState,
  ErrorState,
  IconTile,
  ListCard,
  RowShell,
  ScreenHeading,
  SkeletonRows,
  type IconComponent,
  type TileTone,
} from '../components/ui.tsx';
import { houseSummary, systemStatusLine, useHouseState, type HouseSummary } from '../data/houseState.ts';
import { formatUpdatedAt } from '../data/labels.ts';
import { eventRoute, ROUTES } from '../routes.ts';
import { useMembership } from '../auth/membership.tsx';
import type { Navigate } from './types.ts';

const summaryVisuals: Record<HouseSummary['tone'], { icon: IconComponent; tone: TileTone }> = {
  positive: { icon: CheckCircle, tone: 'green' },
  negative: { icon: Warning, tone: 'danger' },
  attention: { icon: CalendarBlank, tone: 'coral' },
};

/** Значок статуса справа в строке Системы: видно с одного взгляда, что сломано. */
const statusIcons: Record<HouseSystemState['status'], IconComponent> = {
  working: CheckCircle,
  accident: WarningCircle,
  'planned-outage': CalendarBlank,
};

/** Состояние дома: работает ли каждая Система прямо сейчас. */
export function HouseStateScreen({ navigate }: { navigate: Navigate }) {
  const { status, data: house, retry } = useHouseState();
  const membership = useMembership();

  if (status === 'loading') {
    return (
      <main className="screen screen--inner inner-content" id="main-content" aria-busy="true">
        <ScreenHeading>Состояние дома</ScreenHeading>
        <SkeletonRows count={5} />
      </main>
    );
  }

  if (status === 'error') {
    return (
      <main className="screen screen--inner inner-content" id="main-content">
        <ScreenHeading>Состояние дома</ScreenHeading>
        <ErrorState onRetry={retry} />
      </main>
    );
  }

  if (!house && membership) {
    return (
      <main className="screen screen--inner inner-content" id="main-content">
        <ScreenHeading description={membership.address}>Состояние дома</ScreenHeading>
        <div className="list-card">
          <EmptyState
            icon={House}
            tone="green"
            title="Сводка пока не подключена"
            description="Здесь будет видно, работают ли электричество, вода, отопление, лифты и интернет"
          />
        </div>
      </main>
    );
  }

  if (!house) {
    return (
      <main className="screen screen--inner inner-content" id="main-content">
        <ScreenHeading>Состояние дома</ScreenHeading>
        <div className="list-card">
          <EmptyState
            icon={House}
            tone="green"
            title="Станьте Жильцом"
            description="Состояние дома видно Жильцам: так мы знаем, какой Дом ваш"
            action={
              <Button size="small" variant="primary" onClick={() => navigate(ROUTES.join)}>
                Стать Жильцом
              </Button>
            }
          />
        </div>
      </main>
    );
  }

  const summary = houseSummary(house.systems);
  const visual = summaryVisuals[summary.tone];

  return (
    <main className="screen screen--inner" id="main-content">
      <div className="inner-content stagger">
        <ScreenHeading
          description={
            <>
              {house.address}
              {house.updatedAt ? <>. Обновлено{' '}<time dateTime={house.updatedAt}>{formatUpdatedAt(house.updatedAt).toLocaleLowerCase('ru-RU')}</time></> : null}
            </>
          }
        >
          Состояние дома
        </ScreenHeading>

        <section className={`house-summary house-summary--${summary.tone}`} aria-live="polite">
          <IconTile icon={visual.icon} tone={visual.tone} size="medium" />
          <span className="house-summary__copy">
            <Typography.Text asChild variant="title">
              <h2>{summary.title}</h2>
            </Typography.Text>
            <Typography.Text asChild variant="description" color="secondary">
              <p>{summary.description}</p>
            </Typography.Text>
          </span>
        </section>

        <ListCard label="Системы Дома">
          {house.systems.map((system) => {
            const { icon, tone } = categoryVisual(system.name);
            const eventId = system.eventId ?? system.nextOutage?.eventId;
            const StatusIcon = statusIcons[system.status];
            return (
              <RowShell
                key={system.name}
                className="list-row--compact"
                onOpen={eventId ? () => navigate(eventRoute(eventId)) : undefined}
                trailing={
                  <span className="system-row__trail">
                    <StatusIcon className={`icon system-row__status system-row__status--${system.status}`} weight="fill" aria-hidden />
                    <CaretRight className="icon icon--small icon--mute" aria-hidden />
                  </span>
                }
              >
                <IconTile icon={icon} tone={tone} size="small" />
                <span className="list-row__copy">
                  <Typography.Text asChild variant="body-strong">
                    <span>{system.name}</span>
                  </Typography.Text>
                  <Typography.Text asChild variant="description" color="secondary">
                    <span className={`system-row__line system-row__line--${system.status}`}>{systemStatusLine(system)}</span>
                  </Typography.Text>
                </span>
                {eventId ? null : (
                  <StatusIcon className={`icon system-row__status system-row__status--${system.status}`} weight="fill" aria-hidden />
                )}
              </RowShell>
            );
          })}
        </ListCard>

        <div className="house-hint">
          <Typography.Text asChild variant="description" color="secondary">
            <p>
              Что-то сломалось, а здесь всё работает? Подайте Заявку. Когда таких Заявок станет несколько, Авария
              откроется сама.
            </p>
          </Typography.Text>
          <button className="text-action pressable" type="button" onClick={() => navigate(ROUTES.newRequest)}>
            Подать заявку
          </button>
        </div>
      </div>
    </main>
  );
}
