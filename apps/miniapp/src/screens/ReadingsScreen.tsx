import { useState, type FormEvent } from 'react';
import { CalendarBlank, CheckCircle, Drop, Lightning, Moon, Thermometer } from '@phosphor-icons/react';
import { Button, Typography } from '../components/platform-ui.tsx';
import type { Meter, ReadingsWindow } from '@maxtown/shared';
import {
  EmptyState,
  ErrorState,
  IconTile,
  ScreenHeading,
  SkeletonRows,
  type IconComponent,
  type TileTone,
} from '../components/ui.tsx';
import { checkReading, formatReading, useReadingsWindow, windowState, type ReadingCheck } from '../data/readings.ts';
import { hapticSuccess } from '../haptics.ts';
import { ROUTES } from '../routes.ts';
import type { Navigate } from './types.ts';

/** Холодная и горячая вода — один значок разного цвета, день и ночь — разные значки. */
const meterVisuals: Record<Meter['kind'], { icon: IconComponent; tone: TileTone }> = {
  'cold-water': { icon: Drop, tone: 'blue' },
  'hot-water': { icon: Drop, tone: 'coral' },
  'electricity-day': { icon: Lightning, tone: 'green' },
  'electricity-night': { icon: Moon, tone: 'teal' },
  heat: { icon: Thermometer, tone: 'pink' },
};

const dayFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });

function formatDay(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return dayFormat.format(new Date(year ?? 0, (month ?? 1) - 1, day ?? 1));
}

type ReadingsScreenProps = {
  navigate: Navigate;
};

/** Передача Показаний: по полю на прибор учёта, расход считается сразу. */
export function ReadingsScreen({ navigate }: ReadingsScreenProps) {
  const { status, data: intake, retry } = useReadingsWindow();

  if (status === 'loading') {
    return (
      <main className="screen screen--inner inner-content" id="main-content" aria-busy="true">
        <ScreenHeading>Передать показания</ScreenHeading>
        <SkeletonRows count={4} />
      </main>
    );
  }

  if (status === 'error') {
    return (
      <main className="screen screen--inner inner-content" id="main-content">
        <ScreenHeading>Передать показания</ScreenHeading>
        <ErrorState onRetry={retry} />
      </main>
    );
  }

  if (!intake) {
    return (
      <main className="screen screen--inner inner-content" id="main-content">
        <ScreenHeading>Передать показания</ScreenHeading>
        <div className="list-card">
          <EmptyState
            icon={Drop}
            tone="blue"
            title="Показания передают Жильцы"
            description="Станьте Жильцом своей Квартиры, и здесь появятся её приборы учёта"
            action={
              <Button size="small" variant="primary" onClick={() => navigate(ROUTES.join)}>
                Стать Жильцом
              </Button>
            }
          />
        </div>
      </main>
    );
  }

  return <ReadingsForm intake={intake} navigate={navigate} />;
}

function ReadingsForm({ intake, navigate }: { intake: ReadingsWindow } & ReadingsScreenProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState<Array<{ meter: Meter; value: number }> | null>(null);
  const state = windowState(intake, new Date());
  const period = `с ${formatDay(intake.from)} по ${formatDay(intake.to)}`;

  const checks = intake.meters.map((meter) => ({ meter, check: checkReading(meter, values[meter.id] ?? '') }));

  if (sent) {
    return (
      <main className="screen screen--inner inner-content" id="main-content">
        <section className="join-result stagger" aria-live="polite">
          <IconTile icon={CheckCircle} tone="green" size="large" />
          <Typography.Text asChild variant="header">
            <h1>Показания переданы</h1>
          </Typography.Text>
          <Typography.Text asChild variant="body" color="secondary">
            <p>Исправить можно до {formatDay(intake.to)}: отправьте Показания ещё раз.</p>
          </Typography.Text>
        </section>
        <div className="list-card">
          <dl className="facts">
            {sent.map(({ meter, value }) => (
              <div className="facts__row" key={meter.id}>
                <dt>{meter.title}</dt>
                <dd className="tabular">
                  {formatReading(value, meter.decimals)} {meter.unit}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <Button size="medium" variant="secondary" stretched onClick={() => navigate(ROUTES.home)}>
          На главную
        </Button>
      </main>
    );
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
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
    // API ещё нет: Показания никуда не уходят, экран показывает итог.
    hapticSuccess();
    setSent(filled);
  };

  return (
    <main className="screen screen--inner screen--with-panel" id="main-content">
      <form className="request-form" onSubmit={submit} noValidate>
        <div className="inner-content stagger">
          <ScreenHeading description={`${intake.apartment}. Принимаем ${period}`}>Передать показания</ScreenHeading>

          {state !== 'open' ? (
            <aside className="outcome">
              <CalendarBlank className="icon" aria-hidden />
              <Typography.Text asChild variant="body">
                <p>
                  {state === 'not-yet'
                    ? `Приём ещё не начался: Показания принимаем ${period}.`
                    : 'Приём закрыт до следующего месяца.'}
                </p>
              </Typography.Text>
            </aside>
          ) : null}

          {checks.map(({ meter, check }) => (
            <MeterField
              key={meter.id}
              meter={meter}
              value={values[meter.id] ?? ''}
              check={check}
              showError={Boolean(touched[meter.id])}
              disabled={state !== 'open'}
              onChange={(value) => {
                setValues((current) => ({ ...current, [meter.id]: value }));
                setFormError(null);
              }}
              onBlur={() => setTouched((current) => ({ ...current, [meter.id]: true }))}
            />
          ))}

          {formError ? (
            <Typography.Text asChild variant="description">
              <p className="field-error" role="alert">
                {formError}
              </p>
            </Typography.Text>
          ) : null}
        </div>

        <footer className="bottom-panel">
          <Button type="submit" size="medium" variant="primary" stretched disabled={state !== 'open'}>
            Передать показания
          </Button>
        </footer>
      </form>
    </main>
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
          <Typography.Text asChild variant="body-strong">
            <label id={`${inputId}-label`} htmlFor={inputId}>
              {meter.title}
            </label>
          </Typography.Text>
          {meter.serial ? (
            <Typography.Text asChild variant="description" color="tertiary">
              <span className="tabular">Прибор № {meter.serial}</span>
            </Typography.Text>
          ) : null}
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
          {error ??
            warning ??
            (check.kind === 'ok' && check.consumption !== undefined
              ? `Расход с прошлого раза: ${formatReading(check.consumption, meter.decimals)} ${meter.unit}`
              : meter.previous
                ? `Прошлые: ${formatReading(meter.previous.value, meter.decimals)} ${meter.unit}, ${formatDay(meter.previous.at)}`
                : 'Прошлых Показаний нет')}
        </p>
      </Typography.Text>
    </section>
  );
}
