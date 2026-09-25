import { Plus } from '@phosphor-icons/react';
import { Button, IconButton, Typography } from '@maxhub/max-ui';
import { serviceVisuals } from '../components/serviceVisuals.ts';
import { BottomNavigation, EmptyState, ListCard, RequestRow, SkeletonRows } from '../components/ui.tsx';
import { useHomeData } from '../data/home.ts';
import { ROUTES } from '../routes.ts';
import type { Navigate, Notify } from './types.ts';

/** Вкладка «Заявки»: все Заявки Жильца. Комментарии живут внутри карточки Заявки. */
export function RequestsScreen({ navigate, notify }: { navigate: Navigate; notify: Notify }) {
  const { status, requests } = useHomeData();

  return (
    <div className="screen screen--home">
      <main className="home-content stagger" id="main-content">
        <header className="home-header">
          <span className="home-header__copy">
            <Typography.Text asChild variant="header">
              <h1>Мои заявки</h1>
            </Typography.Text>
            <Typography.Text asChild variant="detail" color="secondary">
              <span>Статусы, Визиты и Комментарии</span>
            </Typography.Text>
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
        ) : requests.length > 0 ? (
          <ListCard label="Заявки">
            {requests.map((request) => (
              <RequestRow
                request={request}
                key={request.id}
                onOpen={() => notify(`Карточка Заявки № ${request.number} появится позже`)}
              />
            ))}
          </ListCard>
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
