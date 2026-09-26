import { useState } from 'react';
import type { HouseEventKind } from '@maxtown/shared';
import { serviceVisuals } from '../components/serviceVisuals.ts';
import {
  EmptyState,
  ErrorState,
  EventRow,
  FilterChips,
  ListCard,
  ScreenHeading,
  SkeletonRows,
} from '../components/ui.tsx';
import { useHomeData } from '../data/home.ts';
import { plural } from '../data/text.ts';
import { eventRoute } from '../routes.ts';
import type { Navigate } from './types.ts';

type EventFilter = 'all' | HouseEventKind;

const filters: Array<{ value: EventFilter; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'accident', label: 'Аварии' },
  { value: 'planned-outage', label: 'Отключения' },
  { value: 'announcement', label: 'Объявления' },
];

export function HouseEventsScreen({ navigate }: { navigate: Navigate }) {
  const { status, events, retry } = useHomeData();
  const [filter, setFilter] = useState<EventFilter>('all');
  const visible = filter === 'all' ? events : events.filter((event) => event.kind === filter);
  const accidents = events.filter((event) => event.kind === 'accident').length;

  return (
    <main className="screen screen--inner inner-content" id="main-content">
      <ScreenHeading
        description={
          accidents > 0
            ? `Сейчас ${accidents} ${plural(accidents, ['открытая Авария', 'открытые Аварии', 'открытых Аварий'])}`
            : undefined
        }
      >
        События дома
      </ScreenHeading>

      {status === 'loading' ? (
        <SkeletonRows count={4} />
      ) : status === 'error' ? (
        <ErrorState onRetry={retry} />
      ) : events.length > 0 ? (
        <>
          <FilterChips
            label="Какие События показать"
            value={filter}
            onChange={setFilter}
            options={filters
              .map(({ value, label }) => ({
                value,
                label,
                count: value === 'all' ? events.length : events.filter((event) => event.kind === value).length,
              }))
              .filter((option) => option.value === 'all' || option.count > 0)}
          />
          {/* key перезапускает каскад строк при смене фильтра */}
          <ListCard label="События дома" key={filter}>
            {visible.map((event) => (
              <EventRow event={event} key={event.id} onOpen={() => navigate(eventRoute(event.id))} />
            ))}
          </ListCard>
        </>
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
    </main>
  );
}
