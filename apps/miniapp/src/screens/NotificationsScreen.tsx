import { useState } from 'react';
import { BellSimple, CalendarCheck, CaretRight, ChatCircleText, FilePlus, FileText, Hammer, House, HouseLine, Receipt, Warning } from '@phosphor-icons/react';
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
import { eventRoute, repairRoute, requestRoute, ROUTES, utilityPaymentRoute, type AppRoute } from '../routes.ts';
import type { Navigate } from './types.ts';

const kindVisuals: Record<UserNotification['kind'], { icon: IconComponent; tone: TileTone }> = {
  'request-new': { icon: FilePlus, tone: 'teal' },
  'request-status': { icon: FileText, tone: 'teal' },
  accident: { icon: Warning, tone: 'danger' },
  'request-comment': { icon: ChatCircleText, tone: 'blue' },
  'request-visit': { icon: CalendarCheck, tone: 'coral' },
  'join-approved': { icon: House, tone: 'green' },
  'join-declined': { icon: HouseLine, tone: 'neutral' },
  'community-poll': { icon: ChatCircleText, tone: 'blue' },
  'apartment-repair': { icon: Hammer, tone: 'coral' },
  'management-question': { icon: ChatCircleText, tone: 'blue' },
  'management-answer': { icon: ChatCircleText, tone: 'blue' },
  'utility-payment': { icon: Receipt, tone: 'blue' },
};

/** Непрочитанные изменения в Заявках и Запросах на вступление. */
export function NotificationsScreen({ navigate, openCommunityPoll, openApartmentRepair, openManagementQuestion, openHouseRoute }: {
  navigate: Navigate;
  openCommunityPoll?: (houseId: string, pollId: string) => void;
  openApartmentRepair?: (houseId: string, repairId: string) => void;
  openManagementQuestion?: (houseId: string, questionId: string) => void;
  /** Экран Дома из Уведомления: переключает Дом, если Уведомление из другого. */
  openHouseRoute?: (houseId: string, route: AppRoute) => void;
}) {
  const { status, data, retry } = useNotifications();
  // Успешные отметки сохраняем локально, чтобы сразу убрать уведомление из ленты.
  const [changed, setChanged] = useState<UserNotification[] | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const items = (changed ?? data).filter((item) => !item.read);
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
    if (item.kind === 'apartment-repair' && item.houseId && item.repairId) {
      if (openApartmentRepair) openApartmentRepair(item.houseId, item.repairId);
      else navigate(repairRoute(item.repairId));
      return;
    }
    if ((item.kind === 'management-question' || item.kind === 'management-answer') && item.houseId && item.managementQuestionId) {
      openManagementQuestion?.(item.houseId, item.managementQuestionId);
      return;
    }
    if (item.kind === 'utility-payment' && item.houseId && item.utilityPaymentPeriodId) {
      const target = utilityPaymentRoute(item.utilityPaymentPeriodId);
      if (openHouseRoute) openHouseRoute(item.houseId, target);
      else navigate(target);
      return;
    }
    const target = item.requestId ? requestRoute(item.requestId) : item.eventId ? eventRoute(item.eventId) : ROUTES.house;
    if (item.houseId && openHouseRoute) openHouseRoute(item.houseId, target);
    else navigate(target);
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
