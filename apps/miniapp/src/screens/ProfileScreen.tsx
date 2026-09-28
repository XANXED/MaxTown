import type { ReactNode } from 'react';
import { BellRinging, BookOpen, ChatCircleText, CloudSlash, House, ShieldCheck, User } from '@phosphor-icons/react';
import { Avatar, Typography } from '@maxhub/max-ui';
import {
  BottomNavigation,
  IconTile,
  InlineEmpty,
  ListCard,
  RowShell,
  type IconComponent,
  type TileColor,
} from '../components/ui.tsx';
import { useHouseState } from '../data/houseState.ts';
import { currentProfileUser } from '../maxUser.ts';
import { ROUTES } from '../routes.ts';
import type { Navigate, Notify } from './types.ts';
import { houseRoleLabel, useCurrentHouse } from '../houseSession.ts';

type ProfileScreenProps = {
  navigate: Navigate;
  notify: Notify;
};

export function ProfileScreen({ navigate, notify }: ProfileScreenProps) {
  const access = useCurrentHouse();
  const user = currentProfileUser();
  const platform = window.WebApp?.platform;
  const soon = (title: string) => () => notify(`«${title}» появится позже`);
  const { status: houseStatus, data: house, retry: retryHouse } = useHouseState();

  return (
    <div className="screen screen--home">
      <main className="home-content stagger" id="main-content">
        <header className="home-header">
          <Typography.Text asChild variant="header">
            <h1>Профиль</h1>
          </Typography.Text>
        </header>

        <section className="profile-card" aria-label="Кто вы">
          <Avatar.Container className="profile-card__avatar" size={72} form="circle">
            {user ? (
              <Avatar.Image
                src={user.photoUrl}
                alt=""
                fallback={<Avatar.Text gradient="blue">{user.initials}</Avatar.Text>}
                fallbackGradient="blue"
              />
            ) : (
              <span className="profile-card__avatar-fallback icon-tile--blue">
                <User className="icon icon--large" weight="fill" aria-hidden />
              </span>
            )}
          </Avatar.Container>
          <Typography.Text asChild variant="subheader">
            <h2>{user?.name ?? 'Гость'}</h2>
          </Typography.Text>
          <Typography.Text asChild variant="description" color="secondary">
            <p>
              {user
                ? user.username
                  ? `@${user.username} · вход через MAX`
                  : 'Вход через MAX'
                : 'Откройте MaxTown в MAX — имя и фото подтянутся сами'}
            </p>
          </Typography.Text>
        </section>

        <ProfileGroup id="house" title="Мой дом">
          {houseStatus === 'loading' ? (
            <div className="list-row list-row--skeleton" aria-busy="true" aria-label="Загрузка">
              <span className="skeleton skeleton--tile" />
              <span className="list-row__copy">
                <span className="skeleton skeleton--line" />
                <span className="skeleton skeleton--line skeleton--short" />
              </span>
            </div>
          ) : houseStatus === 'error' ? (
            <InlineEmpty
              icon={CloudSlash}
              tone="neutral"
              title="Не удалось загрузить"
              description="Проверьте интернет и попробуйте ещё раз"
              actionLabel="Повторить"
              onAction={retryHouse}
            />
          ) : house ? (
            <ProfileRow
              icon={House}
              color="green"
              title={house.address}
              description={access ? houseRoleLabel(access) : `Квартира ${house.apartment}. Вы Жилец`}
              onOpen={() => navigate(ROUTES.house)}
            />
          ) : (
            <ProfileRow
              icon={House}
              color="green"
              title="Стать Жильцом"
              description="По Приглашению или Запросом на вступление"
              onOpen={() => navigate(ROUTES.join)}
            />
          )}
        </ProfileGroup>

        <ProfileGroup id="settings" title="Настройки">
          <ProfileRow
            icon={BellRinging}
            color="pink"
            title="Уведомления"
            description="Что изменилось в ваших Заявках и Запросе на вступление"
            onOpen={() => navigate(ROUTES.notifications)}
          />
        </ProfileGroup>

        <ProfileGroup id="help" title="Помощь">
          <ProfileRow
            icon={BookOpen}
            color="blue"
            title="Как пользоваться MaxTown"
            description="Коротко о том, что умеет приложение"
            onOpen={() => navigate(ROUTES.welcome)}
          />
          <ProfileRow
            icon={ChatCircleText}
            color="teal"
            title="Написать в поддержку"
            description="Если что-то работает не так"
            trailing={<span className="status-badge">Скоро</span>}
            onOpen={soon('Поддержка')}
          />
          <ProfileRow
            icon={ShieldCheck}
            color="green"
            title="Политика конфиденциальности"
            description="Какие данные мы храним и зачем"
            trailing={<span className="status-badge">Скоро</span>}
            onOpen={soon('Политика конфиденциальности')}
          />
        </ProfileGroup>

        <Typography.Text asChild variant="description" color="tertiary">
          <p className="services-note">{platform ? `MaxTown · MAX, ${platform}` : 'MaxTown · открыт в браузере'}</p>
        </Typography.Text>
      </main>
      <BottomNavigation active={ROUTES.profile} navigate={navigate} />
    </div>
  );
}

function ProfileGroup({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="list-group" aria-labelledby={`profile-${id}`}>
      <h2 className="caps-label list-group__title" id={`profile-${id}`}>
        {title}
      </h2>
      <ListCard label={title}>{children}</ListCard>
    </section>
  );
}

type ProfileRowProps = {
  icon: IconComponent;
  color: TileColor;
  title: string;
  description: string;
  trailing?: ReactNode;
  onOpen: () => void;
};

function ProfileRow({ icon, color, title, description, trailing, onOpen }: ProfileRowProps) {
  return (
    <RowShell className="list-row--compact" onOpen={onOpen} trailing={trailing}>
      <IconTile icon={icon} tone={color} size="small" />
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
}
