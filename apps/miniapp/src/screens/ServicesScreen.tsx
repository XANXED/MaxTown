import { useState } from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { Input, Typography } from '../components/platform-ui.tsx';
import { serviceVisuals } from '../components/serviceVisuals.ts';
import { BottomNavigation, EmptyState, IconTile, ListCard, RowShell } from '../components/ui.tsx';
import { filterServiceGroups, serviceGroups, type Service } from '../data/services.ts';
import { ROUTES } from '../routes.ts';
import type { Navigate, Notify } from './types.ts';

type ServicesScreenProps = {
  navigate: Navigate;
  notify: Notify;
};

export function ServicesScreen({ navigate, notify }: ServicesScreenProps) {
  const [query, setQuery] = useState('');
  const groups = filterServiceGroups(serviceGroups, query);

  const open = (service: Service) => {
    if (service.route) navigate(service.route);
    else notify(`«${service.title}» появится позже`);
  };

  return (
    <div className="screen screen--home">
      <main className="home-content stagger" id="main-content">
        <header className="home-header">
          <span className="home-header__copy">
            <Typography.Text asChild variant="header">
              <h1>Сервисы</h1>
            </Typography.Text>
            <Typography.Text asChild variant="detail" color="secondary">
              <span>Всё, что можно сделать для дома</span>
            </Typography.Text>
          </span>
        </header>

        <Input
          type="search"
          mode="contrast"
          size="medium"
          placeholder="Найти сервис"
          aria-label="Найти сервис"
          value={query}
          withClearButton
          iconBefore={<MagnifyingGlass className="icon icon--small" aria-hidden />}
          onChange={(event) => setQuery(event.target.value)}
        />

        {groups.map((group) => (
          <section className="list-group" aria-labelledby={`services-${group.id}`} key={group.id}>
            <h2 className="caps-label list-group__title" id={`services-${group.id}`}>
              {group.title}
            </h2>
            <ListCard label={group.title}>
              {group.services.map((service) => {
                const { icon, color } = serviceVisuals[service.icon];
                return (
                  <RowShell
                    key={service.id}
                    className="list-row--compact"
                    onOpen={() => open(service)}
                    trailing={service.route ? undefined : <span className="status-badge">Скоро</span>}
                  >
                    <IconTile icon={icon} tone={color} size="small" />
                    <span className="list-row__copy">
                      <Typography.Text asChild variant="body-strong">
                        <span>{service.title}</span>
                      </Typography.Text>
                      <Typography.Text asChild variant="description" color="secondary">
                        <span>{service.description}</span>
                      </Typography.Text>
                    </span>
                  </RowShell>
                );
              })}
            </ListCard>
          </section>
        ))}

        {groups.length === 0 ? (
          <div className="list-card">
            <EmptyState
              icon={MagnifyingGlass}
              title="Ничего не нашлось"
              description="Попробуйте другое слово — например, «заявка» или «показания»"
            />
          </div>
        ) : (
          <Typography.Text asChild variant="description" color="tertiary">
            <p className="services-note">Разделы для Старосты, Ответственных и Консьержей появятся здесь по Роли в Доме.</p>
          </Typography.Text>
        )}
      </main>
      <BottomNavigation active={ROUTES.services} navigate={navigate} />
    </div>
  );
}
