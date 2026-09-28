import { useState } from 'react';
import { Baby, Bank, FirstAidKit, GraduationCap, MapPin, Pill } from '@phosphor-icons/react';
import { Button, Typography } from '../components/platform-ui.tsx';
import type { Place } from '@maxtown/shared';
import {
  EmptyState,
  ErrorState,
  FilterChips,
  IconTile,
  ListCard,
  RowShell,
  ScreenHeading,
  SkeletonRows,
  type IconComponent,
  type TileTone,
} from '../components/ui.tsx';
import { formatDistance, mapLink, placeFilters, usePlaces, type PlaceFilter } from '../data/directory.ts';
import { glueNumberSign, glueRanges } from '../data/text.ts';
import { openExternal } from '../links.ts';
import { ROUTES } from '../routes.ts';
import type { Navigate } from './types.ts';

const categoryVisuals: Record<Place['category'], { icon: IconComponent; tone: TileTone }> = {
  clinic: { icon: FirstAidKit, tone: 'pink' },
  mfc: { icon: Bank, tone: 'blue' },
  pharmacy: { icon: Pill, tone: 'green' },
  school: { icon: GraduationCap, tone: 'coral' },
  kindergarten: { icon: Baby, tone: 'teal' },
  other: { icon: MapPin, tone: 'neutral' },
};

/** Места рядом: ближние сверху, нажатие открывает адрес на карте. */
export function PlacesScreen({ navigate }: { navigate: Navigate }) {
  const { status, data: places, retry } = usePlaces();
  const [filter, setFilter] = useState<PlaceFilter>('all');

  if (status === 'ready' && places === null) {
    return (
      <main className="screen screen--inner inner-content" id="main-content">
        <ScreenHeading>Места рядом</ScreenHeading>
        <div className="list-card">
          <EmptyState
            icon={MapPin}
            tone="coral"
            title="Поликлиника, МФЦ, аптеки и школы рядом"
            description="Покажем, когда вы станете Жильцом: так мы узнаем, где ваш Дом"
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

  const visible = (places ?? []).filter((place) => filter === 'all' || place.category === filter);

  return (
    <main className="screen screen--inner" id="main-content">
      <div className="inner-content stagger">
        <ScreenHeading description="Ближние сверху. Нажмите, чтобы открыть на карте">Места рядом</ScreenHeading>

        {status === 'loading' ? (
          <SkeletonRows count={5} />
        ) : status === 'error' ? (
          <ErrorState onRetry={retry} />
        ) : places && places.length > 0 ? (
          <>
            <FilterChips label="Какие Места показать" value={filter} onChange={setFilter} options={placeFilters(places)} />
            <ListCard label="Места рядом" key={filter}>
              {visible.map((place) => {
                const { icon, tone } = categoryVisuals[place.category];
                return (
                  <RowShell
                    key={place.id}
                    onOpen={() => openExternal(mapLink(place.address))}
                    trailing={<span className="row-distance tabular">{formatDistance(place.distance)}</span>}
                  >
                    <IconTile icon={icon} tone={tone} size="small" />
                    <span className="list-row__copy">
                      <Typography.Text asChild variant="body-strong">
                        <span>{glueNumberSign(place.title)}</span>
                      </Typography.Text>
                      <Typography.Text asChild variant="description" color="secondary">
                        <span>{place.address}</span>
                      </Typography.Text>
                      {place.hours ? (
                        <Typography.Text asChild variant="description" color="tertiary">
                          <span className="tabular">{glueRanges(place.hours)}</span>
                        </Typography.Text>
                      ) : null}
                    </span>
                  </RowShell>
                );
              })}
            </ListCard>
            {/* Места рядом собираются из OpenStreetMap (docs/research, раздел 3): ODbL требует указать авторство. */}
            <Typography.Text asChild variant="description" color="tertiary">
              <p className="services-note">Данные © участники OpenStreetMap</p>
            </Typography.Text>
          </>
        ) : (
          <div className="list-card">
            <EmptyState icon={MapPin} title="Мест пока нет" description="Рядом с Домом не нашлось поликлиник, аптек и школ" />
          </div>
        )}
      </div>
    </main>
  );
}
