import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Buildings, HourglassMedium, House, LinkSimple, MagnifyingGlass, QrCode, WarningCircle } from '@phosphor-icons/react';
import { Button, Input, Spinner, Typography } from '@maxhub/max-ui';
import type { HouseSearchResult } from '@maxtown/shared';
import { IconTile, ListCard, RowShell, ScreenHeading, Segmented, SkeletonRows } from '../components/ui.tsx';
import {
  checkInvite,
  launchInviteCode,
  parseInviteCode,
  useHouseSearch,
  validateApartment,
  type InviteResult,
} from '../data/join.ts';
import { hapticSuccess, hapticWarning } from '../haptics.ts';
import { ROUTES } from '../routes.ts';
import type { Navigate, Notify } from './types.ts';

type Mode = 'invite' | 'request';

const modes: Array<{ value: Mode; label: string }> = [
  { value: 'invite', label: 'По Приглашению' },
  { value: 'request', label: 'Без Приглашения' },
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
            }}
          />
        ) : (
          <RequestFlow navigate={navigate} notify={notify} />
        )}
      </div>
    </main>
  );
}

type CheckState = { state: 'idle' } | { state: 'checking' } | { state: 'done'; result: InviteResult };

function InviteFlow({ initialCode, onJoined }: { initialCode: string | null; onJoined: (apartment: string, address: string) => void }) {
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<CheckState>({ state: 'idle' });
  const scanner = window.WebApp?.initData ? window.WebApp.openCodeReader : undefined;

  const verify = (code: string) => {
    setError(null);
    setCheck({ state: 'checking' });
    void checkInvite(code).then((result) => {
      if (result.status !== 'valid') hapticWarning();
      setCheck({ state: 'done', result });
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
      setError('Это не похоже на Приглашение. Вставьте ссылку целиком: она начинается с https://max.ru/');
      return;
    }
    verify(code);
  };

  const scan = async () => {
    if (!scanner) return;
    try {
      const text = await scanner.call(window.WebApp, true);
      const code = parseInviteCode(text);
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
          <Button size="medium" variant="primary" stretched onClick={() => onJoined(apartment, houseAddress)}>
            Вступить
          </Button>
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
          placeholder="https://max.ru/…"
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

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const problem = validateApartment(apartment);
    setError(problem);
    if (problem) return;
    // API ещё нет: Запрос никуда не уходит, экран показывает, что будет дальше.
    setSending(true);
    window.setTimeout(() => {
      setSending(false);
      setSent(true);
      hapticSuccess();
    }, 600);
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
        <div className="decision-card__actions">
          <Button size="medium" variant="secondary" stretched onClick={() => navigate(ROUTES.home)}>
            На главную
          </Button>
          <Button
            size="medium"
            variant="ghost"
            stretched
            onClick={() => {
              setSent(false);
              notify('Запрос на вступление отозван');
            }}
          >
            Отозвать запрос
          </Button>
        </div>
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
