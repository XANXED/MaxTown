import { useState, type FormEvent } from 'react';
import { Warning } from '@phosphor-icons/react';
import type { HouseEventKind, HouseRole } from '@maxtown/shared';
import { Button, Input, Textarea, Typography } from '../components/platform-ui.tsx';
import { systemVisuals } from '../components/categoryVisuals.ts';
import { EmptyState, MiniTile, ScreenHeading, Segmented } from '../components/ui.tsx';
import { canManageServices } from '../auth/membership.tsx';
import { houseSystems, type HouseSystemName } from '../data/categories.ts';
import { eventsClient } from '../data/eventDetails.ts';
import { fromDateTimeLocal } from '../data/repairMode.ts';
import { eventRoute, ROUTES } from '../routes.ts';
import type { Navigate, Notify } from './types.ts';

type NewAccidentScreenProps = {
  navigate: Navigate;
  notify: Notify;
  houseId: string | null;
  role: HouseRole | null;
};

type Errors = { system?: string; title?: string; description?: string; startsAt?: string; endsAt?: string };

const kindOptions: Array<{ value: HouseEventKind; label: string }> = [
  { value: 'accident', label: 'Авария' },
  { value: 'planned-outage', label: 'Отключение' },
  { value: 'announcement', label: 'Объявление' },
];

/**
 * Открыть Аварию вручную (docs/adr/0012): УК и Администратор Дома. Авария
 * заберёт свежие Заявки о своей Системе и закроет их, когда её закроют.
 */
export function NewAccidentScreen({ navigate, notify, houseId, role }: NewAccidentScreenProps) {
  const [kind, setKind] = useState<HouseEventKind>('accident');
  const [system, setSystem] = useState<HouseSystemName | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [until, setUntil] = useState('');
  const [advice, setAdvice] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  if (!houseId || !canManageServices(role)) {
    return (
      <main className="screen screen--inner inner-content" id="main-content">
        <div className="list-card">
          <EmptyState
            icon={Warning}
            tone="coral"
            title="События публикуют УК и Администратор Дома"
            description="Если что-то сломалось, подайте Заявку: Авария может открыться автоматически после сообщений Жильцов"
            action={
              <Button size="small" variant="primary" onClick={() => navigate(ROUTES.newRequest)}>
                Подать заявку
              </Button>
            }
          />
        </div>
      </main>
    );
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const nextErrors: Errors = {};
    if (kind !== 'announcement' && !system) nextErrors.system = 'Выберите затронутую Систему';
    if (!title.trim()) nextErrors.title = 'Коротко назовите Событие';
    if (!description.trim()) nextErrors.description = 'Добавьте понятное Жильцам описание';
    if (kind !== 'accident' && !startsAt) nextErrors.startsAt = 'Укажите начало';
    if (kind === 'planned-outage' && !until) nextErrors.endsAt = 'Укажите окончание';
    const startIso = fromDateTimeLocal(startsAt);
    const endIso = fromDateTimeLocal(until);
    if (startIso && endIso && new Date(endIso) <= new Date(startIso)) nextErrors.endsAt = 'Окончание должно быть позже начала';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    try {
      const adviceLines = advice.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 10);
      const created = kind === 'accident'
        ? await eventsClient.open(houseId, {
            system: system!, title: title.trim(), description: description.trim(),
            ...(scope.trim() ? { scope: scope.trim() } : {}),
            ...(endIso ? { expectedResolutionAt: endIso } : {}), advice: adviceLines,
          })
        : await eventsClient.publish(houseId, {
            kind, title: title.trim(), description: description.trim(),
            ...(scope.trim() ? { scope: scope.trim() } : {}),
            systems: kind === 'planned-outage' ? [system!] : [],
            startsAt: startIso!, ...(endIso ? { endsAt: endIso } : {}), advice: adviceLines,
          });
      notify(kind === 'accident' ? 'Авария открыта. Её видят все Жильцы Дома' : 'Событие опубликовано для Жильцов Дома');
      navigate(eventRoute(created.id));
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не удалось опубликовать Событие');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="screen screen--inner screen--with-panel" id="main-content">
      <form className="request-form" onSubmit={(event) => void submit(event)} noValidate>
        <div className="inner-content stagger">
          <ScreenHeading description="Опубликованное Событие увидят все участники этого Дома">
            Новое Событие
          </ScreenHeading>

          <Segmented label="Вид События" options={kindOptions} value={kind} onChange={(value) => {
            setKind(value);
            setErrors({});
          }} />

          {kind !== 'announcement' ? <fieldset className="form-section" aria-describedby={errors.system ? 'system-error' : undefined}>
            <Typography.Text asChild variant="title">
              <legend>{kind === 'accident' ? 'Что не работает' : 'Что отключат'}</legend>
            </Typography.Text>
            <div className="chips">
              {houseSystems.map((name) => (
                <button
                  className={`chip chip--with-icon pressable${system === name ? ' chip--selected' : ''}`}
                  type="button"
                  aria-pressed={system === name}
                  key={name}
                  onClick={() => {
                    setSystem(name);
                    setErrors((current) => ({ ...current, system: undefined }));
                  }}
                >
                  <MiniTile icon={systemVisuals[name].icon} tone={systemVisuals[name].tone} />
                  {name}
                </button>
              ))}
            </div>
            {errors.system ? (
              <Typography.Text asChild variant="description">
                <span className="field-error" id="system-error">{errors.system}</span>
              </Typography.Text>
            ) : null}
          </fieldset> : null}

          <section className="form-section" aria-labelledby="accident-title-label">
            <Typography.Text asChild variant="title">
              <label id="accident-title-label" htmlFor="accident-title">Заголовок</label>
            </Typography.Text>
            <Input
              id="accident-title"
              value={title}
              maxLength={120}
              placeholder={kind === 'accident' ? 'Например: нет холодной воды' : kind === 'planned-outage' ? 'Отключение горячей воды' : 'Собрание Жильцов во дворе'}
              aria-invalid={Boolean(errors.title)}
              aria-describedby={errors.title ? 'accident-title-error' : undefined}
              onChange={(event) => setTitle(event.target.value)}
            />
            {errors.title ? (
              <Typography.Text asChild variant="description">
                <span className="field-error" id="accident-title-error">{errors.title}</span>
              </Typography.Text>
            ) : null}
          </section>

          <section className="form-section" aria-labelledby="accident-description-label">
            <Typography.Text asChild variant="title">
              <label id="accident-description-label" htmlFor="accident-description">Описание</label>
            </Typography.Text>
            <Textarea
              id="accident-description"
              className={`request-textarea${errors.description ? ' request-textarea--invalid' : ''}`}
              value={description}
              rows={4}
              maxLength={2000}
              placeholder={kind === 'accident' ? 'Прорыв на вводе, аварийная служба уже работает' : 'Что произойдёт, почему и к кому обратиться с вопросами'}
              aria-invalid={Boolean(errors.description)}
              aria-describedby={errors.description ? 'accident-description-error' : undefined}
              onChange={(event) => setDescription(event.target.value)}
            />
            {errors.description ? (
              <Typography.Text asChild variant="description">
                <span className="field-error" id="accident-description-error">{errors.description}</span>
              </Typography.Text>
            ) : null}
          </section>

          <section className="form-section" aria-labelledby="accident-scope-label">
            <Typography.Text asChild variant="title">
              <label id="accident-scope-label" htmlFor="accident-scope">Где</label>
            </Typography.Text>
            <Input
              id="accident-scope"
              value={scope}
              maxLength={120}
              placeholder="Весь Дом, 2-й подъезд, двор"
              onChange={(event) => setScope(event.target.value)}
            />
          </section>

          {kind !== 'accident' ? <section className="form-section" aria-labelledby="event-start-label">
            <Typography.Text asChild variant="title">
              <label id="event-start-label" htmlFor="event-start">{kind === 'planned-outage' ? 'Начало' : 'Дата и время'}</label>
            </Typography.Text>
            <input
              id="event-start"
              className="date-field"
              type="datetime-local"
              value={startsAt}
              aria-invalid={Boolean(errors.startsAt)}
              onChange={(event) => { setStartsAt(event.target.value); setErrors((current) => ({ ...current, startsAt: undefined })); }}
            />
            {errors.startsAt ? <span className="field-error" role="alert">{errors.startsAt}</span> : null}
          </section> : null}

          <section className="form-section" aria-labelledby="accident-until-label">
            <Typography.Text asChild variant="title">
              <label id="accident-until-label" htmlFor="accident-until">
                {kind === 'accident' ? 'Устранят к' : kind === 'planned-outage' ? 'Окончание' : 'Показывать до'}
              </label>
            </Typography.Text>
            <input
              id="accident-until"
              className="date-field"
              type="datetime-local"
              value={until}
              aria-invalid={Boolean(errors.endsAt)}
              onChange={(event) => { setUntil(event.target.value); setErrors((current) => ({ ...current, endsAt: undefined })); }}
            />
            <Typography.Text asChild variant="description" color="tertiary">
              <p>{kind === 'planned-outage' ? 'Обязательное поле для Планового отключения.' : 'Необязательно.'}</p>
            </Typography.Text>
            {errors.endsAt ? <span className="field-error" role="alert">{errors.endsAt}</span> : null}
          </section>

          <section className="form-section" aria-labelledby="accident-advice-label">
            <Typography.Text asChild variant="title">
              <label id="accident-advice-label" htmlFor="accident-advice">Что делать Жильцам</label>
            </Typography.Text>
            <Textarea
              id="accident-advice"
              className="request-textarea"
              value={advice}
              rows={3}
              placeholder={'По совету на строку, например:\nНаберите воду заранее'}
              onChange={(event) => setAdvice(event.target.value)}
            />
          </section>
        </div>

        <footer className="bottom-panel">
          <Button type="submit" size="medium" variant={kind === 'accident' ? 'destructive' : 'primary'} stretched loading={saving}>
            {kind === 'accident' ? 'Открыть Аварию' : 'Опубликовать Событие'}
          </Button>
        </footer>
      </form>
    </main>
  );
}
