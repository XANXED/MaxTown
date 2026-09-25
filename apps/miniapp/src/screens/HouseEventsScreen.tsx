import { serviceVisuals } from '../components/serviceVisuals.ts';
import { EmptyState, EventRow, ListCard, ScreenHeading, SkeletonRows } from '../components/ui.tsx';
import { useHomeData } from '../data/home.ts';
import type { Notify } from './types.ts';

export function HouseEventsScreen({ notify }: { notify: Notify }) {
  const { status, events } = useHomeData();

  return (
    <main className="screen screen--inner inner-content" id="main-content">
      <ScreenHeading>События дома</ScreenHeading>

      {status === 'loading' ? (
        <SkeletonRows count={4} />
      ) : events.length > 0 ? (
        <ListCard label="События дома">
          {events.map((event) => (
            <EventRow event={event} key={event.id} onOpen={() => notify('Подробности События дома появятся позже')} />
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
    </main>
  );
}
