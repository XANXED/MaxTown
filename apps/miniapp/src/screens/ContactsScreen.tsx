import { useState, type ReactNode } from 'react';
import {
  ArrowSquareOut,
  Buildings,
  Elevator,
  Headset,
  IdentificationBadge,
  Key,
  Lightning,
  PencilSimple,
  Phone,
  ShieldCheck,
  Siren,
  Wrench,
} from '@phosphor-icons/react';
import type { Contact, HouseContact, HouseContactImportStatus, HouseRole } from '@maxtown/shared';
import { Button, IconButton, Typography } from '../components/platform-ui.tsx';
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
import { contactsClient, groupHouseContacts, phoneHref, useHouseContacts, type HouseContactGroup } from '../data/contacts.ts';
import { emergencyNumbers } from '../data/directory.ts';
import { demoMode } from '../data/loadable.ts';
import { openExternal } from '../links.ts';
import { contactEditRoute, ROUTES } from '../routes.ts';
import type { Navigate, Notify } from './types.ts';

const kindVisuals: Record<HouseContact['kind'], { icon: IconComponent; tone: TileTone }> = {
  management: { icon: Buildings, tone: 'blue' },
  dispatch: { icon: Headset, tone: 'blue' },
  'house-emergency': { icon: Siren, tone: 'coral' },
  plumber: { icon: Wrench, tone: 'teal' },
  electrician: { icon: Lightning, tone: 'coral' },
  elevator: { icon: Elevator, tone: 'green' },
  intercom: { icon: Key, tone: 'blue' },
  security: { icon: ShieldCheck, tone: 'green' },
  'district-police': { icon: IdentificationBadge, tone: 'teal' },
  other: { icon: Phone, tone: 'neutral' },
};

const importMessages: Partial<Record<HouseContactImportStatus, string>> = {
  'not-found': 'В источнике не найдено однозначного телефона управляющей организации. Контакты можно добавить вручную.',
  ambiguous: 'По адресу найдено несколько организаций. Чтобы не показать чужой номер, автоматический импорт пропущен.',
  failed: 'Источник временно недоступен. Сохранённые контакты продолжают работать.',
  'not-configured': 'Автоматический источник не подключён. Контакты можно вести вручную.',
};

export function ContactsScreen({
  navigate,
  notify,
  houseId,
  role,
}: {
  navigate: Navigate;
  notify: Notify;
  houseId: string | null;
  role: HouseRole | null;
}) {
  const { status, data, retry } = useHouseContacts(houseId);
  const contacts = data?.contacts ?? null;
  const contactGroups = contacts ? groupHouseContacts(contacts) : [];
  const isDemo = demoMode() === 'filled';
  const canEdit = role === 'headman' || isDemo;
  const importMessage = data ? importMessages[data.importState.status] : undefined;

  const refresh = async () => {
    if (!houseId) {
      if (isDemo) notify('Контакты обновлены из источника');
      return;
    }
    try {
      await contactsClient.refresh(houseId);
      notify('Контакты обновлены из источника');
      retry();
    } catch {
      notify('Не удалось обновить контакты. Сохранённые номера не изменились.');
      retry();
    }
  };

  return (
    <main className="screen screen--inner" id="main-content">
      <div className="inner-content stagger">
        <ScreenHeading description="Экстренные номера и нужные службы Дома">Полезные контакты</ScreenHeading>

        <ListGroup id="emergency-contacts" title="Экстренные службы">
          <div role="list">
            {emergencyNumbers.map((contact) => <EmergencyContactRow contact={contact} key={contact.id} />)}
          </div>
        </ListGroup>

        <section className="list-group" aria-labelledby="house-contacts">
          <h2 className="caps-label list-group__title" id="house-contacts">Контакты Дома</h2>
          {canEdit ? (
            <div className="contacts-toolbar" aria-label="Управление полезными контактами">
              <Button size="medium" variant="primary" onClick={() => navigate(ROUTES.newContact)}>Добавить контакт</Button>
              <Button size="medium" variant="secondary" onClick={() => void refresh()}>Обновить из источника</Button>
            </div>
          ) : null}
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
                description={canEdit ? 'Добавьте первый полезный номер для Жильцов' : 'Их добавляет Староста Дома'}
                actionLabel={canEdit ? 'Добавить контакт' : undefined}
                onAction={canEdit ? () => navigate(ROUTES.newContact) : undefined}
              />
            </div>
          ) : (
            <div className="contact-categories">
              {contactGroups.map((group) => (
                <ContactCategory
                  group={group}
                  key={group.kind}
                  onEdit={canEdit ? (contactId) => navigate(contactEditRoute(contactId)) : undefined}
                />
              ))}
            </div>
          )}
          {importMessage ? <p className="contacts-source-note" role={data?.importState.status === 'failed' ? 'alert' : 'status'}>{importMessage}</p> : null}
        </section>

        <Typography.Text asChild variant="description" color="tertiary">
          <p className="services-note">С мобильного 112 работает даже без SIM-карты и без денег на счёте.</p>
        </Typography.Text>
      </div>
    </main>
  );
}

function ContactCategory({ group, onEdit }: { group: HouseContactGroup; onEdit?: (contactId: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = group.contacts.length >= 2;
  const visibleContacts = collapsible && !expanded ? group.contacts.slice(0, 1) : group.contacts;
  const hiddenCount = group.contacts.length - visibleContacts.length;
  const listId = `contact-category-${group.kind}`;

  return (
    <section className="contact-category" aria-labelledby={`${listId}-title`}>
      <h3 className="caps-label contact-category__title" id={`${listId}-title`}>{group.label}</h3>
      <div className="list-card" id={listId} role="list">
        {visibleContacts.map((contact) => {
          const { icon, tone } = kindVisuals[contact.kind];
          return (
            <HouseContactRow
              contact={contact}
              leading={<IconTile icon={icon} tone={tone} size="small" />}
              key={contact.id}
              onEdit={onEdit ? () => onEdit(contact.id) : undefined}
            />
          );
        })}
      </div>
      {collapsible ? (
        <button
          className="contact-group-toggle text-action pressable"
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? 'Свернуть' : `Показать ещё ${hiddenCount}`}
        </button>
      ) : null}
    </section>
  );
}

function HouseContactRow({ contact, leading, onEdit }: { contact: HouseContact; leading: ReactNode; onEdit?: () => void }) {
  return (
    <div role="listitem" className="contact-item list-row list-row--compact contact-row">
      {leading}
      <span className="list-row__copy">
        <Typography.Text asChild variant="body-strong"><span>{contact.title}</span></Typography.Text>
        {contact.description ? <Typography.Text asChild variant="description" color="secondary"><span>{contact.description}</span></Typography.Text> : null}
        {contact.phone ? <Typography.Text asChild variant="description" color="secondary"><span className="tabular">{contact.phone}</span></Typography.Text> : null}
      </span>
      <span className="contact-actions">
        {contact.phone ? (
          <a className="contact-action pressable" href={phoneHref(contact.phone)} aria-label={`Позвонить: ${contact.title}`}>
            <Phone className="icon icon--small" weight="fill" aria-hidden />
          </a>
        ) : null}
        {contact.link ? (
          <IconButton aria-label={`Открыть ссылку: ${contact.title}`} onClick={() => openExternal(contact.link!)}>
            <ArrowSquareOut className="icon icon--small" aria-hidden />
          </IconButton>
        ) : null}
        {onEdit ? (
          <IconButton aria-label={`Изменить: ${contact.title}`} onClick={onEdit}>
            <PencilSimple className="icon icon--small" aria-hidden />
          </IconButton>
        ) : null}
      </span>
    </div>
  );
}

function EmergencyContactRow({ contact }: { contact: Contact }) {
  if (!contact.phone) return null;
  return (
    <div role="listitem" className="contact-item">
      <a className="list-row list-row--compact list-row--interactive contact-row" href={phoneHref(contact.phone)}>
        <span className="icon-tile icon-tile--small icon-tile--coral number-tile" aria-hidden>{contact.phone}</span>
        <span className="list-row__copy">
          <Typography.Text asChild variant="body-strong"><span>{contact.title}</span></Typography.Text>
          {contact.description ? <Typography.Text asChild variant="description" color="secondary"><span>{contact.description}</span></Typography.Text> : null}
        </span>
        <span className="call-mark" aria-hidden><Phone className="icon icon--small" weight="fill" /></span>
        <span className="visually-hidden">, позвонить</span>
      </a>
    </div>
  );
}
