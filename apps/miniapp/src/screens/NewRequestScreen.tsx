import { Camera, House, Info, Warning, X } from '@phosphor-icons/react';
import { Button, Textarea, Typography } from '../components/platform-ui.tsx';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { categoryVisual } from '../components/categoryVisuals.ts';
import { MiniTile, ScreenHeading, Segmented } from '../components/ui.tsx';
import { requestCategories, requestPlaces, type RequestPlace } from '../data/categories.ts';
import { useHomeData } from '../data/home.ts';
import { knownProblem, useHouseState } from '../data/houseState.ts';
import { eventRoute, ROUTES } from '../routes.ts';
import type { Navigate, Notify } from './types.ts';

const DESCRIPTION_LIMIT = 500;
const MINIMUM_DESCRIPTION_LENGTH = 10;
const PHOTO_LIMIT = 4;

type VisitDay = 'today' | 'tomorrow' | 'date';

const visitDays: Array<{ value: VisitDay; label: string }> = [
  { value: 'today', label: 'Сегодня' },
  { value: 'tomorrow', label: 'Завтра' },
  { value: 'date', label: 'Другой день' },
];

type Photo = { id: string; url: string; name: string };

type Errors = { category?: string; description?: string };

function todayIso(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function NewRequestScreen({ navigate, notify }: { navigate: Navigate; notify: Notify }) {
  const [place, setPlace] = useState<RequestPlace>('apartment');
  const [category, setCategory] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [visitDay, setVisitDay] = useState<VisitDay>('today');
  const [visitDate, setVisitDate] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const photoInput = useRef<HTMLInputElement>(null);
  const { status: homeStatus, isResident } = useHomeData();
  const guest = homeStatus === 'ready' && !isResident;
  const { data: house } = useHouseState();
  const problem = knownProblem(house, category);

  // Превью живут как object URL — освобождаем их, когда экран закрывается.
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  useEffect(() => () => photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.url)), []);

  const addPhotos = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).slice(0, PHOTO_LIMIT - photos.length);
    event.target.value = '';
    setPhotos((current) => [
      ...current,
      ...files.map((file) => ({ id: crypto.randomUUID(), url: URL.createObjectURL(file), name: file.name })),
    ]);
  };

  const removePhoto = (photo: Photo) => {
    URL.revokeObjectURL(photo.url);
    setPhotos((current) => current.filter(({ id }) => id !== photo.id));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors: Errors = {};
    if (!category) nextErrors.category = 'Выберите Категорию — от неё зависит, кто получит Заявку';
    if (description.trim().length < MINIMUM_DESCRIPTION_LENGTH) {
      nextErrors.description = 'Опишите неисправность подробнее: нужно хотя бы 10 символов';
    }
    setErrors(nextErrors);
    if (nextErrors.category || nextErrors.description) return;

    if (guest) {
      notify('Сначала станьте Жильцом: Заявки уходят Ответственным от Жильцов');
      return;
    }
    // API ещё нет: Заявка никуда не уходит.
    notify('Заявка отправлена Ответственному');
    navigate(ROUTES.requests);
  };

  return (
    <main className="screen screen--inner screen--with-panel" id="main-content">
      <form className="request-form" onSubmit={submit} noValidate>
        <div className="inner-content stagger">
          <ScreenHeading description="Опишите, что сломалось. Заявка уйдёт Ответственному за эту Категорию">
            Новая заявка
          </ScreenHeading>

          {guest ? (
            <aside className="outcome">
              <House className="icon" weight="fill" aria-hidden />
              <span className="request-note__copy">
                <Typography.Text asChild variant="description" color="secondary">
                  <p>Заявки уходят Ответственным от Жильцов. Станьте Жильцом своей Квартиры, это пара минут.</p>
                </Typography.Text>
                <button className="text-action pressable request-note__join" type="button" onClick={() => navigate(ROUTES.join)}>
                  Стать Жильцом
                </button>
              </span>
            </aside>
          ) : null}

          {/* Опасное — первым: при прорыве или газе заполнять форму не нужно. */}
          <aside className="request-note">
            <Warning className="icon" weight="fill" aria-hidden />
            <span className="request-note__copy">
              <Typography.Text asChild variant="description" color="secondary">
                <p>Прорвало трубу, пахнет газом или искрит проводка? Звоните в аварийную службу, не ждите.</p>
              </Typography.Text>
              <button className="text-action pressable request-note__action" type="button" onClick={() => navigate(ROUTES.contacts)}>
                Номера служб
              </button>
            </span>
          </aside>

          <fieldset className="form-section">
            <Typography.Text asChild variant="title">
              <legend>Где неисправность?</legend>
            </Typography.Text>
            <Segmented label="Где неисправность" options={requestPlaces} value={place} onChange={setPlace} />
            <Typography.Text asChild variant="description" color="tertiary">
              <p>{requestPlaces.find(({ value }) => value === place)?.hint}</p>
            </Typography.Text>
          </fieldset>

          <fieldset className="form-section" aria-describedby={errors.category ? 'category-error' : undefined}>
            <Typography.Text asChild variant="title">
              <legend>Категория</legend>
            </Typography.Text>
            <div className="chips">
              {requestCategories.map((item) => (
                <button
                  className={`chip chip--with-icon pressable${category === item ? ' chip--selected' : ''}`}
                  type="button"
                  aria-pressed={category === item}
                  key={item}
                  onClick={() => {
                    setCategory(item);
                    setErrors((current) => ({ ...current, category: undefined }));
                  }}
                >
                  <MiniTile icon={categoryVisual(item).icon} tone={categoryVisual(item).tone} />
                  {item}
                </button>
              ))}
            </div>
            {errors.category ? (
              <Typography.Text asChild variant="description">
                <span className="field-error" id="category-error">
                  {errors.category}
                </span>
              </Typography.Text>
            ) : null}
            {/* Об этой Системе уже известно — говорим до того, как Жилец опишет то же самое. */}
            {problem ? (
              <aside className="outcome reveal" aria-live="polite">
                <Info className="icon" weight="fill" aria-hidden />
                <span className="request-note__copy">
                  <Typography.Text asChild variant="body-strong">
                    <p>
                      {problem.status === 'accident'
                        ? `Сейчас открыта Авария: ${problem.name}`
                        : `Сейчас Плановое отключение: ${problem.name}`}
                    </p>
                  </Typography.Text>
                  <Typography.Text asChild variant="description" color="secondary">
                    <p>
                      {problem.status === 'accident'
                        ? 'Ответственные уже знают. Заявку можно не подавать, а если подадите, она привяжется к Аварии и закроется вместе с ней.'
                        : 'Это не поломка: Система не работает по плану. Если после окончания не заработает, подайте Заявку.'}
                    </p>
                  </Typography.Text>
                  {problem.eventId ? (
                    <button
                      className="text-action pressable request-note__join"
                      type="button"
                      onClick={() => problem.eventId && navigate(eventRoute(problem.eventId))}
                    >
                      Подробнее
                    </button>
                  ) : null}
                </span>
              </aside>
            ) : null}
          </fieldset>

          <section className="form-section" aria-labelledby="description-label">
            <Typography.Text asChild variant="title">
              <label id="description-label" htmlFor="description">
                Что случилось?
              </label>
            </Typography.Text>
            <Textarea
              id="description"
              className={`request-textarea${errors.description ? ' request-textarea--invalid' : ''}`}
              value={description}
              placeholder="Например: течёт труба под раковиной на кухне"
              maxLength={DESCRIPTION_LIMIT}
              rows={4}
              aria-invalid={Boolean(errors.description)}
              aria-describedby={errors.description ? 'description-error description-count' : 'description-count'}
              onChange={(event) => {
                setDescription(event.target.value);
                if (errors.description) setErrors((current) => ({ ...current, description: undefined }));
              }}
            />
            <div className="field-footer">
              {errors.description ? (
                <Typography.Text asChild variant="description">
                  <span className="field-error" id="description-error">
                    {errors.description}
                  </span>
                </Typography.Text>
              ) : (
                <span />
              )}
              <Typography.Text asChild variant="description" color="tertiary">
                <span className="character-count" id="description-count">
                  {description.length}/{DESCRIPTION_LIMIT}
                </span>
              </Typography.Text>
            </div>
          </section>

          <section className="form-section" aria-labelledby="photo-label">
            <Typography.Text asChild variant="title">
              <h2 id="photo-label">Фото</h2>
            </Typography.Text>
            <div className="photo-grid">
              {photos.map((photo) => (
                <figure className="photo-tile" key={photo.id}>
                  <img src={photo.url} alt={`Фото: ${photo.name}`} />
                  <button
                    className="photo-tile__remove pressable"
                    type="button"
                    aria-label={`Убрать фото ${photo.name}`}
                    onClick={() => removePhoto(photo)}
                  >
                    <X className="icon icon--small" weight="bold" aria-hidden />
                  </button>
                </figure>
              ))}
              {photos.length < PHOTO_LIMIT ? (
                <button className="photo-add pressable" type="button" onClick={() => photoInput.current?.click()}>
                  <Camera className="icon" aria-hidden />
                  <span>Добавить</span>
                </button>
              ) : null}
            </div>
            <input
              ref={photoInput}
              className="visually-hidden"
              type="file"
              accept="image/*"
              multiple
              tabIndex={-1}
              aria-hidden
              onChange={addPhotos}
            />
            <Typography.Text asChild variant="description" color="tertiary">
              <p>До {PHOTO_LIMIT} фото. Так Ответственный поймёт, что взять с собой.</p>
            </Typography.Text>
          </section>

          {place === 'apartment' ? (
            <section className="form-section" aria-labelledby="visit-label">
              <Typography.Text asChild variant="title">
                <h2 id="visit-label">Когда удобен Визит?</h2>
              </Typography.Text>
              <div className="chips">
                {visitDays.map(({ value, label }) => (
                  <button
                    className={`chip pressable${visitDay === value ? ' chip--selected' : ''}`}
                    type="button"
                    aria-pressed={visitDay === value}
                    key={value}
                    onClick={() => setVisitDay(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {visitDay === 'date' ? (
                <input
                  className="date-field reveal"
                  type="date"
                  min={todayIso()}
                  value={visitDate}
                  aria-label="День Визита"
                  onChange={(event) => setVisitDate(event.target.value)}
                />
              ) : null}
              <Typography.Text asChild variant="description" color="tertiary">
                <p>Время Визита назначит Ответственный.</p>
              </Typography.Text>
            </section>
          ) : null}

        </div>

        <footer className="bottom-panel">
          <Button type="submit" size="medium" variant="primary" stretched>
            Отправить заявку
          </Button>
        </footer>
      </form>
    </main>
  );
}
