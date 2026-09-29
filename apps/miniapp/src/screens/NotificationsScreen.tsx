import { useState } from 'react';
import { BellSimple, CalendarCheck, CaretRight, ChatCircleText, FileText, House, HouseLine } from '@phosphor-icons/react';
import { Typography } from '../components/platform-ui.tsx';
import type { UserNotification } from '@maxtown/shared';
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
import { formatUpdatedAt } from '../data/labels.ts';
import { groupByDay, markAllNotificationsRead, markAllRead, markNotificationRead, markRead, unreadCount, useNotifications } from '../data/notifications.ts';
import { glueNumberSign, plural } from '../data/text.ts';
import { requestRoute, ROUTES } from '../routes.ts';
import type { Navigate } from './types.ts';

const kindVisuals: Record<UserNotification['kind'], { icon: IconComponent; tone: TileTone }> = {
  'request-status': { icon: FileText, tone: 'teal' },
  'request-comment': { icon: ChatCircleText, tone: 'blue' },
  'request-visit': { icon: CalendarCheck, tone: 'coral' },
  'join-approved': { icon: House, tone: 'green' },
  'join-declined': { icon: HouseLine, tone: 'neutral' },
  'community-poll': { icon: ChatCircleText, tone: 'blue' },
};

/** Уведомления: что изменилось в Заявках и в Запросе на вступление. Новые — жирнее и с отметкой. */
export function NotificationsScreen({ navigate, openCommunityPoll }: { navigate: Navigate; openCommunityPoll?: (houseId: string, pollId: string) => void }) {
  const { status, data, retry } = useNotifications();
  // Прочитанность живёт на экране; с API отметка уйдёт на сервер.
  const [changed, setChanged] = useState<UserNotification[] | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const items = changed ?? data;
  const unread = unreadCount(items);

  const open = (item: UserNotification) => {
    setReadError(null);
    void markNotificationRead(item.id)
      .then(() => setChanged((current) => markRead(current ?? data, item.id)))
      .catch(() => setReadError('Не удалось отметить уведомление. Попробуйте ещё раз.'));
    if (item.kind === 'community-poll' && item.houseId && item.pollId) {
      openCommunityPoll?.(item.houseId, item.pollId);
      return;
    }
    navigate(item.requestId ? requestRoute(item.requestId) : ROUTES.house);
  };

  return (
    <main className="screen screen--inner" id="main-content">
      <div className="inner-content stagger">
        <div className="heading-row">
          <ScreenHeading
            description={
              status === 'ready' && items.length > 0
                ? unread > 0
                  ? `${unread} ${plural(unread, ['новое', 'новых', 'новых'])}`
                  : 'Всё прочитано'
                : undefined
            }
          >
            Уведомления
          </ScreenHeading>
          {unread > 0 ? (
            <button className="text-action pressable" type="button" disabled={markingAll} onClick={() => {
              setReadError(null);
              setMarkingAll(true);
              void markAllNotificationsRead()
                .then(() => setChanged((current) => markAllRead(current ?? data)))
                .catch(() => setReadError('Не удалось отметить уведомления. Попробуйте ещё раз.'))
                .finally(() => setMarkingAll(false));
            }}>
              Прочитать все
            </button>
          ) : null}
        </div>
        {readError ? <p className="field-error" role="alert">{readError}</p> : null}

        {status === 'loading' ? (
          <SkeletonRows count={4} />
        ) : status === 'error' ? (
          <ErrorState onRetry={retry} />
        ) : items.length === 0 ? (
          <div className="list-card">
            <EmptyState
              icon={BellSimple}
              tone="pink"
              title="Уведомлений пока нет"
              description="Здесь появятся новости чата и изменения в ваших Заявках"
            />
          </div>
        ) : (
          groupByDay(items, new Date()).map((group) => (
            <section className="list-group" aria-labelledby={`notifications-${group.title}`} key={group.title}>
              <h2 className="caps-label list-group__title" id={`notifications-${group.title}`}>
                {group.title}
              </h2>
              <ListCard label={group.title}>
                {group.items.map((item) => {
                  const { icon, tone } = kindVisuals[item.kind];
                  return (
                    <RowShell
                      key={item.id}
                      className={`notification-row${item.read ? '' : ' notification-row--unread'}`}
                      onOpen={() => open(item)}
                      trailing={
                        item.read ? (
                          <CaretRight className="icon icon--small icon--mute" aria-hidden />
                        ) : (
                          <span className="unread-mark" role="img" aria-label="Новое" />
                        )
                      }
                    >
                      <IconTile icon={icon} tone={tone} size="small" />
                      <span className="list-row__copy">
                        <Typography.Text asChild variant={item.read ? 'body' : 'body-strong'}>
                          <span>{glueNumberSign(item.title)}</span>
                        </Typography.Text>
                        {item.text ? (
                          <Typography.Text asChild variant="description" color="secondary">
                            <span className="clamp-2">{glueNumberSign(item.text)}</span>
                          </Typography.Text>
                        ) : null}
                        <Typography.Text asChild variant="description" color="tertiary">
                          <time dateTime={item.at}>{formatUpdatedAt(item.at)}</time>
                        </Typography.Text>
                      </span>
                    </RowShell>
                  );
                })}
              </ListCard>
            </section>
          ))
        )}
      </div>
    </main>
  );
}
