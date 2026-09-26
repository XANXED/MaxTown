import { useState } from 'react';
import { Plus } from '@phosphor-icons/react';
import { Button, IconButton, Typography } from '@maxhub/max-ui';
import { serviceVisuals } from '../components/serviceVisuals.ts';
import {
  BottomNavigation,
  EmptyState,
  ErrorState,
  FilterChips,
  ListCard,
  RequestRow,
  SkeletonRows,
} from '../components/ui.tsx';
import { useHomeData } from '../data/home.ts';
import {
  filterRequests,
  requestFilterLabels,
  requestsSummary,
  type RequestFilter,
} from '../data/requestFilters.ts';
import { requestRoute, ROUTES } from '../routes.ts';
import type { Navigate } from './types.ts';

const filters: RequestFilter[] = ['all', 'active', 'closed'];

/** Вкладка «Заявки»: все Заявки Жильца. Комментарии живут внутри карточки Заявки. */
export function RequestsScreen({ navigate }: { navigate: Navigate }) {
  const { status, requests, retry } = useHomeData();
  const [filter, setFilter] = useState<RequestFilter>('all');
  const visible = filterRequests(requests, filter);

  return (
    <div className="screen screen--home">
      <main className="home-content stagger" id="main-content">
        <header className="home-header">
          <span className="home-header__copy">
            <Typography.Text asChild variant="header">
              <h1>Мои заявки</h1>
            </Typography.Text>
            {requests.length > 0 ? (
              <Typography.Text asChild variant="detail" color="secondary">
                <span>{requestsSummary(requests)}</span>
              </Typography.Text>
            ) : null}
          </span>
          <IconButton
            size="small"
            variant="secondary"
            aria-label="Подать заявку"
            onClick={() => navigate(ROUTES.newRequest)}
          >
            <Plus className="icon" weight="bold" aria-hidden />
          </IconButton>
        </header>

        {status === 'loading' ? (
          <SkeletonRows count={5} />
        ) : status === 'error' ? (
          <ErrorState onRetry={retry} />
        ) : requests.length > 0 ? (
          <>
            <FilterChips
              label="Какие Заявки показать"
              value={filter}
              onChange={setFilter}
              options={filters.map((value) => ({
                value,
                label: requestFilterLabels[value],
                count: filterRequests(requests, value).length,
              }))}
            />
            {visible.length > 0 ? (
              // key перезапускает каскад строк при смене фильтра
              <ListCard label="Заявки" key={filter}>
                {visible.map((request) => (
                  <RequestRow request={request} key={request.id} onOpen={() => navigate(requestRoute(request.id))} />
                ))}
              </ListCard>
            ) : (
              <Typography.Text asChild variant="detail" color="secondary">
                <p className="filter-empty">
                  {filter === 'active' ? 'Активных Заявок нет: всё исправлено.' : 'Закрытых Заявок пока нет.'}
                </p>
              </Typography.Text>
            )}
          </>
        ) : (
          <div className="list-card">
            <EmptyState
              icon={serviceVisuals.requests.icon}
              tone={serviceVisuals.requests.color}
              title="Заявок пока нет"
              description="Здесь будут все ваши Заявки. В каждой можно обсудить неисправность с Ответственным в Комментариях"
              action={
                <Button size="small" variant="primary" onClick={() => navigate(ROUTES.newRequest)}>
                  Подать заявку
                </Button>
              }
            />
          </div>
        )}
      </main>
      <BottomNavigation active={ROUTES.requests} navigate={navigate} />
    </div>
  );
}
