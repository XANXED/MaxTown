import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { HouseRegistration, HouseRegistrationStatus } from '@maxtown/shared';
import {
  countByStatus,
  decideRegistration,
  registrationChecks,
  rejectionError,
  useRegistrations,
  visibleRegistrations,
  type CheckState,
} from './data/registrations.ts';

// Панель Модератора (ADR-0002): проверка Домов, которые зарегистрировали
// Старосты. Десктоп: слева очередь, справа выбранная регистрация.

const tabs: Array<{ value: HouseRegistrationStatus; label: string }> = [
  { value: 'pending', label: 'На проверке' },
  { value: 'approved', label: 'Одобрены' },
  { value: 'rejected', label: 'Отклонены' },
];

const checkLabels: Record<CheckState, string> = {
  ok: 'Норма',
  warning: 'Проверьте',
  problem: 'Мешает',
};

const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

/** «22 сентября, 19:00»; день с месяцем не разрываются переносом. */
function formatDate(iso: string): string {
  const date = new Date(iso);
  return `${dateFormat.format(date).replace(' ', '\u00a0')}, ${timeFormat.format(date)}`;
}

/** «ждёт 3 дня», «ждёт с сегодняшнего утра» — насколько регистрация засиделась. */
function waitingFor(iso: string, now: Date): string {
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return 'подана сегодня';
  const mod10 = days % 10;
  const mod100 = days % 100;
  const word = mod10 === 1 && mod100 !== 11 ? 'день' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'дня' : 'дней';
  return `ждёт ${days} ${word}`;
}

export function App() {
  const { status, data, retry } = useRegistrations();
  // Решения меняют список на месте; с API здесь будет ответ сервера.
  const [changed, setChanged] = useState<HouseRegistration[] | null>(null);
  const items = changed ?? data;
  const [tab, setTab] = useState<HouseRegistrationStatus>('pending');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const clearNotice = useCallback(() => setNotice(''), []);
  const counts = countByStatus(items);
  const visible = visibleRegistrations(items, tab);
  const selected = visible.find(({ id }) => id === selectedId) ?? visible[0] ?? null;

  const decide = async (selectedItem: HouseRegistration, decision: 'approve' | 'reject', reason?: string) => {
    try {
      const next = await decideRegistration(selectedItem.id, decision, reason);
      setChanged((current) => (current ?? items).map((item) => (item.id === next.id ? next : item)));
      setSelectedId(null);
      setNotice(decision === 'approve' ? `${selectedItem.address}: Дом одобрен` : `${selectedItem.address}: регистрация отклонена`);
    } catch {
      setNotice('Не удалось сохранить решение. Проверьте подключение и повторите попытку.');
    }
  };

  return (
    <div className="admin">
      <header className="topbar">
        <span className="topbar__brand">MaxTown</span>
        <span className="topbar__section">Модерация Домов</span>
      </header>

      <div className="workspace">
        <nav className="queue" aria-labelledby="queue-title">
          <h1 className="queue__title" id="queue-title">
            Регистрации Домов
          </h1>
          <div className="tabs" role="tablist" aria-label="Какие регистрации показать">
            {tabs.map(({ value, label }) => (
              <button
                className={`tab${tab === value ? ' tab--selected' : ''}`}
                type="button"
                role="tab"
                aria-selected={tab === value}
                key={value}
                onClick={() => {
                  setTab(value);
                  setSelectedId(null);
                }}
              >
                {label}
                <span className="tab__count">{counts[value]}</span>
              </button>
            ))}
          </div>

          {status === 'loading' ? (
            <ul className="queue__list" aria-busy="true" aria-label="Загрузка">
              {[0, 1, 2].map((index) => (
                <li className="queue__skeleton" key={index} aria-hidden>
                  <span className="skeleton skeleton--line" />
                  <span className="skeleton skeleton--short" />
                </li>
              ))}
            </ul>
          ) : status === 'error' ? (
            <div className="queue__empty" role="alert">
              <p className="queue__empty-title">Не удалось загрузить</p>
              <p className="muted">Проверьте интернет и попробуйте ещё раз.</p>
              <button className="button button--secondary button--small" type="button" onClick={retry}>
                Повторить
              </button>
            </div>
          ) : visible.length === 0 ? (
            <div className="queue__empty">
              <p className="queue__empty-title">
                {tab === 'pending' ? 'Все регистрации проверены' : tab === 'approved' ? 'Одобренных пока нет' : 'Отклонённых пока нет'}
              </p>
              <p className="muted">
                {tab === 'pending' ? 'Новые появятся здесь, когда Староста зарегистрирует Дом.' : 'Здесь будут решения Модераторов.'}
              </p>
            </div>
          ) : (
            <ul className="queue__list">
              {visible.map((item) => {
                const attention = registrationChecks(item, items).some(({ state }) => state !== 'ok');
                return (
                  <li key={item.id}>
                    <button
                      className="queue__item"
                      type="button"
                      aria-current={item.id === selected?.id ? 'true' : undefined}
                      onClick={() => setSelectedId(item.id)}
                    >
                      <span className="queue__address">{item.address}</span>
                      <span className="muted">{item.locality}</span>
                      <span className="queue__meta">
                        <span className="muted tabular">
                          {item.status === 'pending'
                            ? waitingFor(item.submittedAt, new Date())
                            : item.decidedAt
                              ? formatDate(item.decidedAt)
                              : ''}
                        </span>
                        {item.status === 'pending' && attention ? <span className="flag">Нужна проверка</span> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        <main className="review" id="main-content">
          {selected ? (
            <Review
              key={selected.id}
              item={selected}
              all={items}
              onApprove={() => void decide(selected, 'approve')}
              onReject={(reason) => void decide(selected, 'reject', reason)}
            />
          ) : status === 'ready' ? (
            <div className="review__placeholder">
              <p className="muted">Выберите регистрацию слева.</p>
            </div>
          ) : null}
        </main>
      </div>

      <div className="live-region" aria-live="polite">
        {notice ? <Notice message={notice} onDone={clearNotice} /> : null}
      </div>
    </div>
  );
}

function Notice({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, 3200);
    return () => window.clearTimeout(timer);
  }, [message, onDone]);
  return (
    <div className="notice" role="status">
      {message}
    </div>
  );
}

type ReviewProps = {
  item: HouseRegistration;
  all: HouseRegistration[];
  onApprove: () => void;
  onReject: (reason: string) => void;
};

function Review({ item, all, onApprove, onReject }: ReviewProps) {
  const checks = registrationChecks(item, all);
  const blocked = checks.some(({ state }) => state === 'problem');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const reasonField = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (rejecting) reasonField.current?.focus();
  }, [rejecting]);

  const submitReject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const problem = rejectionError(reason);
    setError(problem);
    if (!problem) onReject(reason);
  };

  return (
    <article className="review__card" aria-labelledby="review-title">
      <header className="review__head">
        <h2 className="review__title" id="review-title">
          {item.address}
        </h2>
        <p className="muted">
          {item.locality}. Подана {formatDate(item.submittedAt)}
        </p>
      </header>

      {item.status === 'approved' && item.decidedAt ? (
        <p className="outcome outcome--positive">Одобрен {formatDate(item.decidedAt)}. Дом работает.</p>
      ) : null}
      {item.status === 'rejected' ? (
        <div className="outcome outcome--negative">
          <p>Отклонена{item.decidedAt ? ` ${formatDate(item.decidedAt)}` : ''}.</p>
          {item.rejectionReason ? <p className="muted">Причина для Старосты: {item.rejectionReason}</p> : null}
        </div>
      ) : null}

      <section className="group" aria-labelledby="checks-title">
        <h3 className="group__title" id="checks-title">
          Проверки
        </h3>
        <ul className="checks">
          {checks.map((check) => (
            <li className="check" key={check.label}>
              <span className={`check__state check__state--${check.state}`}>{checkLabels[check.state]}</span>
              <span className="check__copy">
                <span className="check__label">{check.label}</span>
                <span className="muted">{check.hint}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="group" aria-labelledby="headman-title">
        <h3 className="group__title" id="headman-title">
          Староста
        </h3>
        <dl className="facts">
          <div className="facts__row">
            <dt>Имя в VK</dt>
            <dd>
              {item.headman.name}
              {item.headman.vkUsername ? <span className="muted"> @{item.headman.vkUsername}</span> : null}
            </dd>
          </div>
          <div className="facts__row">
            <dt>Квартира</dt>
            <dd className="tabular">{item.headman.apartment}</dd>
          </div>
          <div className="facts__row">
            <dt>Телефон</dt>
            <dd className="tabular">{item.headman.phone ?? <span className="muted">не подтверждён</span>}</dd>
          </div>
        </dl>
      </section>

      <section className="group" aria-labelledby="address-title">
        <h3 className="group__title" id="address-title">
          Адрес в реестре
        </h3>
        <dl className="facts">
          <div className="facts__row">
            <dt>GUID дома в ГАР</dt>
            <dd className="guid">{item.garHouseGuid ?? <span className="muted">нет</span>}</dd>
          </div>
        </dl>
      </section>

      {item.status === 'pending' ? (
        rejecting ? (
          <form className="decision" onSubmit={submitReject} noValidate>
            <label className="decision__label" htmlFor="reject-reason">
              Причина отказа
            </label>
            <textarea
              ref={reasonField}
              id="reject-reason"
              className={`field${error ? ' field--invalid' : ''}`}
              rows={3}
              maxLength={500}
              value={reason}
              placeholder="Например: адреса нет в ГАР, пришлите фото таблички с номером дома"
              aria-invalid={Boolean(error)}
              aria-describedby="reject-hint"
              onChange={(event) => {
                setReason(event.target.value);
                setError(null);
              }}
            />
            <p className={error ? 'field-error' : 'muted'} id="reject-hint">
              {error ?? 'Её увидит Староста: напишите, что исправить, чтобы зарегистрироваться заново.'}
            </p>
            <div className="decision__actions">
              <button className="button button--danger" type="submit">
                Отклонить регистрацию
              </button>
              <button className="button button--ghost" type="button" onClick={() => setRejecting(false)}>
                Отмена
              </button>
            </div>
          </form>
        ) : (
          <div className="decision">
            {blocked ? (
              <p className="muted">Одобрить нельзя: этот Дом уже работает в MaxTown. Отклоните с пояснением.</p>
            ) : null}
            <div className="decision__actions">
              <button className="button button--primary" type="button" disabled={blocked} onClick={onApprove}>
                Одобрить Дом
              </button>
              <button className="button button--secondary" type="button" onClick={() => setRejecting(true)}>
                Отклонить
              </button>
            </div>
          </div>
        )
      ) : null}
    </article>
  );
}
