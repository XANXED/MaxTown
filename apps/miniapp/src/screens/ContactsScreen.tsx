import type { ReactNode } from 'react';
import { Headset, IdentificationBadge, Phone, Siren } from '@phosphor-icons/react';
import { Typography } from '../components/platform-ui.tsx';
import type { Contact } from '@maxtown/shared';
import {
  ErrorState,
  IconTile,
  InlineEmpty,
  ListGroup,
  ScreenHeading,
  SkeletonRows,
  type IconComponent,
  type TileTone,
} from '../components/ui.tsx';
import { emergencyNumbers, phoneHref, useHouseContacts } from '../data/directory.ts';
import { ROUTES } from '../routes.ts';
import type { Navigate } from './types.ts';

const kindVisuals: Record<Contact['kind'], { icon: IconComponent; tone: TileTone }> = {
  dispatch: { icon: Headset, tone: 'blue' },
  emergency: { icon: Siren, tone: 'coral' },
  police: { icon: IdentificationBadge, tone: 'teal' },
  other: { icon: Phone, tone: 'green' },
};

/** Контакты: службы Дома от Старосты и экстренные номера. Строка целиком — звонок. */
export function ContactsScreen({ navigate }: { navigate: Navigate }) {
  const { status, data: contacts, retry } = useHouseContacts();

  return (
    <main className="screen screen--inner" id="main-content">
      <div className="inner-content stagger">
        <ScreenHeading description="Нажмите на строку, чтобы позвонить">Контакты</ScreenHeading>

        <section className="list-group" aria-labelledby="house-contacts">
          <h2 className="caps-label list-group__title" id="house-contacts">
            Контакты Дома
          </h2>
          {status === 'loading' ? (
            <SkeletonRows count={3} />
          ) : status === 'error' ? (
            <ErrorState onRetry={retry} />
          ) : contacts === null ? (
            <div className="list-card">
              <InlineEmpty
                icon={Headset}
                tone="blue"
                title="Диспетчерская и службы Дома"
                description="Появятся, когда вы станете Жильцом"
                actionLabel="Вступить"
                onAction={() => navigate(ROUTES.join)}
              />
            </div>
          ) : contacts.length === 0 ? (
            <div className="list-card">
              <InlineEmpty
                icon={Headset}
                tone="neutral"
                title="Контактов пока нет"
                description="Их добавляет Староста Дома"
              />
            </div>
          ) : (
            <div className="list-card" role="list">
              {contacts.map((contact) => {
                const { icon, tone } = kindVisuals[contact.kind];
                return <ContactRow contact={contact} leading={<IconTile icon={icon} tone={tone} size="small" />} key={contact.id} />;
              })}
            </div>
          )}
        </section>

        <ListGroup id="emergency-contacts" title="Экстренные службы">
          <div role="list">
            {emergencyNumbers.map((contact) => (
              <ContactRow
                contact={contact}
                key={contact.id}
                numberInTile
                leading={
                  <span className="icon-tile icon-tile--small icon-tile--coral number-tile" aria-hidden>
                    {contact.phone}
                  </span>
                }
              />
            ))}
          </div>
        </ListGroup>

        <Typography.Text asChild variant="description" color="tertiary">
          <p className="services-note">С мобильного 112 работает даже без SIM-карты и без денег на счёте.</p>
        </Typography.Text>
      </div>
    </main>
  );
}

type ContactRowProps = {
  contact: Contact;
  leading: ReactNode;
  /** Номер уже написан на плитке — в подписи не повторяем. */
  numberInTile?: boolean;
};

function ContactRow({ contact, leading, numberInTile = false }: ContactRowProps) {
  if (!contact.phone) return null;
  const details = numberInTile ? contact.description : contact.description ? `${contact.description} · ` : '';
  return (
    <div role="listitem" className="contact-item">
      <a className="list-row list-row--compact list-row--interactive contact-row" href={phoneHref(contact.phone)}>
        {leading}
        <span className="list-row__copy">
          <Typography.Text asChild variant="body-strong">
            <span>{contact.title}</span>
          </Typography.Text>
          {details || !numberInTile ? (
            <Typography.Text asChild variant="description" color="secondary">
              <span>
                {details}
                {numberInTile ? null : <span className="tabular nowrap">{contact.phone}</span>}
              </span>
            </Typography.Text>
          ) : null}
        </span>
        <span className="call-mark" aria-hidden>
          <Phone className="icon icon--small" weight="fill" />
        </span>
        <span className="visually-hidden">, позвонить</span>
      </a>
    </div>
  );
}
