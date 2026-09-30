import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  CalendarBlank,
  CheckCircle,
  Drop,
  Lightning,
  Moon,
  PencilSimple,
  Thermometer,
  Trash,
} from '@phosphor-icons/react';
import { NativeSelect } from '@vkontakte/vkui';
import type { Meter, MeterInput, MeterKind, ReadingsWindow } from '@maxtown/shared';
import { Button, Input, Typography } from '../components/platform-ui.tsx';
import {
  EmptyState,
  ErrorState,
  IconTile,
  ListCard,
  RowShell,
  ScreenHeading,
  SectionHeading,
  SkeletonRows,
  type IconComponent,
  type TileTone,
} from '../components/ui.tsx';
import {
  archiveMeter,
  checkReading,
  formatReading,
  saveMeter,
  saveReadings,
  useReadingsWindow,
  windowState,
  type ReadingCheck,
} from '../data/readings.ts';
import { demoMode } from '../data/loadable.ts';
import { hapticSuccess } from '../haptics.ts';
import { ROUTES } from '../routes.ts';
import { useMembership } from '../auth/membership.tsx';
import type { Navigate, Notify } from './types.ts';
import { UtilityTabs } from './UtilityPaymentsScreen.tsx';

const meterVisuals: Record<MeterKind, { icon: IconComponent; tone: TileTone }> = {
  'cold-water': { icon: Drop, tone: 'blue' },
  'hot-water': { icon: Drop, tone: 'coral' },
  'electricity-day': { icon: Lightning, tone: 'green' },
  'electricity-night': { icon: Moon, tone: 'teal' },
  heat: { icon: Thermometer, tone: 'pink' },
};

const meterDefaults: Record<MeterKind, { title: string; unit: string; decimals: number }> = {
  'cold-water': { title: 'Холодная вода', unit: 'м³', decimals: 3 },
  'hot-water': { title: 'Горячая вода', unit: 'м³', decimals: 3 },
  'electricity-day': { title: 'Электричество, день', unit: 'кВт·ч', decimals: 1 },
  'electricity-night': { title: 'Электричество, ночь', unit: 'кВт·ч', decimals: 1 },
  heat: { title: 'Отопление', unit: 'Гкал', decimals: 3 },
};

const dayFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });

function formatDay(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
  return dayFormat.format(new Date(year ?? 0, (month ?? 1) - 1, day ?? 1));
}

type ReadingsScreenProps = {
  houseId: string | null;
  navigate: Navigate;
  notify: Notify;
};

/** Личная история Показаний Квартиры. MaxTown сохраняет записи, но не отправляет их во внешние системы. */
export function ReadingsScreen({ houseId, navigate, notify }: ReadingsScreenProps) {
  const { status, data: intake, retry, replace } = useReadingsWindow();
  const membership = useMembership();
  const isDemo = demoMode() === 'filled';
  const resolvedHouseId = houseId ?? (isDemo ? 'demo-house' : null);

  if (!isDemo && !membership?.apartmentId) {
    return (
      <PageFrame navigate={navigate}>
        <div className="list-card">
          <EmptyState
            icon={Drop}
            tone="blue"
            title="Сначала укажите Квартиру"
            description="Приборы учёта и Показания доступны только участникам одной Квартиры"
            action={
              <Button size="small" variant="primary" onClick={() => navigate(ROUTES.join)}>
                Указать Квартиру
              </Button>
            }
          />
        </div>
      </PageFrame>
    );
  }

  if (!isDemo && membership?.role === 'management-company') {
    return (
      <PageFrame navigate={navigate}>
        <div className="list-card">
          <EmptyState
            icon={Drop}
            tone="blue"
            title="Это личный раздел Квартиры"
            description="УК не видит приборы учёта и Показания Жильцов"
          />
        </div>
      </PageFrame>
    );
  }

  if (status === 'loading') {
    return (
      <PageFrame navigate={navigate} busy>
        <SkeletonRows count={4} />
      </PageFrame>
    );
  }

  if (status === 'error' || !intake || !resolvedHouseId) {
    return (
      <PageFrame navigate={navigate}>
        <ErrorState onRetry={retry} />
      </PageFrame>
    );
  }

  return (
    <ReadingsWorkspace
      houseId={resolvedHouseId}
      intake={intake}
      isDemo={isDemo}
      navigate={navigate}
      notify={notify}
      onReplace={replace}
    />
  );
}

function PageFrame({ navigate, busy = false, children }: { navigate: Navigate; busy?: boolean; children: ReactNode }) {
  return (
    <main className="screen screen--inner inner-content" id="main-content" aria-busy={busy || undefined}>
      <ScreenHeading description="Личная история Квартиры">ЖКУ</ScreenHeading>
      <UtilityTabs active="readings" navigate={navigate} />
      {children}
    </main>
  );
}

type WorkspaceProps = {
  houseId: string;
  intake: ReadingsWindow;
  isDemo: boolean;
  navigate: Navigate;
  notify: Notify;
  onReplace: (value: ReadingsWindow | null) => void;
};

function ReadingsWorkspace({ houseId, intake, isDemo, navigate, notify, onReplace }: WorkspaceProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState<Array<{ meter: Meter; value: number }> | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Meter | 'new' | null>(null);
  const state = windowState(intake, new Date());
  const period = `с ${formatDay(intake.from)} по ${formatDay(intake.to)}`;
  const checks = intake.meters.map((meter) => ({ meter, check: checkReading(meter, values[meter.id] ?? '') }));

  useEffect(() => {
    setValues(Object.fromEntries(intake.meters.map((meter) => [
      meter.id,
      meter.current ? formatReading(meter.current.value, meter.decimals) : '',
    ])));
  }, [intake]);

  const replaceMeters = (meters: Meter[]) => onReplace({ ...intake, meters });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(Object.fromEntries(intake.meters.map(({ id }) => [id, true])));
    if (checks.some(({ check }) => check.kind === 'error')) {
      setFormError(null);
      return;
    }
    const filled = checks.flatMap(({ meter, check }) =>
      check.kind === 'ok' || check.kind === 'warning' ? [{ meter, value: check.value }] : [],
    );
    if (filled.length === 0) {
      setFormError('Заполните хотя бы один прибор');
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const fresh = isDemo
        ? {
            ...intake,
            meters: intake.meters.map((meter) => {
              const reading = filled.find(({ meter: item }) => item.id === meter.id);
              return reading ? { ...meter, current: { value: reading.value, at: new Date().toISOString() } } : meter;
            }),
          }
        : await saveReadings(houseId, { readings: filled.map(({ meter, value }) => ({ meterId: meter.id, value })) });
      onReplace(fresh);
      hapticSuccess();
      setSent(filled);
      notify('Показания сохранены в истории Квартиры');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Не удалось сохранить Показания');
    } finally {
      setSaving(false);
    }
  };

  if (sent) {
    return (
      <main className="screen screen--inner inner-content" id="main-content">
        <section className="join-result stagger" aria-live="polite">
          <IconTile icon={CheckCircle} tone="green" size="large" />
          <Typography.Text asChild variant="header"><h1>Показания сохранены</h1></Typography.Text>
          <Typography.Text asChild variant="body" color="secondary">
            <p>Запись общая для участников этой Квартиры. MaxTown не отправляет её в УК или Поставщику.</p>
          </Typography.Text>
        </section>
        <div className="list-card">
          <dl className="facts">
            {sent.map(({ meter, value }) => (
              <div className="facts__row" key={meter.id}>
                <dt>{meter.title}</dt>
                <dd className="tabular">{formatReading(value, meter.decimals)} {meter.unit}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="utility-actions">
          <Button size="medium" variant="secondary" stretched onClick={() => setSent(null)}>Исправить запись</Button>
          <Button size="medium" variant="primary" stretched onClick={() => navigate(ROUTES.home)}>На главную</Button>
        </div>
      </main>
    );
  }

  return (
    <main className="screen screen--inner inner-content stagger" id="main-content">
      <ScreenHeading description={`${intake.apartment}. Запись за текущий месяц`}>ЖКУ</ScreenHeading>
      <UtilityTabs active="readings" navigate={navigate} />

      {editing ? (
        <MeterForm
          houseId={houseId}
          meter={editing === 'new' ? null : editing}
          isDemo={isDemo}
          notify={notify}
          onCancel={() => setEditing(null)}
          onSaved={(meter) => {
            const existing = editing === 'new' ? null : editing;
            const next = existing ? { ...existing, ...meter } : meter;
            replaceMeters(existing
              ? intake.meters.map((item) => item.id === existing.id ? next : item)
              : [...intake.meters, next]);
            setEditing(null);
          }}
          onArchived={(meterId) => {
            replaceMeters(intake.meters.filter(({ id }) => id !== meterId));
            setEditing(null);
          }}
        />
      ) : null}

      {intake.meters.length === 0 ? (
        <div className="list-card">
          <EmptyState
            icon={Drop}
            tone="blue"
            title="Приборов учёта пока нет"
            description="Добавьте счётчики Квартиры, чтобы вести ежемесячную историю"
            action={<Button size="small" variant="primary" onClick={() => setEditing('new')}>Добавить прибор</Button>}
          />
        </div>
      ) : (
        <>
          {state !== 'open' ? (
            <aside className="outcome">
              <CalendarBlank className="icon" aria-hidden />
              <Typography.Text asChild variant="body">
                <p>{state === 'not-yet' ? `Запись откроется ${period}.` : 'Текущий месяц уже закрыт.'}</p>
              </Typography.Text>
            </aside>
          ) : null}

          <form className="readings-form" onSubmit={(event) => void submit(event)} noValidate>
            {checks.map(({ meter, check }) => (
              <MeterField
                key={meter.id}
                meter={meter}
                value={values[meter.id] ?? ''}
                check={check}
                showError={Boolean(touched[meter.id])}
                disabled={state !== 'open' || saving}
                onChange={(value) => {
                  setValues((current) => ({ ...current, [meter.id]: value }));
                  setFormError(null);
                }}
                onBlur={() => setTouched((current) => ({ ...current, [meter.id]: true }))}
              />
            ))}
            {formError ? <p className="field-error" role="alert">{formError}</p> : null}
            <Button type="submit" size="large" variant="primary" stretched loading={saving} disabled={state !== 'open'}>
              Сохранить показания
            </Button>
          </form>

          <section className="readings-settings" aria-labelledby="meters-title">
            <SectionHeading id="meters-title" title="Приборы учёта" actionLabel="Добавить" onAction={() => setEditing('new')} />
            <ListCard label="Приборы учёта Квартиры">
              {intake.meters.map((meter) => {
                const visual = meterVisuals[meter.kind];
                return (
                  <RowShell key={meter.id} onOpen={() => setEditing(meter)} trailing={<PencilSimple className="icon icon--small icon--mute" aria-hidden />}>
                    <IconTile icon={visual.icon} tone={visual.tone} size="small" />
                    <span className="list-row__copy">
                      <Typography.Text asChild variant="body-strong"><span>{meter.title}</span></Typography.Text>
                      <Typography.Text asChild variant="description" color="secondary">
                        <span>{meter.serial ? `№ ${meter.serial} · ` : ''}Точность: {meter.decimals} после запятой</span>
                      </Typography.Text>
                    </span>
                  </RowShell>
                );
              })}
            </ListCard>
          </section>
        </>
      )}

      <Typography.Text asChild variant="description" color="tertiary">
        <p className="utility-note">MaxTown хранит личную историю Квартиры и не передаёт Показания во внешние системы.</p>
      </Typography.Text>
    </main>
  );
}

type MeterFormProps = {
  houseId: string;
  meter: Meter | null;
  isDemo: boolean;
  notify: Notify;
  onCancel: () => void;
  onSaved: (meter: Meter) => void;
  onArchived: (meterId: string) => void;
};

function MeterForm({ houseId, meter, isDemo, notify, onCancel, onSaved, onArchived }: MeterFormProps) {
  const [kind, setKind] = useState<MeterKind>(meter?.kind ?? 'cold-water');
  const [title, setTitle] = useState(meter?.title ?? meterDefaults['cold-water'].title);
  const [serial, setSerial] = useState(meter?.serial ?? '');
  const [decimals, setDecimals] = useState(meter?.decimals ?? meterDefaults['cold-water'].decimals);
  const [saving, setSaving] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changeKind = (next: MeterKind) => {
    setKind(next);
    if (!meter) {
      setTitle(meterDefaults[next].title);
      setDecimals(meterDefaults[next].decimals);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim()) {
      setError('Укажите название прибора');
      return;
    }
    setSaving(true);
    setError(null);
    const input: MeterInput = {
      kind,
      title: title.trim(),
      ...(serial.trim() ? { serial: serial.trim() } : {}),
      decimals,
      ...(meter ? { version: meter.version } : {}),
    };
    try {
      const saved = isDemo
        ? {
            id: meter?.id ?? `demo-meter-${Date.now()}`,
            kind,
            title: input.title,
            unit: meterDefaults[kind].unit,
            ...(input.serial ? { serial: input.serial } : {}),
            decimals,
            version: (meter?.version ?? 0) + 1,
          }
        : await saveMeter(houseId, input, meter?.id);
      onSaved(saved);
      notify(meter ? 'Прибор учёта изменён' : 'Прибор учёта добавлен');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить Прибор учёта');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!meter) return;
    setSaving(true);
    setError(null);
    try {
      if (!isDemo) await archiveMeter(houseId, meter);
      onArchived(meter.id);
      notify('Прибор учёта убран. История сохранена');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось убрать Прибор учёта');
      setSaving(false);
    }
  };

  return (
    <form className="utility-form list-card" onSubmit={(event) => void submit(event)} noValidate>
      <SectionHeading title={meter ? 'Изменить прибор' : 'Новый прибор'} />
      <label className="contact-form__field">
        <span>Что учитывает</span>
        <NativeSelect value={kind} onChange={(event) => changeKind(event.target.value as MeterKind)} aria-label="Тип Прибора учёта">
          {(Object.keys(meterDefaults) as MeterKind[]).map((value) => <option value={value} key={value}>{meterDefaults[value].title}</option>)}
        </NativeSelect>
      </label>
      <label className="contact-form__field"><span>Название</span><Input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} /></label>
      <label className="contact-form__field"><span>Номер на приборе</span><Input value={serial} maxLength={80} placeholder="Необязательно" onChange={(event) => setSerial(event.target.value)} /></label>
      <label className="contact-form__field">
        <span>Знаков после запятой</span>
        <NativeSelect value={String(decimals)} onChange={(event) => setDecimals(Number(event.target.value))} aria-label="Знаков после запятой">
          {[0, 1, 2, 3].map((value) => <option value={value} key={value}>{value}</option>)}
        </NativeSelect>
      </label>
      {error ? <p className="field-error" role="alert">{error}</p> : null}
      <div className="utility-form__actions">
        <Button type="submit" size="medium" variant="primary" stretched loading={saving}>Сохранить прибор</Button>
        <Button type="button" size="medium" variant="secondary" stretched onClick={onCancel}>Отмена</Button>
      </div>
      {meter ? (
        confirmingArchive ? (
          <div className="utility-form__actions">
            <Typography.Text asChild variant="description" color="secondary"><p>Убрать прибор из текущего списка? Его Показания останутся в истории.</p></Typography.Text>
            <Button type="button" variant="destructive" loading={saving} onClick={() => void remove()}>Убрать прибор</Button>
            <Button type="button" variant="ghost" onClick={() => setConfirmingArchive(false)}>Не убирать</Button>
          </div>
        ) : (
          <Button type="button" variant="ghost" iconBefore={<Trash className="icon icon--small" aria-hidden />} onClick={() => setConfirmingArchive(true)}>
            Убрать прибор
          </Button>
        )
      ) : null}
    </form>
  );
}

type MeterFieldProps = {
  meter: Meter;
  value: string;
  check: ReadingCheck;
  showError: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
  onBlur: () => void;
};

function MeterField({ meter, value, check, showError, disabled, onChange, onBlur }: MeterFieldProps) {
  const { icon, tone } = meterVisuals[meter.kind];
  const inputId = `meter-${meter.id}`;
  const error = showError && check.kind === 'error' ? check.message : null;
  const warning = check.kind === 'warning' ? check.message : null;
  const hintId = `${inputId}-hint`;

  return (
    <section className="meter" aria-labelledby={`${inputId}-label`}>
      <div className="meter__head">
        <IconTile icon={icon} tone={tone} size="small" />
        <span className="list-row__copy">
          <Typography.Text asChild variant="body-strong"><label id={`${inputId}-label`} htmlFor={inputId}>{meter.title}</label></Typography.Text>
          {meter.serial ? <Typography.Text asChild variant="description" color="tertiary"><span className="tabular">Прибор № {meter.serial}</span></Typography.Text> : null}
        </span>
      </div>
      <div className={`meter__field${error ? ' meter__field--invalid' : ''}`}>
        <input
          id={inputId}
          className="meter__input tabular"
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="next"
          placeholder="Сейчас на приборе"
          value={value}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={hintId}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
        />
        <span className="meter__unit">{meter.unit}</span>
      </div>
      <Typography.Text asChild variant="description" color="tertiary">
        <p id={hintId} className={error ? 'field-error' : warning ? 'meter__warning' : undefined}>
          {error ?? warning ?? (check.kind === 'ok' && check.consumption !== undefined
            ? `Расход с прошлого раза: ${formatReading(check.consumption, meter.decimals)} ${meter.unit}`
            : meter.previous
              ? `Прошлые: ${formatReading(meter.previous.value, meter.decimals)} ${meter.unit}, ${formatDay(meter.previous.at)}`
              : 'Прошлых Показаний нет')}
        </p>
      </Typography.Text>
    </section>
  );
}
