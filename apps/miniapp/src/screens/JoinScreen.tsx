import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Buildings, HourglassMedium, House, LinkSimple, MagnifyingGlass, QrCode, WarningCircle } from '@phosphor-icons/react';
import { Button, Input, Spinner, Typography } from '../components/platform-ui.tsx';
import bridge from '@vkontakte/vk-bridge';
import { readVkCode } from '../platform/vk.ts';
import { useRefreshMembership } from '../auth/membership.tsx';
import type { HouseRegistration, HouseSearchResult } from '@maxtown/shared';
import { IconTile, ListCard, RowShell, ScreenHeading, Segmented, SkeletonRows } from '../components/ui.tsx';
import {
  checkInvite,
  cancelHouseMembershipRequest,
  getMyHouseRegistration,
  launchInviteCode,
  parseInviteCode,
  redeemInvite,
  requestHouseMembership,
  registerHouse,
  useHouseSearch,
  validateApartment,
  type InviteResult,
} from '../data/join.ts';
import { hapticSuccess, hapticWarning } from '../haptics.ts';
import { ROUTES } from '../routes.ts';
import type { Navigate, Notify } from './types.ts';

type Mode = 'invite' | 'request' | 'register';

const modes: Array<{ value: Mode; label: string }> = [
  { value: 'invite', label: 'По Приглашению' },
  { value: 'request', label: 'Без Приглашения' },
  { value: 'register', label: 'Я Староста' },
];

type JoinScreenProps = {
  navigate: Navigate;
  notify: Notify;
};

/** Путь «Стать Жильцом»: по Приглашению или Запросом на вступление. */
export function JoinScreen({ navigate, notify }: JoinScreenProps) {
  const [launchCode] = useState(launchInviteCode);
  const [mode, setMode] = useState<Mode>('invite');
  const [joined, setJoined] = useState<{ apartment: string; address: string } | null>(null);
  const refreshMembership = useRefreshMembership();

  if (joined) {
    return (
      <main className="screen screen--inner inner-content" id="main-content">
        <section className="join-result stagger" aria-live="polite">
          <IconTile icon={House} tone="green" size="large" />
          <Typography.Text asChild variant="header">
            <h1>Вы Жилец Квартиры {joined.apartment}</h1>
          </Typography.Text>
          <Typography.Text asChild variant="body" color="secondary">
            <p>{joined.address}. На главной теперь видно Состояние дома, а Заявки уходят Ответственным.</p>
          </Typography.Text>
          <Button size="medium" variant="primary" stretched onClick={() => navigate(ROUTES.home)}>
            На главную
          </Button>
        </section>
      </main>
    );
  }

  return (
    <main className="screen screen--inner" id="main-content">
      <div className="inner-content stagger">
        <ScreenHeading description="Жильцы видят Состояние дома, подают Заявки Ответственным и получают Уведомления">
          Стать Жильцом
        </ScreenHeading>
        <Segmented label="Как вступить" options={modes} value={mode} onChange={setMode} />
        {mode === 'invite' ? (
          <InviteFlow
            initialCode={launchCode}
            onJoined={(apartment, address) => {
              hapticSuccess();
              setJoined({ apartment, address });
              // Главная, Профиль и Роль берут членство из сессии — перечитываем её.
              void refreshMembership();
            }}
          />
        ) : mode === 'register' ? (
          <RegistrationFlow />
        ) : (
          <RequestFlow navigate={navigate} notify={notify} />
        )}
      </div>
    </main>
  );
}

function RegistrationFlow() {
  const [address, setAddress] = useState('');
  const [locality, setLocality] = useState('');
  const [apartmentNumber, setApartmentNumber] = useState('');
  const [registration, setRegistration] = useState<HouseRegistration | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getMyHouseRegistration().then(setRegistration).catch(() => setError('Не удалось загрузить регистрацию Дома. Проверьте подключение.'))
      .finally(() => setLoading(false));
  }, []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (address.trim().length < 3 || locality.trim().length < 2 || validateApartment(apartmentNumber)) {
      setError('Проверьте адрес, город или район и номер Квартиры Старосты.');
      return;
    }
    setSending(true);
    setError(null);
    void registerHouse({ address: address.trim(), locality: locality.trim(), apartmentNumber: apartmentNumber.trim() })
      .then(() => getMyHouseRegistration())
      .then(setRegistration)
      .catch(() => setError('Не удалось отправить регистрацию. Проверьте данные и попробуйте ещё раз.'))
      .finally(() => setSending(false));
  };

  if (loading) return <div className="join-checking"><Spinner size={20} />Загружаем регистрацию Дома…</div>;
  if (registration && registration.status !== 'rejected') {
    return (
      <section className="decision-card" aria-live="polite">
        <IconTile icon={HourglassMedium} tone="coral" size="medium" />
        <Typography.Text asChild variant="title"><h2>{registration.status === 'approved' ? 'Дом одобрен' : 'Регистрация Дома на проверке'}</h2></Typography.Text>
        <Typography.Text asChild variant="description" color="secondary"><p>{registration.address}, {registration.locality}. Квартира {registration.headman.apartment}.</p></Typography.Text>
        {registration.status === 'pending' ? <Typography.Text asChild variant="description" color="secondary"><p>Модератор проверит адрес. После одобрения вы станете Старостой Дома.</p></Typography.Text> : null}
      </section>
    );
  }

  return (
    <form className="form-section" onSubmit={submit} noValidate>
      <Typography.Text asChild variant="description" color="secondary"><p>Зарегистрируйте Дом, чтобы соседи могли вступить. Адрес проверит Модератор.</p></Typography.Text>
      <Typography.Text asChild variant="title"><label htmlFor="registration-address">Адрес Дома</label></Typography.Text>
      <Input id="registration-address" mode="contrast" size="large" autoComplete="street-address" placeholder="Улица и номер дома" value={address} onChange={(event) => setAddress(event.target.value)} />
      <Typography.Text asChild variant="title"><label htmlFor="registration-locality">Город или район</label></Typography.Text>
      <Input id="registration-locality" mode="contrast" size="large" autoComplete="address-level2" placeholder="Например, Казань" value={locality} onChange={(event) => setLocality(event.target.value)} />
      <Typography.Text asChild variant="title"><label htmlFor="registration-apartment">Ваша Квартира</label></Typography.Text>
      <Input id="registration-apartment" mode="contrast" size="large" autoComplete="off" placeholder="Например, 34" value={apartmentNumber} onChange={(event) => setApartmentNumber(event.target.value)} />
      {registration?.rejectionReason ? <Typography.Text asChild variant="description"><p className="field-error">Предыдущая регистрация отклонена: {registration.rejectionReason}</p></Typography.Text> : null}
      {error ? <Typography.Text asChild variant="description"><p className="field-error" role="alert">{error}</p></Typography.Text> : null}
      <Button type="submit" size="medium" variant="primary" stretched loading={sending}>Отправить Модератору</Button>
    </form>
  );
}

type CheckState = { state: 'idle' } | { state: 'checking' } | { state: 'done'; code: string; result: InviteResult };

function InviteFlow({ initialCode, onJoined }: { initialCode: string | null; onJoined: (apartment: string, address: string) => void }) {
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<CheckState>({ state: 'idle' });
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const scanner = bridge.supports('VKWebAppOpenCodeReader');

  const verify = (code: string) => {
    setError(null);
    setCheck({ state: 'checking' });
    void checkInvite(code).then((result) => {
      if (result.status !== 'valid') hapticWarning();
      setCheck({ state: 'done', code, result });
    });
  };

  // Открыли по ссылке-приглашению — проверяем сразу, без лишних нажатий.
  const checkedLaunch = useRef(false);
  useEffect(() => {
    if (!initialCode || checkedLaunch.current) return;
    checkedLaunch.current = true;
    verify(initialCode);
  }, [initialCode]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = parseInviteCode(link);
    if (!code) {
      setError('Это не похоже на Приглашение. Вставьте ссылку целиком: она начинается с https://vk.com/app');
      return;
    }
    verify(code);
  };

  const scan = async () => {
    try {
      const scannedValue = await readVkCode(bridge);
      const code = scannedValue ? parseInviteCode(scannedValue) : null;
      if (code) verify(code);
      else setError('В QR-коде нет Приглашения MaxTown. Попросите код ещё раз');
    } catch {
      // Сканер закрыли без результата — ничего не делаем.
    }
  };

  if (check.state === 'done' && check.result.status === 'valid') {
    const { apartment, houseAddress } = check.result;
    return (
      <section className="decision-card reveal" aria-labelledby="invite-valid-title" aria-live="polite">
        <IconTile icon={House} tone="green" size="medium" />
        <Typography.Text asChild variant="title">
          <h2 id="invite-valid-title">
            Квартира {apartment}, {houseAddress}
          </h2>
        </Typography.Text>
        <Typography.Text asChild variant="description" color="secondary">
          <p>Приглашение действует. Вступите, и Дом появится на главной.</p>
        </Typography.Text>
        <div className="decision-card__actions">
          <Button size="medium" variant="primary" stretched loading={joining} onClick={() => {
            setJoining(true);
            setJoinError(null);
            void redeemInvite(check.code).then(() => onJoined(apartment, houseAddress)).catch(() => {
              setJoinError('Не удалось вступить. Проверьте подключение и попробуйте ещё раз.');
            }).finally(() => setJoining(false));
          }}>
            Вступить
          </Button>
          {joinError ? <p className="field-error" role="alert">{joinError}</p> : null}
          <Button size="medium" variant="ghost" stretched onClick={() => setCheck({ state: 'idle' })}>
            Это не моя Квартира
          </Button>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="join-option" aria-labelledby="invite-title">
        <IconTile icon={QrCode} tone="blue" size="medium" />
        <span className="join-option__copy">
          <Typography.Text asChild variant="title">
            <h2 id="invite-title">Приглашение в Квартиру</h2>
          </Typography.Text>
          <Typography.Text asChild variant="description" color="secondary">
            <p>QR-код или ссылка от Старосты или Жильца вашей Квартиры. По нему вы сразу станете Жильцом.</p>
          </Typography.Text>
        </span>
        {scanner ? (
          <Button
            size="medium"
            variant="primary"
            stretched
            iconBefore={<QrCode className="icon icon--small" weight="bold" aria-hidden />}
            onClick={() => void scan()}
          >
            Сканировать QR-код
          </Button>
        ) : null}
      </section>

      <form className="form-section" onSubmit={submit} noValidate>
        <Typography.Text asChild variant="title">
          <label htmlFor="invite-link">{scanner ? 'Или вставьте ссылку' : 'Ссылка на Приглашение'}</label>
        </Typography.Text>
        <Input
          id="invite-link"
          mode="contrast"
          size="large"
          inputMode="url"
          autoComplete="off"
          placeholder="https://vk.com/app…"
          value={link}
          withClearButton
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'invite-error' : undefined}
          iconBefore={<LinkSimple className="icon icon--small" aria-hidden />}
          onChange={(event) => {
            setLink(event.target.value);
            setError(null);
          }}
        />
        {error ? (
          <Typography.Text asChild variant="description">
            <span className="field-error" id="invite-error">
              {error}
            </span>
          </Typography.Text>
        ) : null}
        <Button
          type="submit"
          size="medium"
          variant={scanner ? 'secondary' : 'primary'}
          stretched
          loading={check.state === 'checking'}
        >
          Проверить Приглашение
        </Button>
      </form>

      <div aria-live="polite">
        {check.state === 'checking' ? (
          <div className="join-checking">
            <Spinner size={20} />
            Проверяем Приглашение…
          </div>
        ) : check.state === 'done' ? (
          <InviteProblem result={check.result} />
        ) : null}
      </div>
    </>
  );
}

const inviteProblems: Record<Exclude<InviteResult['status'], 'valid'>, { title: string; text: string }> = {
  revoked: {
    title: 'Это Приглашение уже не действует',
    text: 'Его перевыпустили: у Квартиры действует только последнее. Попросите новое у того, кто его отправил.',
  },
  'not-found': {
    title: 'Приглашение не найдено',
    text: 'Проверьте, что ссылка скопирована целиком, или отсканируйте QR-код.',
  },
  unavailable: {
    title: 'Вступить пока нельзя',
    text: 'MaxTown ещё подключает Дома. Сохраните Приглашение и попробуйте позже.',
  },
};

function InviteProblem({ result }: { result: InviteResult }) {
  if (result.status === 'valid') return null;
  const { title, text } = inviteProblems[result.status];
  return (
    <aside className={`outcome reveal${result.status === 'unavailable' ? '' : ' outcome--negative'}`}>
      <WarningCircle className="icon" weight="fill" aria-hidden />
      <span className="outcome__copy">
        <Typography.Text asChild variant="body-strong">
          <p>{title}</p>
        </Typography.Text>
        <Typography.Text asChild variant="description" color="secondary">
          <p>{text}</p>
        </Typography.Text>
      </span>
    </aside>
  );
}

function RequestFlow({ navigate, notify }: { navigate: Navigate; notify: Notify }) {
  const [query, setQuery] = useState('');
  const [house, setHouse] = useState<HouseSearchResult | null>(null);
  const [apartment, setApartment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const { status, houses } = useHouseSearch(query);

  const [requestId, setRequestId] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const problem = validateApartment(apartment);
    setError(problem);
    if (problem) return;
    setSending(true);
    setRequestError(null);
    void requestHouseMembership(house!.id, apartment.trim().toLocaleUpperCase('ru-RU')).then((id) => {
      setRequestId(id);
      setSent(true);
      hapticSuccess();
    }).catch(() => setRequestError('Не удалось отправить Запрос. Проверьте подключение и попробуйте ещё раз.'))
      .finally(() => setSending(false));
  };

  if (house && sent) {
    return (
      <section className="decision-card reveal" aria-labelledby="request-sent-title" aria-live="polite">
        <IconTile icon={HourglassMedium} tone="coral" size="medium" />
        <Typography.Text asChild variant="title">
          <h2 id="request-sent-title">Запрос на вступление отправлен</h2>
        </Typography.Text>
        <Typography.Text asChild variant="description" color="secondary">
          <p>
            Квартира {apartment.trim().toLocaleUpperCase('ru-RU')}, {house.address}
          </p>
        </Typography.Text>
        <ol className="timeline timeline--inline">
          <li className="timeline__step timeline__step--past">
            <span className="timeline__marker" aria-hidden />
            <span className="timeline__copy">
              <span className="timeline__label">Запрос отправлен</span>
            </span>
          </li>
          <li className="timeline__step timeline__step--current">
            <span className="timeline__marker" aria-hidden />
            <span className="timeline__copy">
              <span className="timeline__label">Ждёт решения</span>
              <Typography.Text asChild variant="description" color="secondary">
                <span>Решает Жилец Квартиры, а если в ней никого нет, Староста</span>
              </Typography.Text>
            </span>
          </li>
          <li className="timeline__step timeline__step--upcoming">
            <span className="timeline__marker" aria-hidden />
            <span className="timeline__copy">
              <span className="timeline__label">Вы Жилец</span>
            </span>
          </li>
        </ol>
        <Typography.Text asChild variant="description" color="secondary">
          <p>Пришлём Уведомление, когда решат.</p>
        </Typography.Text>
        {requestError ? <Typography.Text asChild variant="description"><p className="field-error" role="alert">{requestError}</p></Typography.Text> : null}
        <div className="decision-card__actions">
          <Button size="medium" variant="secondary" stretched onClick={() => navigate(ROUTES.home)}>
            На главную
          </Button>
          <Button
            size="medium"
            variant="ghost"
            stretched
            onClick={() => {
              if (!requestId) return;
              setSending(true);
              void cancelHouseMembershipRequest(requestId).then(() => {
                setSent(false);
                setRequestId(null);
                notify('Запрос на вступление отозван');
              }).catch(() => setRequestError('Не удалось отозвать Запрос. Попробуйте ещё раз.'))
                .finally(() => setSending(false));
            }}
            loading={sending}
          >
            Отозвать запрос
          </Button>
        </div>
        <span className="visually-hidden">Номер Запроса: {requestId}</span>
      </section>
    );
  }

  if (house) {
    return (
      <form className="join-request reveal" onSubmit={submit} noValidate>
        <div className="list-card">
          <div className="list-row list-row--compact">
            <IconTile icon={Buildings} tone="teal" size="small" />
            <span className="list-row__copy">
              <Typography.Text asChild variant="body-strong">
                <span>{house.address}</span>
              </Typography.Text>
              <Typography.Text asChild variant="description" color="secondary">
                <span>{house.locality}</span>
              </Typography.Text>
            </span>
            <button
              className="text-action pressable"
              type="button"
              onClick={() => {
                setHouse(null);
                setError(null);
              }}
            >
              Изменить
            </button>
          </div>
        </div>

        <section className="form-section">
          <Typography.Text asChild variant="title">
            <label htmlFor="apartment">Номер Квартиры</label>
          </Typography.Text>
          <Input
            id="apartment"
            mode="contrast"
            size="large"
            autoComplete="off"
            enterKeyHint="send"
            placeholder="Например, 34"
            value={apartment}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'apartment-error apartment-hint' : 'apartment-hint'}
            onChange={(event) => {
              setApartment(event.target.value);
              setError(null);
            }}
          />
          {error ? (
            <Typography.Text asChild variant="description">
              <span className="field-error" id="apartment-error">
                {error}
              </span>
            </Typography.Text>
          ) : null}
          <Typography.Text asChild variant="description" color="tertiary">
            <p id="apartment-hint">
              Запрос увидит Жилец этой Квартиры. Если в ней ещё никого нет, решит Староста.
            </p>
          </Typography.Text>
        </section>

        {requestError ? <Typography.Text asChild variant="description"><p className="field-error" role="alert">{requestError}</p></Typography.Text> : null}
        <Button type="submit" size="medium" variant="primary" stretched loading={sending}>
          Отправить запрос
        </Button>
      </form>
    );
  }

  return (
    <section className="form-section" aria-labelledby="house-search-label">
      <Typography.Text asChild variant="title">
        <label id="house-search-label" htmlFor="house-search">
          Найдите свой Дом
        </label>
      </Typography.Text>
      <Input
        id="house-search"
        type="search"
        mode="contrast"
        size="large"
        autoComplete="off"
        placeholder="Улица и номер дома"
        value={query}
        withClearButton
        iconBefore={<MagnifyingGlass className="icon icon--small" aria-hidden />}
        onChange={(event) => setQuery(event.target.value)}
      />
      {status === 'loading' ? (
        <SkeletonRows count={2} />
      ) : !query.trim() ? (
        <Typography.Text asChild variant="description" color="tertiary">
          <p>Например, «Лесная 12». Потом укажете Квартиру, и Запрос на вступление уйдёт её Жильцу или Старосте.</p>
        </Typography.Text>
      ) : houses.length > 0 ? (
        <ListCard label="Найденные Дома" key={query}>
          {houses.map((result) => (
            <RowShell key={result.id} className="list-row--compact" onOpen={() => setHouse(result)}>
              <IconTile icon={Buildings} tone="teal" size="small" />
              <span className="list-row__copy">
                <Typography.Text asChild variant="body-strong">
                  <span>{result.address}</span>
                </Typography.Text>
                <Typography.Text asChild variant="description" color="secondary">
                  <span>{result.locality}</span>
                </Typography.Text>
              </span>
            </RowShell>
          ))}
        </ListCard>
      ) : (
        <aside className="outcome reveal">
          <Buildings className="icon" aria-hidden />
          <span className="outcome__copy">
            <Typography.Text asChild variant="body-strong">
              <p>Дом не найден</p>
            </Typography.Text>
            <Typography.Text asChild variant="description" color="secondary">
              <p>Дом появляется в MaxTown, когда его регистрирует Староста. Проверьте адрес или спросите Старосту.</p>
            </Typography.Text>
          </span>
        </aside>
      )}
    </section>
  );
}
