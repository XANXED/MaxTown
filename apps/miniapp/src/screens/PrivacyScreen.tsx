import { Fingerprint, House, LockKey, Phone, ShieldCheck } from '@phosphor-icons/react';
import { Typography } from '../components/platform-ui.tsx';
import { IconTile, ListCard, RowShell, ScreenHeading } from '../components/ui.tsx';

const sections = [
  {
    icon: Fingerprint,
    tone: 'blue' as const,
    title: 'Вход через MAX',
    text: 'Сервер проверяет подпись MAX и участие в Домовом чате. Имя из клиентского моста само по себе не даёт доступ к данным Дома.',
  },
  {
    icon: House,
    tone: 'green' as const,
    title: 'Данные Дома',
    text: 'Участники одного Дома видят его События, Состояние, общедомовые Заявки, Контакты и каталоги. Данные разных Домов не смешиваются.',
  },
  {
    icon: LockKey,
    tone: 'teal' as const,
    title: 'Личные данные Квартиры',
    text: 'Платежи и Чеки доступны только текущему Домохозяйству. Приборы учёта и Показания сохраняются у физической Квартиры при смене состава. УК и соседи их не видят.',
  },
  {
    icon: Phone,
    tone: 'coral' as const,
    title: 'Телефон',
    text: 'Номер запрашивается у MAX только после вашего явного выбора. Показ соседям можно включить или выключить в Профиле Квартиры.',
  },
];

/** Краткая карта фактических границ доступа — не обещает интеграций или юридических условий, которых ещё нет. */
export function PrivacyScreen() {
  return (
    <main className="screen screen--inner inner-content stagger" id="main-content">
      <ScreenHeading description="Как сведения разделены между человеком, Квартирой и Домом">Данные и приватность</ScreenHeading>

      <ListCard label="Как MaxTown использует данные">
        {sections.map(({ icon, tone, title, text }) => (
          <RowShell key={title} className="list-row--compact">
            <IconTile icon={icon} tone={tone} size="small" />
            <span className="list-row__copy">
              <Typography.Text asChild variant="body-strong"><span>{title}</span></Typography.Text>
              <Typography.Text asChild variant="description" color="secondary"><span>{text}</span></Typography.Text>
            </span>
          </RowShell>
        ))}
      </ListCard>

      <section className="resident-profile-house" aria-labelledby="privacy-control-title">
        <span className="meter__head">
          <IconTile icon={ShieldCheck} tone="green" size="small" />
          <Typography.Text asChild variant="body-strong"><h2 id="privacy-control-title">Что вы контролируете</h2></Typography.Text>
        </span>
        <Typography.Text asChild variant="description" color="secondary">
          <p>В Профиле Квартиры можно исправить этаж и подъезд, управлять Приглашениями, сведениями о соседних Квартирах и доступностью подтверждённого телефона. Номер Квартиры доступен только для чтения.</p>
        </Typography.Text>
      </section>

      <Typography.Text asChild variant="description" color="tertiary">
        <p className="utility-note">Этот экран описывает текущее поведение MaxTown. Он не заменяет юридические условия оператора сервиса.</p>
      </Typography.Text>
    </main>
  );
}
