import { useState, type FormEvent } from 'react';
import { Warning } from '@phosphor-icons/react';
import type { HouseRole } from '@maxtown/shared';
import { Button, Input, Textarea, Typography } from '../components/platform-ui.tsx';
import { systemVisuals } from '../components/categoryVisuals.ts';
import { EmptyState, MiniTile, ScreenHeading } from '../components/ui.tsx';
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

type Errors = { system?: string; title?: string; description?: string };

/**
 * Открыть Аварию вручную (docs/adr/0012): УК и Администратор Дома. Авария
 * заберёт свежие Заявки о своей Системе и закроет их, когда её закроют.
 */
export function NewAccidentScreen({ navigate, notify, houseId, role }: NewAccidentScreenProps) {
  const [system, setSystem] = useState<HouseSystemName | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState('');
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
            title="Аварии открывают УК и Администратор Дома"
            description="Если что-то сломалось, подайте Заявку: когда о неполадке сообщат три Жильца, Авария откроется сама"
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
    if (!system) nextErrors.system = 'Выберите Систему, которая не работает';
    if (!title.trim()) nextErrors.title = 'Коротко: что случилось';
    if (!description.trim()) nextErrors.description = 'Опишите, что известно и что уже делают';
    setErrors(nextErrors);
    if (!system || nextErrors.title || nextErrors.description) return;

    setSaving(true);
    try {
      const expectedResolutionAt = fromDateTimeLocal(until);
      const opened = await eventsClient.open(houseId, {
        system,
        title: title.trim(),
        description: description.trim(),
        ...(scope.trim() ? { scope: scope.trim() } : {}),
        ...(expectedResolutionAt ? { expectedResolutionAt } : {}),
        advice: advice.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 10),
      });
      notify('Авария открыта. Её видят все Жильцы Дома');
      navigate(eventRoute(opened.id));
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не удалось открыть Аварию');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="screen screen--inner screen--with-panel" id="main-content">
      <form className="request-form" onSubmit={(event) => void submit(event)} noValidate>
        <div className="inner-content stagger">
          <ScreenHeading description="Авария видна всем Жильцам в Состоянии дома. Свежие Заявки о Системе привяжутся к ней">
            Новая Авария
          </ScreenHeading>

          <fieldset className="form-section" aria-describedby={errors.system ? 'system-error' : undefined}>
            <Typography.Text asChild variant="title">
              <legend>Что не работает</legend>
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
          </fieldset>

          <section className="form-section" aria-labelledby="accident-title-label">
            <Typography.Text asChild variant="title">
              <label id="accident-title-label" htmlFor="accident-title">Коротко</label>
            </Typography.Text>
            <Input
              id="accident-title"
              value={title}
              maxLength={120}
              placeholder="Например: нет холодной воды"
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
              <label id="accident-description-label" htmlFor="accident-description">Что случилось</label>
            </Typography.Text>
            <Textarea
              id="accident-description"
              className={`request-textarea${errors.description ? ' request-textarea--invalid' : ''}`}
              value={description}
              rows={4}
              maxLength={2000}
              placeholder="Прорыв на вводе, аварийная служба уже работает"
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

          <section className="form-section" aria-labelledby="accident-until-label">
            <Typography.Text asChild variant="title">
              <label id="accident-until-label" htmlFor="accident-until">Устранят к</label>
            </Typography.Text>
            <input
              id="accident-until"
              className="date-field"
              type="datetime-local"
              value={until}
              onChange={(event) => setUntil(event.target.value)}
            />
            <Typography.Text asChild variant="description" color="tertiary">
              <p>Необязательно. Если срок неизвестен, Жильцы увидят «Уточняется».</p>
            </Typography.Text>
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
          <Button type="submit" size="medium" variant="destructive" stretched loading={saving}>
            Открыть Аварию
          </Button>
        </footer>
      </form>
    </main>
  );
}
