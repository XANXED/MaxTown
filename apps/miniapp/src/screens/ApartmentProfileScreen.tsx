import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { House, LinkSimple, ShieldCheck, UserPlus, WarningCircle } from '@phosphor-icons/react';
import type { ApartmentAccessState, ApartmentInfoAccessGrant, HouseMembershipSummary, MeResponse } from '@maxtown/shared';
import { Button, Input, Spinner, Typography } from '../components/platform-ui.tsx';
import { ErrorState, IconTile, ScreenHeading } from '../components/ui.tsx';
import {
  cancelApartmentRequest,
  createApartmentInvite,
  decideApartmentRequest,
  loadApartmentAccess,
  saveApartmentAccess,
} from '../data/apartmentAccess.ts';
import {
  createApartmentInfoInvite,
  loadApartmentInfoGrants,
  revokeApartmentInfoGrant,
  revokeApartmentInfoInvite,
} from '../data/apartmentInfoAccess.ts';
import { ResidentProfileSetupScreen } from './ResidentProfileSetupScreen.tsx';
import type { Notify } from './types.ts';

type Props = {
  membership: HouseMembershipSummary;
  phoneVerified: boolean;
  notify: Notify;
  onMembershipRefresh: () => Promise<void>;
  onProfileComplete: (profile: MeResponse) => void;
};

const privacyCopy = 'Новый участник увидит платежи и Чеки текущего Домохозяйства, а также всю техническую историю Приборов и Показаний Квартиры.';

function numberValue(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  return Number(value);
}

function locationLabel(floor: number | null, entrance: number | null): string {
  const floorText = floor === null ? 'этаж не указан' : `${floor}-й этаж`;
  return entrance === null ? floorText : `${entrance}-й подъезд · ${floorText}`;
}

export function ApartmentProfileScreen({ membership, phoneVerified, notify, onMembershipRefresh, onProfileComplete }: Props) {
  const [state, setState] = useState<ApartmentAccessState | null>(null);
  const [loadingError, setLoadingError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [infoInvite, setInfoInvite] = useState<{ code: string; link: string; expiresAt: string } | null>(null);
  const [infoGrants, setInfoGrants] = useState<ApartmentInfoAccessGrant[]>([]);

  const load = useCallback(async () => {
    setLoadingError(false);
    try {
      const next = await loadApartmentAccess(membership.houseId);
      setState(next);
      if (next.status === 'joined') setInfoGrants(await loadApartmentInfoGrants(membership.houseId));
    } catch {
      setLoadingError(true);
    }
  }, [membership.houseId]);

  useEffect(() => { void load(); }, [load]);

  if (editingProfile) {
    return (
      <ResidentProfileSetupScreen
        membership={membership}
        phoneVerified={phoneVerified}
        mode="edit"
        onCancel={() => setEditingProfile(false)}
        onComplete={(profile) => {
          onProfileComplete(profile);
          setEditingProfile(false);
          notify('Настройки соседей обновлены');
        }}
      />
    );
  }

  if (loadingError) return <ErrorState onRetry={() => void load()} />;
  if (!state) {
    return <main className="screen screen--inner inner-content" id="main-content"><Spinner size={32} /></main>;
  }

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setActionError(null);
    try { await action(); } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Не удалось выполнить действие');
    } finally { setBusy(false); }
  };

  if (state.status === 'unbound') {
    return (
      <ApartmentLocationForm
        title="Привязать Квартиру"
        description="Пустая Квартира привяжется сразу. Если в ней уже живут, участник Квартиры должен подтвердить запрос."
        submitting={busy}
        error={actionError}
        onSubmit={(input) => run(async () => {
          const result = await saveApartmentAccess(membership.houseId, input);
          if (result.status === 'joined') {
            setState(result.state);
            await onMembershipRefresh();
            notify('Квартира привязана');
          } else {
            setState({ status: 'pending', pendingRequest: result.request, incomingRequests: [] });
            notify('Запрос отправлен участникам Квартиры');
          }
        })}
      />
    );
  }

  if (state.status === 'pending') {
    const request = state.pendingRequest;
    return (
      <main className="screen screen--inner" id="main-content">
        <div className="inner-content stagger">
          <ScreenHeading description="Запрос увидят только участники выбранной Квартиры">Ожидает подтверждения</ScreenHeading>
          <section className="decision-card" aria-live="polite">
            <IconTile icon={House} tone="blue" size="medium" />
            <Typography.Text asChild variant="title"><h2>Квартира {request.apartmentNumber}</h2></Typography.Text>
            <Typography.Text asChild variant="description" color="secondary">
              <p>{locationLabel(request.apartmentFloor, request.apartmentEntrance)}</p>
            </Typography.Text>
          </section>
          <PrivacyNotice />
          {actionError ? <p className="field-error" role="alert">{actionError}</p> : null}
          <Button variant="secondary" stretched loading={busy} onClick={() => run(async () => {
            await cancelApartmentRequest(membership.houseId, request.id);
            setState({ status: 'unbound', pendingRequest: null, incomingRequests: [] });
            notify('Запрос отменён');
          })}>Отменить запрос</Button>
        </div>
      </main>
    );
  }

  const apartment = state.apartment;
  return (
    <main className="screen screen--inner" id="main-content">
      <div className="inner-content stagger">
        <ScreenHeading description="Номер нельзя изменить самостоятельно">Профиль Квартиры</ScreenHeading>
        <ApartmentLocationForm
          embedded
          title={`Квартира ${apartment.number}`}
          description={membership.address}
          initial={{ floor: apartment.floor, entrance: apartment.entrance }}
          submitting={busy}
          error={actionError}
          onSubmit={(input) => run(async () => {
            const result = await saveApartmentAccess(membership.houseId, { ...input, apartmentNumber: apartment.number });
            if (result.status === 'joined') setState(result.state);
            await onMembershipRefresh();
            notify('Расположение Квартиры обновлено');
          })}
        />

        <section className="decision-card">
          <Typography.Text asChild variant="title"><h2>Пригласить участника</h2></Typography.Text>
          <Typography.Text asChild variant="description" color="secondary"><p>{privacyCopy}</p></Typography.Text>
          <div className="decision-card__actions">
            <Button iconBefore={<LinkSimple aria-hidden />} stretched loading={busy} onClick={() => run(async () => {
              const code = await createApartmentInvite(membership.houseId);
              const bot = import.meta.env.VITE_MAX_BOT_USERNAME || 't25_hakaton_max_bot';
              const link = `https://max.ru/${bot}?startapp=inv_${code}`;
              setInviteLink(link);
              try {
                await navigator.clipboard.writeText(link);
                notify('Ссылка скопирована');
              } catch {
                notify('Приглашение создано');
              }
            })}>Создать Приглашение</Button>
            {inviteLink ? <Input value={inviteLink} readOnly aria-label="Ссылка-приглашение" /> : null}
          </div>
        </section>

        <section className="decision-card">
          <Typography.Text asChild variant="title"><h2>Ограниченный доступ</h2></Typography.Text>
          <Typography.Text asChild variant="description" color="secondary">
            <p>Можно передать только адрес Дома и номер Квартиры. Получатель не вступит в Домохозяйство и не увидит платежи, Чеки, Приборы и Показания.</p>
          </Typography.Text>
          <div className="decision-card__actions">
            <Button iconBefore={<LinkSimple aria-hidden />} stretched loading={busy} onClick={() => run(async () => {
              const created = await createApartmentInfoInvite(membership.houseId, apartment.id);
              const bot = import.meta.env.VITE_MAX_BOT_USERNAME || 't25_hakaton_max_bot';
              const link = `https://max.ru/${bot}?startapp=info_${created.code}`;
              setInfoInvite({ ...created, link });
              try {
                await navigator.clipboard.writeText(link);
                notify('Ограниченная ссылка скопирована');
              } catch {
                notify('Ограниченная ссылка создана');
              }
            })}>Создать ограниченную ссылку</Button>
            {infoInvite ? <>
              <Input value={infoInvite.link} readOnly aria-label="Ограниченная ссылка на Квартиру" />
              <Typography.Text asChild variant="description" color="secondary">
                <p>Действует до {new Date(infoInvite.expiresAt).toLocaleString('ru-RU')}</p>
              </Typography.Text>
              <Button variant="secondary" stretched disabled={busy} onClick={() => run(async () => {
                await revokeApartmentInfoInvite(membership.houseId, infoInvite.code);
                setInfoInvite(null);
                notify('Ссылка отозвана');
              })}>Отозвать ссылку</Button>
            </> : null}
          </div>
          {infoGrants.length ? (
            <div className="apartment-access-list" aria-label="Выданный ограниченный доступ">
              {infoGrants.map((grant) => (
                <article className="support-card" key={grant.id}>
                  <Typography.Text asChild variant="body-strong"><h3>{grant.residentName}</h3></Typography.Text>
                  <Typography.Text asChild variant="description" color="secondary"><p>Адрес и номер Квартиры · выдано {new Date(grant.createdAt).toLocaleDateString('ru-RU')}</p></Typography.Text>
                  <Button variant="secondary" stretched disabled={busy} onClick={() => run(async () => {
                    await revokeApartmentInfoGrant(membership.houseId, grant.id);
                    setInfoGrants((current) => current.filter((item) => item.id !== grant.id));
                    notify('Ограниченный доступ отозван');
                  })}>Отозвать доступ</Button>
                </article>
              ))}
            </div>
          ) : null}
        </section>

        {state.incomingRequests.length > 0 ? (
          <section className="apartment-access-list" aria-labelledby="incoming-apartment-requests">
            <Typography.Text asChild variant="title"><h2 id="incoming-apartment-requests">Запросы в Квартиру</h2></Typography.Text>
            {state.incomingRequests.map((request) => (
              <article className="decision-card" key={request.id}>
                <span className="support-card__head">
                  <UserPlus className="icon" aria-hidden />
                  <Typography.Text asChild variant="body-strong"><h3>{request.requesterName}</h3></Typography.Text>
                </span>
                <Typography.Text asChild variant="description" color="secondary"><p>{privacyCopy}</p></Typography.Text>
                <div className="decision-card__actions">
                  <Button stretched loading={busy} onClick={() => run(async () => {
                    await decideApartmentRequest(membership.houseId, request.id, 'approve');
                    await load();
                    notify('Участник добавлен в Квартиру');
                  })}>Подтвердить</Button>
                  <Button variant="secondary" stretched disabled={busy} onClick={() => run(async () => {
                    await decideApartmentRequest(membership.houseId, request.id, 'reject');
                    await load();
                    notify('Запрос отклонён');
                  })}>Отклонить</Button>
                </div>
              </article>
            ))}
          </section>
        ) : null}

        <Button variant="secondary" stretched onClick={() => setEditingProfile(true)}>Соседние Квартиры и показ телефона</Button>
        {actionError ? <p className="field-error" role="alert">{actionError}</p> : null}
      </div>
    </main>
  );
}

function PrivacyNotice() {
  return (
    <section className="contact-warning" aria-label="Какие данные станут доступны">
      <ShieldCheck className="icon" aria-hidden />
      <Typography.Text asChild variant="description"><p>{privacyCopy}</p></Typography.Text>
    </section>
  );
}

function ApartmentLocationForm({
  title,
  description,
  initial,
  submitting,
  error,
  onSubmit,
  embedded = false,
}: {
  title: string;
  description: string;
  initial?: { floor: number | null; entrance: number | null };
  submitting: boolean;
  error: string | null;
  onSubmit: (input: { apartmentNumber: string; floor: number; entrance: number | null }) => void;
  embedded?: boolean;
}) {
  const [apartmentNumber, setApartmentNumber] = useState('');
  const [floor, setFloor] = useState(initial?.floor?.toString() ?? '');
  const [entrance, setEntrance] = useState(initial?.entrance?.toString() ?? '');
  const [validation, setValidation] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const floorNumber = numberValue(floor);
    const entranceNumber = entrance.trim() ? numberValue(entrance) : null;
    const number = embedded ? title.replace(/^Квартира\s+/u, '') : apartmentNumber.trim();
    if (!number || floorNumber === null || floorNumber < 1 || floorNumber > 200
        || (entranceNumber !== null && (entranceNumber < 1 || entranceNumber > 100))) {
      setValidation('Укажите номер Квартиры, этаж от 1 до 200 и, если нужно, подъезд от 1 до 100');
      return;
    }
    setValidation(null);
    onSubmit({ apartmentNumber: number, floor: floorNumber, entrance: entranceNumber });
  };

  const content = (
    <form className="decision-card__form" onSubmit={submit}>
      <section className="resident-profile-house">
        <Typography.Text asChild variant="title"><h2>{title}</h2></Typography.Text>
        <Typography.Text asChild variant="description" color="secondary"><p>{description}</p></Typography.Text>
      </section>
      {!embedded ? (
        <label className="contact-form__field">
          <Typography.Text asChild variant="description"><span>Номер Квартиры</span></Typography.Text>
          <Input value={apartmentNumber} autoComplete="off" inputMode="text" placeholder="Например, 42А" onChange={(event) => setApartmentNumber(event.target.value)} />
        </label>
      ) : (
        <label className="contact-form__field">
          <Typography.Text asChild variant="description"><span>Номер Квартиры</span></Typography.Text>
          <Input value={title.replace(/^Квартира\s+/u, '')} readOnly aria-readonly />
        </label>
      )}
      <div className="resident-neighbors__grid">
        <label className="contact-form__field">
          <Typography.Text asChild variant="description"><span>Этаж</span></Typography.Text>
          <Input value={floor} inputMode="numeric" placeholder="Обязательно" onChange={(event) => setFloor(event.target.value)} />
        </label>
        <label className="contact-form__field">
          <Typography.Text asChild variant="description"><span>Подъезд</span></Typography.Text>
          <Input value={entrance} inputMode="numeric" placeholder="Необязательно" onChange={(event) => setEntrance(event.target.value)} />
        </label>
      </div>
      {!embedded ? <PrivacyNotice /> : null}
      {validation || error ? (
        <p className="field-error" role="alert"><WarningCircle aria-hidden /> {validation ?? error}</p>
      ) : null}
      <Button type="submit" size="large" stretched loading={submitting}>
        {embedded ? 'Сохранить расположение' : 'Продолжить'}
      </Button>
    </form>
  );

  if (embedded) return content;
  return (
    <main className="screen screen--inner" id="main-content">
      <div className="inner-content stagger">
        <ScreenHeading description={description}>{title}</ScreenHeading>
        {content}
      </div>
    </main>
  );
}
