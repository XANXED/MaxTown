import { MapPin, Stethoscope } from '@phosphor-icons/react';
import type { AssignedPlace, HouseRole } from '@maxtown/shared';
import { canManageHouse, useMembership } from '../auth/membership.tsx';
import { PlacesMap } from '../components/PlacesMap.tsx';
import { assignedVisuals, nearestVisuals } from '../components/placeVisuals.ts';
import { Button, Typography } from '../components/platform-ui.tsx';
import {
  EmptyState,
  ErrorState,
  IconTile,
  ListCard,
  ListGroup,
  RowShell,
  ScreenHeading,
  SkeletonRows,
} from '../components/ui.tsx';
import { demoMode } from '../data/loadable.ts';
import { addressLink, assignedKindLabels, nearestGroups, nearestKindLabels, useAssignedPlaces, useHouseLocation } from '../data/places.ts';
import { glueNumberSign, glueRanges } from '../data/text.ts';
import { openExternal } from '../links.ts';
import { nearestPlacesRoute, placeEditRoute, ROUTES } from '../routes.ts';
import type { Navigate } from './types.ts';

type PlacesScreenProps = {
  navigate: Navigate;
  houseId: string | null;
  role: HouseRole | null;
};

/**
 * Места рядом (CONTEXT.md): сверху Закреплённые места — «ваши» по адресу Дома,
 * ниже Ближайшие места, которые ищутся в 2ГИС при открытии Вида.
 */
export function PlacesScreen({ navigate, houseId, role }: PlacesScreenProps) {
  const membership = useMembership();
  const isDemo = demoMode() === 'filled';
  const inHouse = Boolean(houseId) || isDemo;
  const canEdit = canManageHouse(role) || isDemo;

  if (!inHouse) {
    return (
      <main className="screen screen--inner inner-content" id="main-content">
        <ScreenHeading>Места рядом</ScreenHeading>
        <div className="list-card">
          <EmptyState
            icon={MapPin}
            tone="coral"
            title="Ваша поликлиника, школа и ближайший травмпункт"
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

  return (
    <main className="screen screen--inner" id="main-content">
      <div className="inner-content stagger">
        <ScreenHeading description={membership?.address ?? 'То, что нужно редко, но срочно'}>Места рядом</ScreenHeading>
        <AssignedSection houseId={houseId} locality={membership?.locality} canEdit={canEdit} navigate={navigate} />
        {nearestGroups.map((group) => (
          <ListGroup id={`nearest-${group.id}`} title={group.title} key={group.id}>
            <div role="list">
              {group.kinds.map((kind) => {
                const { icon, tone } = nearestVisuals[kind];
                const { title, description } = nearestKindLabels[kind];
                return (
                  <RowShell key={kind} onOpen={() => navigate(nearestPlacesRoute(kind))}>
                    <IconTile icon={icon} tone={tone} size="small" />
                    <span className="list-row__copy">
                      <Typography.Text asChild variant="body-strong">
                        <span>{title}</span>
                      </Typography.Text>
                      <Typography.Text asChild variant="description" color="secondary">
                        <span>{description}</span>
                      </Typography.Text>
                    </span>
                  </RowShell>
                );
              })}
            </div>
          </ListGroup>
        ))}
        <Typography.Text asChild variant="description" color="tertiary">
          <p className="services-note">Ближайшие места ищем в 2ГИС, когда вы открываете раздел.</p>
        </Typography.Text>
      </div>
    </main>
  );
}

type AssignedSectionProps = {
  houseId: string | null;
  locality: string | undefined;
  canEdit: boolean;
  navigate: Navigate;
};

function AssignedSection({ houseId, locality, canEdit, navigate }: AssignedSectionProps) {
  const { status, data: places, retry } = useAssignedPlaces(houseId);
  const house = useHouseLocation(houseId);
  const open = (place: AssignedPlace) => (canEdit ? navigate(placeEditRoute(place.id)) : openExternal(addressLink(locality, place.address)));
  const onMap = (places ?? []).filter((place) => place.point);

  return (
    <section className="list-group" aria-labelledby="assigned-places">
      <h2 className="caps-label list-group__title" id="assigned-places">
        Закреплены за Домом
      </h2>
      {canEdit ? (
        <div className="contacts-toolbar" aria-label="Управление Закреплёнными местами">
          <Button size="medium" variant="secondary" onClick={() => navigate(ROUTES.newPlace)}>
            Добавить место
          </Button>
        </div>
      ) : null}
      {status === 'loading' ? (
        <SkeletonRows count={3} />
      ) : status === 'error' ? (
        <ErrorState onRetry={retry} />
      ) : !places || places.length === 0 ? (
        <div className="list-card">
          <EmptyState
            icon={Stethoscope}
            tone="pink"
            title="Поликлиника по прикреплению, школа, участок"
            description={
              canEdit
                ? 'Добавьте места, за которыми закреплён Дом: поликлинику, школу, избирательный участок, участковый пункт'
                : 'Их добавляет Администратор Дома'
            }
          />
        </div>
      ) : (
        <>
          <PlacesMap
            label="Дом и Закреплённые места на карте"
            house={house}
            markers={onMap.map((place) => ({
              id: place.id,
              point: place.point!,
              label: `${assignedKindLabels[place.kind]}: ${place.title}`,
              ...assignedVisuals[place.kind],
            }))}
            onSelect={(id) => {
              const place = onMap.find((item) => item.id === id);
              if (place) open(place);
            }}
          />
          <ListCard label="Закреплённые места">
            {places.map((place) => (
              <AssignedRow place={place} key={place.id} onOpen={() => open(place)} />
            ))}
          </ListCard>
        </>
      )}
    </section>
  );
}

function AssignedRow({ place, onOpen }: { place: AssignedPlace; onOpen: () => void }) {
  const { icon, tone } = assignedVisuals[place.kind];
  return (
    <RowShell onOpen={onOpen}>
      <IconTile icon={icon} tone={tone} size="small" />
      <span className="list-row__copy">
        <Typography.Text asChild variant="description" color="tertiary">
          <span>{assignedKindLabels[place.kind]}</span>
        </Typography.Text>
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
        {place.note ? (
          <Typography.Text asChild variant="description" color="tertiary">
            <span>{place.note}</span>
          </Typography.Text>
        ) : null}
      </span>
    </RowShell>
  );
}
