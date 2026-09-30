import { useEffect, useRef, useState, type FormEvent } from 'react';
import { House, LinkSimple, QrCode, WarningCircle } from '@phosphor-icons/react';
import { Button, Input, Spinner, Typography } from '../components/platform-ui.tsx';
import { useRefreshMembership } from '../auth/membership.tsx';
import { IconTile, ScreenHeading } from '../components/ui.tsx';
import { checkInvite, launchInviteCode, parseInviteCode, redeemInvite, type InviteResult } from '../data/join.ts';
import { hapticSuccess, hapticWarning } from '../haptics.ts';
import { ROUTES } from '../routes.ts';
import type { Navigate } from './types.ts';

type JoinScreenProps = {
  navigate: Navigate;
};

/** Сканер QR-кодов MAX; вне MAX его нет. */
function codeReader(): ((fileSelect?: boolean) => Promise<string>) | null {
  const webApp = window.WebApp;
  return webApp?.initData && webApp.openCodeReader ? webApp.openCodeReader.bind(webApp) : null;
}

/**
 * Путь «Стать Жильцом» (docs/adr/0006): в Дом пускает участие в Домовом чате
 * MAX, а Приглашение привязывает человека к конкретной Квартире.
 */
export function JoinScreen({ navigate }: JoinScreenProps) {
  const [launchCode] = useState(launchInviteCode);
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
        <ScreenHeading description="В Дом пускает Домовой чат MAX: попросите его администратора добавить бота MaxTown. Приглашение от соседа привяжет вас к Квартире">
          Стать Жильцом
        </ScreenHeading>
        <InviteFlow
          initialCode={launchCode}
          onJoined={(apartment, address) => {
            hapticSuccess();
            setJoined({ apartment, address });
            // Главная, Профиль и Роль берут членство из сессии — перечитываем её.
            void refreshMembership();
          }}
        />
      </div>
    </main>
  );
}

type CheckState = { state: 'idle' } | { state: 'checking' } | { state: 'done'; code: string; result: InviteResult };

function InviteFlow({ initialCode, onJoined }: { initialCode: string | null; onJoined: (apartment: string, address: string) => void }) {
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<CheckState>({ state: 'idle' });
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const scanner = codeReader();

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
      setError('Это не похоже на Приглашение. Вставьте ссылку целиком: она начинается с https://max.ru/');
      return;
    }
    verify(code);
  };

  const scan = async () => {
    try {
      const scannedValue = await scanner?.(true);
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
          <p>Приглашение действует для участника этого Домового чата. После вступления вы увидите платежи и Чеки текущего Домохозяйства, а также всю техническую историю Приборов и Показаний Квартиры.</p>
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
            <p>QR-код или ссылка от Администратора Дома или Жильца вашей Квартиры. По нему вы станете Жильцом этой Квартиры.</p>
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
