import { useState } from 'react';
import { ArrowSquareOut, MapPin, WifiSlash } from '@phosphor-icons/react';
import type { NearestPlace, NearestPlaceKind } from '@maxtown/shared';
import { useMembership } from '../auth/membership.tsx';
import { PlacesMap } from '../components/PlacesMap.tsx';
import { nearestVisuals } from '../components/placeVisuals.ts';
import { Button, Typography } from '../components/platform-ui.tsx';
import { EmptyState, IconTile, ListCard, RowShell, ScreenHeading, SkeletonRows } from '../components/ui.tsx';
import { formatDistance } from '../data/directory.ts';
import { demoMode } from '../data/loadable.ts';
import { nearestKindLabels, useNearestPlaces, type NearestProblem } from '../data/places.ts';
import { glueNumberSign, glueRanges } from '../data/text.ts';
import { openExternal } from '../links.ts';

/** Правила 2ГИС: каждый показ их данных — со ссылкой на правообладателя. */
const DGIS_LICENSE_URL = 'https://law.2gis.ru/api-rules';

const problems: Record<NearestProblem, { title: string; description: string }> = {
  'not-configured': {
    title: 'Поиск мест не подключён',
    description: 'На сервере не задан ключ 2ГИС. Закреплённые места при этом работают.',
  },
  unavailable: {
    title: '2ГИС сейчас не отвечает',
    description: 'Проверьте интернет и попробуйте ещё раз через минуту.',
  },
  'location-unknown': {
    title: 'Дом не нашёлся на карте',
    description: '2ГИС не узнал адрес Дома. Напишите Администратору Дома: возможно, адрес указан с ошибкой.',
  },
};

/** Ближайшие места одного Вида: живой поиск в 2ГИС вокруг Дома, ничего не хранится. */
export function NearestPlacesScreen({ kind, houseId }: { kind: NearestPlaceKind; houseId: string | null }) {
  const { status, data, problem, retry } = useNearestPlaces(houseId, kind);
  const membership = useMembership();
  const { title, description } = nearestKindLabels[kind];
  const { icon, tone } = nearestVisuals[kind];
  const places = data?.places ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /** Метка на карте выделяет строку и прокручивает к ней. */
  const select = (id: string) => {
    setSelectedId(id);
    document.getElementById(rowId(id))?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  const heading = <ScreenHeading description={description}>{title}</ScreenHeading>;

  if (!houseId && demoMode() !== 'filled') {
    return (
      <main className="screen screen--inner inner-content" id="main-content">
        {heading}
        <div className="list-card">
          <EmptyState icon={MapPin} title="Сначала вступите в Дом" description="Ищем места вокруг вашего Дома — без него искать не от чего" />
        </div>
      </main>
    );
  }

  return (
    <main className="screen screen--inner" id="main-content">
      <div className="inner-content stagger">
        {heading}
        {status === 'loading' ? (
          <SkeletonRows count={3} />
        ) : status === 'error' ? (
          <div className="list-card">
            <EmptyState
              icon={WifiSlash}
              title={problems[problem ?? 'unavailable'].title}
              description={problems[problem ?? 'unavailable'].description}
              action={
                problem === 'unavailable' ? (
                  <Button size="small" variant="secondary" onClick={retry}>
                    Повторить
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : places.length === 0 ? (
          <div className="list-card">
            <EmptyState icon={icon} tone={tone} title="Рядом не нашлось" description={`Поблизости от ${membership?.address ?? 'Дома'} такого места нет в 2ГИС`} />
          </div>
        ) : (
          <>
            <PlacesMap
              label={`${title} на карте рядом с Домом`}
              house={data?.house}
              markers={places.map((place) => ({ id: place.id, point: place.point, label: `${place.title}, ${formatDistance(place.distance)}`, icon, tone }))}
              selectedId={selectedId}
              onSelect={select}
            />
            <ListCard label={title}>
              {places.map((place) => (
                <NearestRow place={place} key={place.id} selected={place.id === selectedId} />
              ))}
            </ListCard>
          </>
        )}
        {status === 'ready' ? (
          <Typography.Text asChild variant="description" color="tertiary">
            <p className="services-note">
              Ближние сверху, расстояние по прямой. Нажмите, чтобы открыть карточку в 2ГИС.{' '}
              <a href={DGIS_LICENSE_URL} target="_blank" rel="noopener noreferrer">
                Работает на API 2ГИС. Лицензионное соглашение
              </a>
            </p>
          </Typography.Text>
        ) : null}
      </div>
    </main>
  );
}

const rowId = (id: string) => `nearest-place-${id}`;

function NearestRow({ place, selected }: { place: NearestPlace; selected: boolean }) {
  const hours = place.open24x7 ? 'Круглосуточно' : place.hoursToday === null ? 'Сегодня не работает' : place.hoursToday ? `Сегодня ${place.hoursToday}` : null;
  return (
    <RowShell
      id={rowId(place.id)}
      className={selected ? 'list-row--selected' : ''}
      onOpen={() => openExternal(place.url)}
      trailing={
        <span className="row-distance tabular">
          {formatDistance(place.distance)}
          <ArrowSquareOut className="icon icon--small icon--mute" aria-label="Открыть в 2ГИС" />
        </span>
      }
    >
      <span className="list-row__copy">
        <Typography.Text asChild variant="body-strong">
          <span>{glueNumberSign(place.title)}</span>
        </Typography.Text>
        {place.address ? (
          <Typography.Text asChild variant="description" color="secondary">
            <span>
              {place.address}
              {place.addressComment ? `, ${place.addressComment}` : ''}
            </span>
          </Typography.Text>
        ) : null}
        {hours ? (
          <Typography.Text asChild variant="description" color={place.hoursToday === null ? 'secondary' : 'tertiary'}>
            <span className="tabular">{glueRanges(hours)}</span>
          </Typography.Text>
        ) : null}
      </span>
    </RowShell>
  );
}
